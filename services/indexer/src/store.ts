import type {
  AgentDetailResponse,
  AgentView,
  EventsPageResponse,
  LeashEvent,
  OwnerOverviewResponse,
  RequestStatus,
  RequestsResponse,
  StatsView,
  StatsWindow,
} from "@leash/contracts";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max, or, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./db/client.ts";
import * as t from "./db/schema.ts";
import type { Logger } from "./logger.ts";
import { allowanceView } from "./projection/allowance.ts";
import {
  type ProjectionChanges,
  type ProjectionContext,
  ProjectionError,
  project,
} from "./projection/project.ts";
import type { AccountFacts, AgentRecord } from "./projection/records.ts";

export type SourceKind = "chain" | "fixtures";

/** An event as stored, with the owner it belongs to (for per-owner streams). */
export type StoredEvent = { event: LeashEvent; owner: string | null };

export type IngestResult = {
  /** Events that were new, in order. Duplicates are skipped silently. */
  inserted: StoredEvent[];
  /** Agents whose view changed, in the order they changed. */
  changedAgents: string[];
};

export type EventsFilter = {
  owner?: string;
  agent?: string;
  types?: readonly string[];
  before?: string;
  after?: string;
  limit: number;
};

const WINDOW_SECS: Record<StatsWindow, number> = { "1h": 3600, "24h": 86_400, "7d": 604_800 };

type Statement = BatchItem<"sqlite">;

/**
 * The indexer's only writer and its read model. Ingestion is sequential (the pipeline queues
 * it); each event is inserted together with its projection changes in one atomic batch.
 */
export type StoreOptions = {
  /**
   * Apply each `PaymentExecuted` to the stored delegation. Fixture mode needs it (the storyline
   * has no later account states). Chain mode turns it off: delegations come from the accounts,
   * which already include every payment, so applying events too would count them twice.
   */
  delegationsFromEvents?: boolean;
};

