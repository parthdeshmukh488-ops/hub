import type { AgentView, LeashEvent, LeashEventType } from "@leash/contracts";

// How stream messages change what the UI holds. Pure, so the rules are unit-tested; `apply.ts`
// runs them against the query cache.

export type ActivityFilter = { agent?: string; types?: readonly LeashEventType[] };

/**
 * Inserts `event` into a newest-first list without duplicating its id (delivery is
 * at-least-once), keeping slot order: a later event of the same slot goes first.
 */
export function insertEvent<E extends LeashEvent>(list: readonly E[], event: E, limit = 200): E[] {
  if (list.some((e) => e.id === event.id)) return [...list];
  const index = list.findIndex((e) => e.slot <= event.slot);
  const next =
    index < 0 ? [...list, event] : [...list.slice(0, index), event, ...list.slice(index)];
  return next.slice(0, limit);
}

export function matchesFilter(event: LeashEvent, filter: ActivityFilter): boolean {
  if (filter.agent !== undefined && event.agent !== filter.agent) return false;
  return !filter.types || filter.types.length === 0 || filter.types.includes(event.type);
}

/** Replaces an agent by address, or adds it in creation order. */
export function upsertAgent(agents: readonly AgentView[], agent: AgentView): AgentView[] {
  if (agents.some((a) => a.address === agent.address)) {
    return agents.map((a) => (a.address === agent.address ? agent : a));
  }
  return [...agents, agent].sort((a, b) => a.createdAt - b.createdAt);
}

/** What to reload from REST after an event (the stream's `agent` message covers agent state). */
export type Refresh = { overview: boolean; requests: boolean; agents: string[] };

export function refreshFor(event: LeashEvent): Refresh {
  const agents = event.agent ? [event.agent] : [];
  switch (event.type) {
    case "PrincipalInitialized":
    case "GuardianChanged":
    case "PrincipalFrozen":
    case "PrincipalUnfrozen":
    case "AgentCreated":
    case "AgentClosed":
      return { overview: true, requests: false, agents };
    case "PayeeAdded":
    case "PayeeUpdated":
    case "PayeeRemoved":
      // Payee labels name events on the overview.
      return { overview: true, requests: false, agents };
    case "PaymentExecuted":
      return { overview: false, requests: event.requestNonce !== null, agents };
    case "PaymentRequested":
    case "RequestApproved":
    case "RequestRejected":
    case "RequestExpired":
      return { overview: false, requests: true, agents };
    case "PaymentDenied":
    case "AgentFrozen":
    case "AgentUnfrozen":
    case "PolicyUpdated":
      return { overview: false, requests: false, agents: [] };
  }
}
