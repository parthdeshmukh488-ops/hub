import type { LeashEvent } from "@leash/contracts";
import {
  type DecodedDelegation,
  decodeLeashEvents,
  fetchAgentDelegation,
  fetchAgentView,
  fetchAgentViews,
  fetchOpenRequests,
  fetchPayees,
  fetchPrincipalViews,
  findPayeePda,
  type LeashChain,
  readChainTime,
  type SignatureInfo,
} from "@leash/sdk";
import { address } from "@solana/kit";
import type { AccountSnapshot, DelegationRecord, PayeeEntryFact } from "../projection/records.ts";
import type { EventSink, EventSource } from "./source.ts";

// Chain mode (WS4 build step 2): follows the Leash program's transactions after a stored cursor,
// decodes them with the SDK, and reports the account facts events don't carry. Polling is the
// backbone: it covers every gap, including restarts (the cursor is saved after each transaction,
// and storing an event twice is harmless). `poke()` polls at once, for a push trigger.

/** Where ingestion stopped: the last transaction whose events are stored. */
export type ChainCursor = { signature: string; slot: number };

/** An agent the database already knows, so restarts can read its delegation and principal. */
export type KnownAgent = { agent: string; principal: string | null; delegation: string | null };

export type ChainSourceOptions = {
  chain: LeashChain;
  /** The Leash program (`LEASH_PROGRAM_ID`). */
  programId: string;
  cursor: { load(): Promise<ChainCursor | null>; save(cursor: ChainCursor): Promise<void> };
  /** Agents already stored: their delegations are re-read at start ("accounts give truth"). */
  knownAgents?: () => Promise<KnownAgent[]>;
  /** `INDEXER_POLL_INTERVAL_MS`. */
  pollIntervalMs: number;
  /** `INDEXER_BACKFILL_LIMIT`: transactions read on a first start. */
  backfillLimit: number;
  /** Unix seconds. */
  now?: () => number;
  /** A failed poll; the next one retries. */
  onError?: (error: unknown) => void;
  /** More new transactions than one poll reads (the oldest are skipped). */
  onGap?: (skippedBefore: string) => void;
  /** Signatures per page; default 1 000, `getSignaturesForAddress`'s maximum. */
  pageSize?: number;
  /**
   * The RPC does not know the cursor's transaction on `FOREIGN_CURSOR_MISSES` polls in a row: the
   * database belongs to another chain (a restarted localnet) or the node no longer has it. The RPC
   * then fails every page that names the cursor (Agave: "Transaction … not found"). The handler
   * resets the database; the source then starts over with a backfill and a snapshot. Without it,
   * polls keep failing.
   */
  onForeignCursor?: (cursor: ChainCursor) => Promise<void>;
  /** An account snapshot was applied (logs, tests). */
  onSnapshot?: (counts: { principals: number; agents: number; rounds: number }) => void;
};

/**
 * One miss is often a lagging RPC node that has not seen the cursor's transaction yet (devnet);
 * only this many polls in a row that fail and miss the cursor mean another chain.
 */
export const FOREIGN_CURSOR_MISSES = 3;

/** Failed polls in a row after which the source reports itself unhealthy (`/v1/health`). */
export const UNHEALTHY_AFTER_FAILURES = 3;

/** Snapshot rounds at most: each round re-reads the accounts if new transactions arrived. */
const SNAPSHOT_ROUNDS = 5;

/** A delegation account as the store keeps it. */
export function delegationRecord(delegation: DecodedDelegation, agent: string): DelegationRecord {
  const base = {
    address: delegation.address,
    agent,
    owner: delegation.delegator,
    mint: delegation.mint,
  };
  const { state } = delegation;
  const expiresAt = state.expiryTs === 0n ? null : Number(state.expiryTs);
  if (state.kind === "fixed") {
    return { ...base, kind: "fixed", amountRemaining: state.amountRemaining.toString(), expiresAt };
  }
  return {
    ...base,
    kind: "recurring",
    amountPerPeriod: state.amountPerPeriod.toString(),
    periodLengthSecs: Number(state.periodLengthSecs),
    currentPeriodStart: Number(state.currentPeriodStart),
    pulledInPeriod: state.pulledInPeriod.toString(),
    expiresAt,
  };
}

export type ChainSource = EventSource & {
  /** One poll: reads, stores and advances the cursor. Exposed for tests and tools. */
  pollOnce(sink: EventSink): Promise<{ processed: number }>;
  /**
   * Overwrites the projections with every account on-chain ("accounts give truth"), then polls;
   * if that poll found new transactions (their events were applied on top of accounts that may
   * already include them), it takes the snapshot again. Runs at start and after a start-over.
   */
  snapshot(sink: EventSink): Promise<void>;
  /** True until the first snapshot after a start or a start-over has been applied. */
  needsSnapshot(): boolean;
  /** Polls now instead of at the next interval. During a poll: once more, right after it. */
  poke(): void;
};

