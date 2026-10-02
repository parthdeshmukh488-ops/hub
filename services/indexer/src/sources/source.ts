import type { LeashEvent } from "@leash/contracts";
import type { AccountFacts, AccountSnapshot } from "../projection/records.ts";

/** Where a source delivers what it reads. Calls are awaited in order. */
export interface EventSink {
  /** Account state the events do not carry (delegations, allowlist entry addresses). */
  accounts(facts: AccountFacts): Promise<void>;
  /** Events in chain order. Delivering an event twice is harmless. */
  events(events: LeashEvent[]): Promise<void>;
  /** Drops the projections, keeping the history (a replay starting over). */
  resetProjections(): Promise<void>;
  /** Overwrites the projections with every account as the chain holds it (chain mode). */
  snapshot(snapshot: AccountSnapshot): Promise<void>;
}

/** A source of Leash events, selected by `INDEXER_SOURCE` (WS4 brief). */
export interface EventSource {
  readonly kind: "chain" | "fixtures";
  /** Starts delivering. Resolves once the source runs; delivery continues in the background. */
  start(sink: EventSink): Promise<void>;
  /** Stops delivering and waits for the current delivery to finish. */
  stop(): Promise<void>;
  /** How far behind the chain the source is, in seconds (null when unknown). */
  lagSeconds(): number | null;
  /**
   * False while the source cannot make progress: three polls in a row failed (chain mode), or
   * the replay failed (fixture mode). `/v1/health` reports it as `ok`.
   */
  healthy(): boolean;
}
