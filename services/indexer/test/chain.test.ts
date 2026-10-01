import { LeashEventSchema } from "@leash/contracts";
import {
  buildApproveRequest,
  buildFreezeAgent,
  fetchAgentViews,
  fetchOpenRequests,
  fetchPayees,
  fetchPrincipalView,
  LEASH_PROGRAM_ADDRESS,
  LeashAgent,
  type LeashChain,
  PaymentDeniedError,
  readChainTime,
} from "@leash/sdk";
import { createTestbed, type Testbed, USDC } from "@leash/sdk/testing";
import { address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.ts";
import { createPipeline } from "../src/pipeline.ts";
import { type ChainSourceOptions, createChainSource } from "../src/sources/chain.ts";
import { Store } from "../src/store.ts";
import { log, testStore } from "./helpers.ts";

// Chain mode on the real program: LiteSVM produces the transactions, the SDK's chain port pages
// them like getSignaturesForAddress, and the indexer's views must equal what the SDK reads from
// the accounts themselves ("events give history; accounts give truth").

async function world() {
  const bed = await createTestbed();
  const agent = new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: () => {} },
  });
  // Chain mode: delegations come from the accounts only.
  const { store, url } = await testStore({ delegationsFromEvents: false });
  await store.claim("chain");
  return { bed, agent, store, url };
}

function sourceFor(bed: Testbed, store: Store, overrides: Partial<ChainSourceOptions> = {}) {
  return createChainSource({
    chain: bed.chain,
    programId: LEASH_PROGRAM_ADDRESS,
    cursor: { load: () => store.cursor("chain"), save: (c) => store.saveCursor("chain", c) },
    knownAgents: () => store.knownAgents(),
    pollIntervalMs: 60_000,
    backfillLimit: 1_000,
    now: () => Number(bed.now()),
    ...overrides,
  });
}

const sinkOf = (bed: Testbed, store: Store) =>
  createPipeline(store, null, () => Number(bed.now()), log);

const pay = (agent: LeashAgent, bed: Testbed, amount: bigint) =>
  agent.pay({ to: bed.keys.merchant.address, amount, purpose: `Research ${amount}` });

async function blocked(agent: LeashAgent, bed: Testbed) {
  const error = await agent
    .pay({ to: bed.keys.attacker.address, amount: 25n * USDC, purpose: "Author tip" })
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(error).toBeInstanceOf(PaymentDeniedError);
}

/** Every event the store holds for the owner, oldest first. */
async function feed(store: Store, owner: string) {
  const page = await store.events({ owner, limit: 500 });
  return (page?.items ?? []).slice().reverse();
}