export function createChainSource(options: ChainSourceOptions): ChainSource {
  const { chain } = options;
  const programId = address(options.programId);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  /** Agent → principal: agent-level events don't carry it on-chain (02-contracts §6). */
  const principals = new Map<string, string>();
  let controller: AbortController | null = null;
  let running: Promise<void> | null = null;
  let wake: (() => void) | null = null;
  /** A poke that came while a poll was running: the next nap is skipped. */
  let poked = false;
  let caughtUpAt: number | null = null;
  /** Polls in a row whose failure came with an RPC that does not know the cursor. */
  let cursorMisses = 0;
  /** Polls in a row that failed. */
  let failures = 0;
  let snapshotDue = true;

  /** New transactions after the cursor, oldest first. */
  async function newSignatures(cursor: ChainCursor | null): Promise<SignatureInfo[]> {
    const cap = cursor ? options.backfillLimit * 10 : options.backfillLimit;
    const found: SignatureInfo[] = [];
    let before: string | undefined;
    while (found.length < cap) {
      const limit = Math.min(options.pageSize ?? 1_000, cap - found.length);
      const page = await chain.getSignatures(programId, {
        limit,
        ...(before ? { before } : {}),
        ...(cursor ? { until: cursor.signature } : {}),
      });
      found.push(...page);
      const last = page.at(-1);
      if (!last || page.length < limit) break;
      before = last.signature;
    }
    const oldest = found.at(-1);
    if (cursor && oldest && found.length >= cap) options.onGap?.(oldest.signature);
    return found.reverse();
  }

  function decode(record: Parameters<typeof decodeLeashEvents>[0]): LeashEvent[] {
    // Agents created in this transaction are known before its agent-level events are read.
    for (const event of decodeLeashEvents(record)) {
      if (event.type === "AgentCreated" && event.agent && event.principal) {
        principals.set(event.agent, event.principal);
      }
    }
    return decodeLeashEvents(record, { principalOf: (agent) => principals.get(agent) ?? null });
  }

  async function payeeEntries(events: readonly LeashEvent[]): Promise<PayeeEntryFact[]> {
    const facts: PayeeEntryFact[] = [];
    for (const event of events) {
      if (event.type !== "PayeeAdded" || !event.agent) continue;
      const entry = await findPayeePda(address(event.agent), address(event.payee));
      facts.push({ address: entry, agent: event.agent, payee: event.payee });
    }
    return facts;
  }

  /** The delegations funding `agents`, as they are on-chain now. */
  async function delegations(agents: Map<string, string | null>): Promise<DelegationRecord[]> {
    const records: DelegationRecord[] = [];
    for (const [agent, known] of agents) {
      const delegation = known ? address(known) : undefined;
      const view = await fetchAgentView(chain, address(agent), delegation ? { delegation } : {});
      if (view === null) continue;
      const decoded = await fetchAgentDelegation(
        chain,
        address(agent),
        { owner: address(view.owner), mint: address(view.mint) },
        delegation,
      );
      if (decoded) records.push(delegationRecord(decoded, agent));
    }
    return records;
  }

  /** True if the RPC answers that it does not have `cursor`'s transaction (not merely a failure). */
  async function unknownToChain(cursor: ChainCursor): Promise<boolean> {
    try {
      return (await chain.getTransactionRecord(cursor.signature)) === null;
    } catch {
      return false;
    }
  }

  async function pollOnce(sink: EventSink): Promise<{ processed: number }> {
    try {
      const result = await poll(sink);
      failures = 0;
      return result;
    } catch (error) {
      failures += 1;
      throw error;
    }
  }

  async function poll(sink: EventSink): Promise<{ processed: number }> {
    const cursor = await options.cursor.load();
    let fresh: SignatureInfo[];
    try {
      fresh = await newSignatures(cursor);
    } catch (error) {
      if (!cursor || !options.onForeignCursor || !(await unknownToChain(cursor))) {
        cursorMisses = 0;
        throw error;
      }
      cursorMisses += 1;
      if (cursorMisses < FOREIGN_CURSOR_MISSES) throw error;
      cursorMisses = 0;
      await options.onForeignCursor(cursor);
      principals.clear();
      caughtUpAt = null;
      snapshotDue = true;
      return { processed: 0 };
    }
    cursorMisses = 0;
    const touched = new Map<string, string | null>();
    let processed = 0;
    for (const info of fresh) {
      if (info.err === null) {
        const record = await chain.getTransactionRecord(info.signature);
        // Listed but not retrievable yet: stop here, the next poll continues from this one.
        if (record === null) break;
        const events = decode(record);
        if (events.length > 0) {
          const entries = await payeeEntries(events);
          if (entries.length > 0) await sink.accounts({ delegations: [], payeeEntries: entries });
          await sink.events(events);
          for (const event of events) {
            if (!event.agent) continue;
            if (event.type === "PaymentExecuted") touched.set(event.agent, event.delegation);
            else if (event.type === "AgentCreated" && !touched.has(event.agent)) {
              touched.set(event.agent, null);
            }
          }
        }
      }
      await options.cursor.save({ signature: info.signature, slot: Number(info.slot) });
      processed += 1;
    }
    if (touched.size > 0) {
      await sink.accounts({ delegations: await delegations(touched), payeeEntries: [] });
    }
    if (processed === fresh.length) caughtUpAt = now();
    return { processed };
  }

  /** Every Leash account now, with the delegations of every agent. */
  async function readSnapshot(): Promise<AccountSnapshot> {
    const known = new Map(
      ((await options.knownAgents?.()) ?? []).map(({ agent, delegation }) => [agent, delegation]),
    );
    const snapshot: AccountSnapshot = {
      principals: await fetchPrincipalViews(chain),
      agents: [],
      payees: [],
      requests: [],
      delegations: [],
    };
    // The cluster's time, for the allowances (read once, and only if there is anything to read).
    const now = snapshot.principals.length > 0 ? await readChainTime(chain) : 0n;
    for (const principal of snapshot.principals) {
      const agents = await fetchAgentViews(chain, address(principal.owner), { now });
      for (const agent of agents) {
        principals.set(agent.address, agent.principal);
        snapshot.agents.push(agent);
        snapshot.payees.push(...(await fetchPayees(chain, address(agent.address))));
        snapshot.requests.push(...(await fetchOpenRequests(chain, address(agent.address))));
      }
    }
    const funding = new Map(
      snapshot.agents.map((agent) => [agent.address, known.get(agent.address) ?? null]),
    );
    snapshot.delegations = await delegations(funding);
    return snapshot;
  }

  async function snapshot(sink: EventSink): Promise<void> {
    for (let round = 1; round <= SNAPSHOT_ROUNDS; round++) {
      const accounts = await readSnapshot();
      await sink.snapshot(accounts);
      snapshotDue = false;
      const { processed } = await pollOnce(sink);
      if (processed === 0 || round === SNAPSHOT_ROUNDS) {
        options.onSnapshot?.({
          principals: accounts.principals.length,
          agents: accounts.agents.length,
          rounds: round,
        });
        return;
      }
    }
  }

  /** At start: the principals and delegations of the agents the database already knows. */
  async function reconcile(sink: EventSink): Promise<void> {
    const known = (await options.knownAgents?.()) ?? [];
    for (const { agent, principal } of known) if (principal) principals.set(agent, principal);
    if (known.length === 0) return;
    const agents = new Map(known.map(({ agent, delegation }) => [agent, delegation]));
    await sink.accounts({ delegations: await delegations(agents), payeeEntries: [] });
  }

  function nap(ms: number, signal: AbortSignal): Promise<void> {
    if (poked) {
      poked = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        wake = null;
        resolve();
      }
      wake = done;
      signal.addEventListener("abort", done, { once: true });
    });
  }

  return {
    kind: "chain",
    pollOnce,
    snapshot,
    needsSnapshot: () => snapshotDue,
    healthy: () => failures < UNHEALTHY_AFTER_FAILURES,
    poke: () => {
      if (wake) wake();
      else poked = true;
    },
    async start(sink) {
      const abort = new AbortController();
      controller = abort;
      poked = false;
      const report = options.onError ?? ((error: unknown) => Promise.reject(error));
      running = (async () => {
        try {
          await reconcile(sink);
        } catch (error) {
          await report(error);
        }
        while (!abort.signal.aborted) {
          try {
            await pollOnce(sink);
            // After the catch-up poll of a start or a start-over: the accounts, as they are now.
            if (snapshotDue) await snapshot(sink);
          } catch (error) {
            await report(error);
          }
          if (!abort.signal.aborted) await nap(options.pollIntervalMs, abort.signal);
        }
      })();
    },
    async stop() {
      controller?.abort();
      await running?.catch(() => undefined);
    },
    lagSeconds: () => (caughtUpAt === null ? null : Math.max(0, now() - caughtUpAt)),
  };
}