export class Store {
  private readonly delegationsFromEvents: boolean;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    options: StoreOptions = {},
  ) {
    this.delegationsFromEvents = options.delegationsFromEvents ?? true;
  }

  // ── Ownership and resets ──────────────────────────────────────────────────

  /**
   * Binds the database to a source. Fixture mode owns a disposable database: it refuses one
   * that holds chain data and starts every run from empty tables (ADR 20260930-ws4).
   */
  async claim(source: SourceKind): Promise<void> {
    const owners = await this.db.select({ source: t.cursors.source }).from(t.cursors);
    const other = owners.find((row) => row.source !== source);
    if (other) {
      throw new Error(
        `This database holds ${other.source} data; use another INDEXER_DB_URL for ${source} mode.`,
      );
    }
    if (source === "fixtures") await this.clear();
    await this.db
      .insert(t.cursors)
      .values({ source, lastSignature: null, lastSlot: null })
      .onConflictDoNothing();
  }

  /**
   * Empties everything and keeps the database bound to `source`: chain mode starting over when its
   * cursor belongs to another chain (a restarted localnet).
   */
  async startOver(source: SourceKind): Promise<void> {
    await this.clear();
    await this.db.insert(t.cursors).values({ source, lastSignature: null, lastSlot: null });
  }

  private async clear(): Promise<void> {
    await this.db.batch([
      this.db.delete(t.events),
      this.db.delete(t.cursors),
      ...this.projectionDeletes(),
    ]);
  }

  private projectionDeletes() {
    return [
      this.db.delete(t.principals),
      this.db.delete(t.agents),
      this.db.delete(t.payees),
      this.db.delete(t.requests),
      this.db.delete(t.allowances),
      this.db.delete(t.payeeEntries),
    ] as const;
  }

  /** Where `source` stopped, or null before its first transaction. */
  async cursor(source: SourceKind): Promise<{ signature: string; slot: number } | null> {
    const [row] = await this.db.select().from(t.cursors).where(eq(t.cursors.source, source));
    return row?.lastSignature != null && row.lastSlot != null
      ? { signature: row.lastSignature, slot: row.lastSlot }
      : null;
  }

  async saveCursor(source: SourceKind, cursor: { signature: string; slot: number }): Promise<void> {
    await this.db
      .insert(t.cursors)
      .values({ source, lastSignature: cursor.signature, lastSlot: cursor.slot })
      .onConflictDoUpdate({
        target: t.cursors.source,
        set: { lastSignature: cursor.signature, lastSlot: cursor.slot },
      });
  }

  /** Every stored agent with its principal and the delegation it was last paid from. */
  async knownAgents(): Promise<
    Array<{ agent: string; principal: string | null; delegation: string | null }>
  > {
    const rows = await this.db
      .select({
        address: t.agents.address,
        view: t.agents.view,
        delegation: t.allowances.delegation,
      })
      .from(t.agents)
      .leftJoin(t.allowances, eq(t.allowances.agent, t.agents.address));
    return rows.map((row) => ({
      agent: row.address,
      principal: row.view.principal,
      delegation: row.delegation,
    }));
  }

  /** Empties the projections and account facts but keeps the event history (replay loops). */
  async resetProjections(): Promise<void> {
    await this.db.batch([...this.projectionDeletes()]);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Stores account facts. Returns the agents whose allowance may have changed. */
  async applyAccounts(facts: AccountFacts): Promise<string[]> {
    const statements: Statement[] = [];
    for (const d of facts.delegations) {
      statements.push(
        this.db
          .insert(t.allowances)
          .values({ delegation: d.address, agent: d.agent, state: d })
          .onConflictDoUpdate({
            target: t.allowances.delegation,
            set: { agent: d.agent, state: d },
          }),
      );
    }
    for (const entry of facts.payeeEntries) {
      statements.push(
        this.db
          .insert(t.payeeEntries)
          .values(entry)
          .onConflictDoUpdate({ target: t.payeeEntries.address, set: entry }),
      );
    }
    await this.runBatch(statements);
    return [...new Set(facts.delegations.map((d) => d.agent))];
  }

  /** Inserts new events and applies them to the projections, one atomic batch per event. */
  async ingest(events: readonly LeashEvent[]): Promise<IngestResult> {
    const result: IngestResult = { inserted: [], changedAgents: [] };
    for (const event of events) {
      const [exists] = await this.db
        .select({ seq: t.events.seq })
        .from(t.events)
        .where(eq(t.events.id, event.id));
      if (exists) continue;

      const ctx = await this.context(event);
      let changes: ProjectionChanges = {};
      try {
        changes = project(event, ctx);
      } catch (error) {
        if (!(error instanceof ProjectionError)) throw error;
        // Keep the history; reconciliation (chain mode) or the next replay loop repairs views.
        this.log.error(
          { err: error, event: event.id, agent: event.agent },
          "event does not fit projections",
        );
      }
      const owner =
        changes.principal?.owner ??
        ctx.principal?.owner ??
        (event.type === "PrincipalInitialized" ? event.owner : null);

      await this.runBatch([
        this.db.insert(t.events).values({
          id: event.id,
          type: event.type,
          signature: event.signature,
          slot: event.slot,
          blockTime: event.blockTime,
          timestamp: event.timestamp,
          owner,
          principal: event.principal,
          agent: event.agent,
          payload: event,
        }),
        ...this.writes(changes, ctx, owner),
      ]);
      result.inserted.push({ event, owner });
      const touched = changes.agent !== undefined || changes.delegation !== undefined;
      if (touched && changes.agent !== null && event.agent) result.changedAgents.push(event.agent);
    }
    result.changedAgents = [...new Set(result.changedAgents)];
    return result;
  }

  private async runBatch(statements: Statement[]): Promise<void> {
    const [first, ...rest] = statements;
    if (first) await this.db.batch([first, ...rest]);
  }

  /** Loads the rows `event` can change. */
  private async context(event: LeashEvent): Promise<ProjectionContext> {
    const ctx: ProjectionContext = {
      principal: null,
      agent: null,
      payee: null,
      request: null,
      delegation: null,
      payeeEntryAddress: null,
    };
    if (event.principal) {
      const [row] = await this.db
        .select()
        .from(t.principals)
        .where(eq(t.principals.address, event.principal));
      ctx.principal = row?.view ?? null;
    }
    if (!event.agent) return ctx;
    const agent = event.agent;
    const [agentRow] = await this.db.select().from(t.agents).where(eq(t.agents.address, agent));
    ctx.agent = agentRow?.view ?? null;

    if ("payee" in event && event.type !== "PaymentRequested" && event.type !== "PaymentDenied") {
      const [row] = await this.db
        .select()
        .from(t.payees)
        .where(and(eq(t.payees.agent, agent), eq(t.payees.payee, event.payee)));
      ctx.payee = row?.view ?? null;
    }
    if (event.type === "PayeeAdded") {
      const [row] = await this.db
        .select()
        .from(t.payeeEntries)
        .where(and(eq(t.payeeEntries.agent, agent), eq(t.payeeEntries.payee, event.payee)));
      ctx.payeeEntryAddress = row?.address ?? null;
    }
    if (
      event.type === "RequestApproved" ||
      event.type === "RequestRejected" ||
      event.type === "RequestExpired"
    ) {
      const [row] = await this.db
        .select()
        .from(t.requests)
        .where(eq(t.requests.address, event.request));
      ctx.request = row?.view ?? null;
    }
    if (event.type === "PaymentExecuted") {
      if (event.requestNonce !== null) {
        const [row] = await this.db
          .select()
          .from(t.requests)
          .where(and(eq(t.requests.agent, agent), eq(t.requests.nonce, event.requestNonce)));
        ctx.request = row?.view ?? null;
      }
      if (this.delegationsFromEvents) {
        const [row] = await this.db
          .select()
          .from(t.allowances)
          .where(eq(t.allowances.delegation, event.delegation));
        ctx.delegation = row?.state ?? null;
      }
    }
    return ctx;
  }

  private writes(
    changes: ProjectionChanges,
    ctx: ProjectionContext,
    owner: string | null,
  ): Statement[] {
    const out: Statement[] = [];
    const { principal, agent, payee, request, delegation } = changes;
    if (principal) {
      const row = {
        address: principal.address,
        owner: principal.owner,
        guardian: principal.guardian,
        view: principal,
      };
      // A replay loop re-initializes the same owner: replace any row for this owner first.
      out.push(this.db.delete(t.principals).where(eq(t.principals.owner, principal.owner)));
      out.push(this.db.insert(t.principals).values(row));
    }
    if (agent === null && ctx.agent) {
      out.push(this.db.delete(t.agents).where(eq(t.agents.address, ctx.agent.address)));
    } else if (agent) {
      out.push(
        this.db
          .insert(t.agents)
          .values({ address: agent.address, owner: agent.owner, view: agent })
          .onConflictDoUpdate({
            target: t.agents.address,
            set: { owner: agent.owner, view: agent },
          }),
      );
    }
    if (payee === null && ctx.payee) {
      out.push(this.db.delete(t.payees).where(eq(t.payees.address, ctx.payee.address)));
    } else if (payee) {
      out.push(
        this.db
          .insert(t.payees)
          .values({ address: payee.address, agent: payee.agent, payee: payee.payee, view: payee })
          .onConflictDoUpdate({ target: t.payees.address, set: { view: payee } }),
      );
    }
    if (request === null && ctx.request) {
      out.push(this.db.delete(t.requests).where(eq(t.requests.address, ctx.request.address)));
    } else if (request && owner) {
      const row = {
        address: request.address,
        agent: request.agent,
        owner,
        nonce: request.nonce,
        status: request.status,
        view: request,
      };
      out.push(
        this.db
          .insert(t.requests)
          .values(row)
          .onConflictDoUpdate({
            target: t.requests.address,
            set: { status: row.status, view: request },
          }),
      );
    }
    if (delegation) {
      out.push(
        this.db
          .update(t.allowances)
          .set({ state: delegation })
          .where(eq(t.allowances.delegation, delegation.address)),
      );
    }
    return out;
  }

  // ── Reads (02-contracts §7.1) ─────────────────────────────────────────────

  private async withAllowance(record: AgentRecord, now: number): Promise<AgentView> {
    const [row] = await this.db
      .select()
      .from(t.allowances)
      .where(eq(t.allowances.agent, record.address))
      .limit(1);
    return { ...record, allowance: row ? allowanceView(row.state, now) : null };
  }

  async agentView(address: string, now: number): Promise<AgentView | null> {
    const [row] = await this.db.select().from(t.agents).where(eq(t.agents.address, address));
    return row ? this.withAllowance(row.view, now) : null;
  }

  async ownerOverview(owner: string, now: number): Promise<OwnerOverviewResponse> {
    const [principal] = await this.db
      .select()
      .from(t.principals)
      .where(eq(t.principals.owner, owner));
    const rows = await this.db.select().from(t.agents).where(eq(t.agents.owner, owner));
    const records = rows.map((row) => row.view).sort(byCreation);
    return {
      principal: principal?.view ?? null,
      agents: await Promise.all(records.map((record) => this.withAllowance(record, now))),
    };
  }

  async agentDetail(address: string, now: number): Promise<AgentDetailResponse | null> {
    const agent = await this.agentView(address, now);
    if (!agent) return null;
    const payees = await this.db.select().from(t.payees).where(eq(t.payees.agent, address));
    const requests = await this.db.select().from(t.requests).where(eq(t.requests.agent, address));
    return {
      agent,
      payees: payees.map((row) => row.view).sort(byCreation),
      requests: requests.map((row) => row.view).sort(byCreation),
    };
  }

  async requests(owner: string, status?: RequestStatus): Promise<RequestsResponse> {
    const rows = await this.db
      .select()
      .from(t.requests)
      .where(and(eq(t.requests.owner, owner), status ? eq(t.requests.status, status) : undefined));
    return { items: rows.map((row) => row.view).sort(byCreation) };
  }

  async guardianOwners(guardian: string): Promise<string[]> {
    const rows = await this.db
      .select({ owner: t.principals.owner })
      .from(t.principals)
      .where(eq(t.principals.guardian, guardian));
    return rows.map((row) => row.owner).sort();
  }

  /**
   * A page of events. `before` (and no cursor) pages backwards, newest first; `after` returns
   * newer events oldest first, for filling a gap after a reconnect. Returns null for an unknown
   * cursor, so a client knows to reload instead of trusting a gap-free history.
   */
  async events(filter: EventsFilter): Promise<EventsPageResponse | null> {
    const cursorId = filter.before ?? filter.after;
    let cursor: { slot: number; seq: number } | undefined;
    if (cursorId !== undefined) {
      [cursor] = await this.db
        .select({ slot: t.events.slot, seq: t.events.seq })
        .from(t.events)
        .where(eq(t.events.id, cursorId));
      if (!cursor) return null;
    }
    const ascending = filter.after !== undefined;
    const position: SQL | undefined = cursor
      ? ascending
        ? or(
            gt(t.events.slot, cursor.slot),
            and(eq(t.events.slot, cursor.slot), gt(t.events.seq, cursor.seq)),
          )
        : or(
            lt(t.events.slot, cursor.slot),
            and(eq(t.events.slot, cursor.slot), lt(t.events.seq, cursor.seq)),
          )
      : undefined;
    const rows = await this.db
      .select({ payload: t.events.payload })
      .from(t.events)
      .where(
        and(
          filter.owner ? eq(t.events.owner, filter.owner) : undefined,
          filter.agent ? eq(t.events.agent, filter.agent) : undefined,
          filter.types && filter.types.length > 0
            ? inArray(t.events.type, [...filter.types])
            : undefined,
          position,
        ),
      )
      .orderBy(
        ...(ascending
          ? [asc(t.events.slot), asc(t.events.seq)]
          : [desc(t.events.slot), desc(t.events.seq)]),
      )
      .limit(filter.limit + 1);
    const items = rows.slice(0, filter.limit).map((row) => row.payload);
    const more = rows.length > filter.limit;
    return { items, nextBefore: more && !ascending ? (items.at(-1)?.id ?? null) : null };
  }

  /** Activity in the window before `now`, summed with bigint (02-contracts §5 `StatsView`). */
  async stats(owner: string, window: StatsWindow, now: number): Promise<StatsView> {
    const rows = await this.db
      .select({ payload: t.events.payload })
      .from(t.events)
      .where(
        and(
          eq(t.events.owner, owner),
          inArray(t.events.type, ["PaymentExecuted", "PaymentDenied"]),
          gte(t.events.timestamp, now - WINDOW_SECS[window]),
          lte(t.events.timestamp, now),
        ),
      )
      .orderBy(asc(t.events.slot), asc(t.events.seq));
    const agentRows = await this.db.select().from(t.agents).where(eq(t.agents.owner, owner));
    const agentRecords = agentRows.map((row) => row.view).sort(byCreation);
    const payeeRows = agentRecords.length
      ? await this.db
          .select()
          .from(t.payees)
          .where(
            inArray(
              t.payees.agent,
              agentRecords.map((agent) => agent.address),
            ),
          )
      : [];

    const totals = { paid: 0n, payments: 0, denied: 0, strikes: 0 };
    const byAgent = new Map(
      agentRecords.map((a) => [a.address, { label: a.label, paid: 0n, payments: 0, denied: 0 }]),
    );
    const byPayee = new Map<string, { paid: bigint; payments: number }>();
    for (const { payload: event } of rows) {
      const agent = event.agent ? byAgent.get(event.agent) : undefined;
      if (event.type === "PaymentExecuted") {
        const amount = BigInt(event.amount);
        totals.paid += amount;
        totals.payments += 1;
        if (agent) {
          agent.paid += amount;
          agent.payments += 1;
        }
        const payee = byPayee.get(event.payee) ?? { paid: 0n, payments: 0 };
        byPayee.set(event.payee, { paid: payee.paid + amount, payments: payee.payments + 1 });
      } else if (event.type === "PaymentDenied") {
        totals.denied += 1;
        if (event.strike) totals.strikes += 1;
        if (agent) agent.denied += 1;
      }
    }
    const labels = new Map(payeeRows.map((row) => [row.payee, row.view.label]));
    const byPaid = (
      a: { paid: bigint; payments: number },
      b: { paid: bigint; payments: number },
    ) => (a.paid === b.paid ? b.payments - a.payments : a.paid > b.paid ? -1 : 1);

    return {
      window,
      totals: {
        paid: totals.paid.toString(),
        payments: totals.payments,
        denied: totals.denied,
        strikes: totals.strikes,
        frozenAgents: agentRecords.filter((agent) => agent.status === "frozen").length,
      },
      byAgent: [...byAgent.entries()]
        .map(([agent, s]) => ({ agent, ...s }))
        .sort(byPaid)
        .map(({ agent, label, paid, payments, denied }) => ({
          agent,
          label,
          paid: paid.toString(),
          payments,
          denied,
        })),
      byPayee: [...byPayee.entries()]
        .map(([payee, s]) => ({ payee, ...s }))
        .sort(byPaid)
        .map(({ payee, paid, payments }) => ({
          payee,
          label: labels.get(payee) ?? null,
          paid: paid.toString(),
          payments,
        })),
    };
  }

  /** The newest ingested slot and event time, for `/v1/health`. */
  async progress(): Promise<{ lastProcessedSlot: number | null; lastEventAt: number | null }> {
    const [row] = await this.db
      .select({ slot: max(t.events.slot), at: max(t.events.timestamp) })
      .from(t.events);
    return { lastProcessedSlot: row?.slot ?? null, lastEventAt: row?.at ?? null };
  }

  /** Cheap query that fails if the database is unreachable. */
  async ping(): Promise<void> {
    await this.db.run(sql`select 1`);
  }
}

function byCreation<T extends { createdAt: number }>(a: T, b: T): number {
  return a.createdAt - b.createdAt;
}