describe("chain mode", () => {
  it("ingests the program's transactions: every view equals what the SDK reads from the accounts", async () => {
    const { bed, agent, store } = await world();
    await pay(agent, bed, 10_000n);
    await pay(agent, bed, 20_000n);
    await blocked(agent, bed);
    const request = await agent.requestApproval({
      to: bed.keys.merchant.address,
      amount: 1_500_000n,
      purpose: "Premium report",
    });
    await bed.send(bed.keys.owner, [
      await buildApproveRequest({
        owner: bed.keys.owner,
        agent: bed.accounts.agent,
        request: address(request.address),
      }),
    ]);

    const source = sourceFor(bed, store);
    expect(await source.pollOnce(sinkOf(bed, store))).toEqual({ processed: 6 });

    const owner = bed.keys.owner.address;
    const now = await readChainTime(bed.chain);
    const overview = await store.ownerOverview(owner, Number(now));
    expect(overview.principal).toEqual(await fetchPrincipalView(bed.chain, owner));
    expect(overview.agents).toEqual(await fetchAgentViews(bed.chain, owner, { now }));
    expect(overview.agents[0]?.allowance?.remaining).toBe((5n * USDC - 30_000n).toString());
    const detail = await store.agentDetail(bed.accounts.agent, Number(now));
    expect(detail?.payees).toEqual(await fetchPayees(bed.chain, bed.accounts.agent));
    expect(detail?.requests).toEqual(await fetchOpenRequests(bed.chain, bed.accounts.agent));

    // The owner's feed holds every event in chain order, the agent-level ones included: their
    // principal comes from the AgentCreated the source saw. Each is in the contract's shape.
    const events = await feed(store, owner);
    expect(events.map((e) => e.type)).toEqual([
      "PrincipalInitialized",
      "AgentCreated",
      "PayeeAdded",
      "PaymentExecuted",
      "PaymentExecuted",
      "PaymentDenied",
      "PaymentRequested",
      "RequestApproved",
    ]);
    for (const event of events) expect(LeashEventSchema.parse(event)).toEqual(event);
    expect(events.find((e) => e.type === "PayeeAdded")?.principal).toBe(bed.accounts.principal);
    expect(await store.cursor("chain")).toMatchObject({
      signature: bed.chain.history.at(-1)?.signature,
    });
    expect(await source.pollOnce(sinkOf(bed, store))).toEqual({ processed: 0 });
  });

  it("survives a crash between storing a transaction and saving the cursor: nothing lost, nothing twice", async () => {
    const { bed, agent, store, url } = await world();
    await pay(agent, bed, 10_000n);
    await pay(agent, bed, 20_000n);
    let saves = 0;
    const crashing = sourceFor(bed, store, {
      cursor: {
        load: () => store.cursor("chain"),
        save: async (cursor) => {
          saves += 1;
          // The process dies right after the second transaction's events are stored.
          if (saves === 2) throw new Error("killed");
          await store.saveCursor("chain", cursor);
        },
      },
    });
    await expect(crashing.pollOnce(sinkOf(bed, store))).rejects.toThrow("killed");

    // A new process on the same database file: it reads that transaction again and skips the
    // events it already holds.
    const reopened = await openDatabase(url);
    const restarted = new Store(reopened.db, log, { delegationsFromEvents: false });
    await restarted.claim("chain");
    await freezeAgent(bed);
    const source = sourceFor(bed, restarted);
    await source.start(sinkOf(bed, restarted));
    await vi.waitFor(async () =>
      expect(await restarted.cursor("chain")).toMatchObject({
        signature: bed.chain.history.at(-1)?.signature,
      }),
    );
    await source.stop();
    const events = await feed(restarted, bed.keys.owner.address);
    expect(events.map((e) => e.type)).toEqual([
      "PrincipalInitialized",
      "AgentCreated",
      "PayeeAdded",
      "PaymentExecuted",
      "PaymentExecuted",
      "AgentFrozen",
    ]);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    // The freeze is an agent-level event: its principal comes from the agents the database knew.
    expect(events.at(-1)?.principal).toBe(bed.accounts.principal);
    const [view] = (await restarted.ownerOverview(bed.keys.owner.address, Number(bed.now())))
      .agents;
    expect(view).toMatchObject({ status: "frozen", freezeReason: "owner" });
    expect(view?.allowance?.remaining).toBe((5n * USDC - 30_000n).toString());
    reopened.close();
  });

  it("pages through history, and reads at most the backfill limit on a first start", async () => {
    const { bed, agent, store } = await world();
    for (const amount of [1n, 2n, 3n, 4n]) await pay(agent, bed, amount);
    // 5 transactions (onboarding + 4 payments), read 2 per page, at most 3 on a first start.
    const getSignatures = vi.spyOn(bed.chain, "getSignatures");
    const first = sourceFor(bed, store, { backfillLimit: 3, pageSize: 2 });
    expect(await first.pollOnce(sinkOf(bed, store))).toEqual({ processed: 3 });
    expect(getSignatures.mock.calls.map(([, page]) => page)).toEqual([
      { limit: 2 },
      { limit: 1, before: expect.any(String) },
    ]);
    // The window starts after onboarding, so these events have no known principal or owner yet
    // (a snapshot of the accounts is build step 4); by agent, they are all there.
    const page = await store.events({ agent: bed.accounts.agent, limit: 50 });
    const amounts = (page?.items ?? [])
      .flatMap((e) => (e.type === "PaymentExecuted" ? [e.amount] : []))
      .reverse();
    expect(amounts).toEqual(["2", "3", "4"]);
    // From the cursor on, every new transaction, across pages.
    for (const amount of [5n, 6n, 7n]) await pay(agent, bed, amount);
    getSignatures.mockClear();
    expect(await first.pollOnce(sinkOf(bed, store))).toEqual({ processed: 3 });
    expect(getSignatures.mock.calls.map(([, page]) => page)).toEqual([
      { limit: 2, until: expect.any(String) },
      { limit: 2, before: expect.any(String), until: expect.any(String) },
    ]);
  });

  it("moves past failed transactions, and waits for one the node cannot return yet", async () => {
    const { bed, agent, store } = await world();
    await pay(agent, bed, 10_000n);
    const [newest, onboarding] = await bed.chain.getSignatures(LEASH_PROGRAM_ADDRESS, { limit: 2 });
    if (!newest || !onboarding) throw new Error("expected two transactions");
    const failed = {
      signature: "1".repeat(64),
      slot: 1n,
      err: { InstructionError: [0, "X"] },
      blockTime: null,
    };
    let ready = false;
    const chain: LeashChain = {
      ...bed.chain,
      getSignatures: async () => [newest, failed, onboarding],
      getTransactionRecord: async (signature) =>
        signature === newest.signature && !ready ? null : bed.chain.getTransactionRecord(signature),
    };
    const getRecord = vi.spyOn(chain, "getTransactionRecord");
    const source = sourceFor(bed, store, { chain });
    // The failed one is passed without being fetched; the newest is listed but not retrievable.
    expect(await source.pollOnce(sinkOf(bed, store))).toEqual({ processed: 2 });
    expect(getRecord.mock.calls.map(([signature]) => signature)).toEqual([
      onboarding.signature,
      newest.signature,
    ]);
    expect(await store.cursor("chain")).toMatchObject({ signature: failed.signature });
    expect(source.lagSeconds()).toBeNull();
    ready = true;
    chain.getSignatures = async () => [newest];
    expect(await source.pollOnce(sinkOf(bed, store))).toEqual({ processed: 1 });
    expect(source.lagSeconds()).toBe(0);
    const types = (await feed(store, bed.keys.owner.address)).map((e) => e.type);
    expect(types.filter((t) => t === "PaymentExecuted")).toHaveLength(1);
  });

  it("polls in the background: at start, on poke, after failures, until stopped", async () => {
    const { bed, agent, store } = await world();
    const errors: unknown[] = [];
    let failNext = false;
    const chain: LeashChain = {
      ...bed.chain,
      getSignatures: async (address, page) => {
        if (failNext) {
          failNext = false;
          throw new Error("rpc down");
        }
        return bed.chain.getSignatures(address, page);
      },
    };
    const source = sourceFor(bed, store, { chain, onError: (error) => errors.push(error) });
    expect(source.kind).toBe("chain");
    await source.start(sinkOf(bed, store));
    const latest = () => store.cursor("chain").then((c) => c?.signature);
    await vi.waitFor(async () => expect(await latest()).toBe(bed.chain.history.at(-1)?.signature));

    failNext = true;
    source.poke();
    await vi.waitFor(() => expect(errors).toEqual([new Error("rpc down")]));
    await pay(agent, bed, 10_000n);
    source.poke();
    await vi.waitFor(async () => expect(await latest()).toBe(bed.chain.history.at(-1)?.signature));
    await source.stop();
    source.poke();
    expect(source.lagSeconds()).toBe(0);
  });

  it("polls once more after a poke that came during a poll", async () => {
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The first poll hangs in getSignatures until released; nothing else is read.
    const chain = {
      getSignatures: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return [];
      },
    } as unknown as LeashChain;
    const source = createChainSource({
      chain,
      programId: LEASH_PROGRAM_ADDRESS,
      cursor: { load: async () => null, save: async () => {} },
      pollIntervalMs: 60_000,
      backfillLimit: 10,
    });
    await source.start({
      accounts: async () => {},
      events: async () => {},
      resetProjections: async () => {},
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    source.poke();
    release();
    // Without the remembered poke, the next poll would come 60 s later.
    await vi.waitFor(() => expect(calls).toBe(2));
    await source.stop();
  });
});

/** The owner freezes the agent. */
async function freezeAgent(bed: Testbed) {
  await bed.send(bed.keys.owner, [
    await buildFreezeAgent({
      authority: bed.keys.owner,
      owner: bed.keys.owner.address,
      agent: bed.accounts.agent,
    }),
  ]);
}
