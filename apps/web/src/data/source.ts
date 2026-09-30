import type {
  AgentView,
  LeashEvent,
  LeashEventOf,
  LeashEventType,
  PrincipalView,
  RequestView,
} from "@leash/contracts";
import type { PayeeRow } from "../lib/payees.ts";

export type PaymentDeniedEvent = LeashEventOf<"PaymentDenied">;

export type EventsFilter = {
  agent?: string;
  types?: readonly LeashEventType[];
  /** Page backwards from this event id (exclusive). */
  before?: string;
  limit?: number;
};

export type EventsPage = { items: LeashEvent[]; nextBefore: string | null };

/**
 * Where the UI reads from: the fixtures (no backend) or the indexer (REST for loads, the
 * WebSocket stream for updates, see `src/live`). Screens only see this interface.
 */
export interface LeashDataSource {
  readonly kind: "fixtures" | "indexer";
  /** Unix seconds. Fixtures use their snapshot time so relative times read as in the demo. */
  now(): number;
  overview(owner: string): Promise<Overview>;
  agent(owner: string, address: string): Promise<AgentDetail | null>;
  /** Newest first. */
  events(owner: string, filter: EventsFilter): Promise<EventsPage>;
  /** Events after `afterId`, oldest first; null if that id is unknown (the history was reset). */
  eventsAfter(owner: string, afterId: string): Promise<LeashEvent[] | null>;
  /** Open payment requests, oldest first. */
  requests(owner: string): Promise<RequestView[]>;
}

export type Overview = {
  principal: PrincipalView | null;
  agents: AgentView[];
  /** Newest first. */
  recentBlocked: PaymentDeniedEvent[];
  /** Agent and payee labels by address, for event descriptions. */
  names: ReadonlyMap<string, string>;
};

export type AgentDetail = {
  principalFrozen: boolean;
  agent: AgentView;
  payees: PayeeRow[];
  requests: RequestView[];
  /** This agent's latest events, newest first. */
  events: LeashEvent[];
  names: ReadonlyMap<string, string>;
};
