import type { AgentView, LeashEvent, StreamServerMessage } from "@leash/contracts";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { AgentDetail, EventsPage, Overview } from "../data/source.ts";
import {
  type ActivityFilter,
  insertEvent,
  matchesFilter,
  refreshFor,
  upsertAgent,
} from "./merge.ts";

/** Query keys of everything the app caches, per owner. */
export const queryKeys = {
  owner: (owner: string) => [owner] as const,
  overview: (owner: string) => [owner, "overview"] as const,
  agent: (owner: string, address: string) => [owner, "agent", address] as const,
  activity: (owner: string) => [owner, "activity"] as const,
  activityFor: (owner: string, filter: ActivityFilter) => [owner, "activity", filter] as const,
  requests: (owner: string) => [owner, "requests"] as const,
};

function applyEvent(client: QueryClient, owner: string, event: LeashEvent): void {
  for (const [key, data] of client.getQueriesData<InfiniteData<EventsPage>>({
    queryKey: queryKeys.activity(owner),
  })) {
    const filter = (key[2] ?? {}) as ActivityFilter;
    const [first, ...rest] = data?.pages ?? [];
    if (!data || !first || !matchesFilter(event, filter)) continue;
    client.setQueryData(key, {
      ...data,
      pages: [{ ...first, items: insertEvent(first.items, event) }, ...rest],
    });
  }
  if (event.agent) {
    client.setQueryData<AgentDetail | null>(queryKeys.agent(owner, event.agent), (detail) =>
      detail ? { ...detail, events: insertEvent(detail.events, event, 50) } : detail,
    );
  }
  if (event.type === "PaymentDenied") {
    client.setQueryData<Overview>(queryKeys.overview(owner), (overview) =>
      overview
        ? { ...overview, recentBlocked: insertEvent(overview.recentBlocked, event, 10) }
        : overview,
    );
  }
  const refresh = refreshFor(event);
  if (refresh.overview) void client.invalidateQueries({ queryKey: queryKeys.overview(owner) });
  if (refresh.requests) void client.invalidateQueries({ queryKey: queryKeys.requests(owner) });
  for (const agent of refresh.agents) {
    void client.invalidateQueries({ queryKey: queryKeys.agent(owner, agent) });
  }
}

function applyAgent(client: QueryClient, owner: string, agent: AgentView): void {
  client.setQueryData<Overview>(queryKeys.overview(owner), (overview) =>
    overview
      ? {
          ...overview,
          agents: upsertAgent(overview.agents, agent),
          names: new Map(overview.names).set(agent.address, agent.label),
        }
      : overview,
  );
  client.setQueryData<AgentDetail | null>(queryKeys.agent(owner, agent.address), (detail) =>
    detail ? { ...detail, agent } : detail,
  );
}

/** Applies one stream message to the cache (02-contracts §7.2). */
export function applyMessage(
  client: QueryClient,
  owner: string,
  message: StreamServerMessage,
): void {
  if (message.type === "event") applyEvent(client, owner, message.event);
  else if (message.type === "agent") applyAgent(client, owner, message.agent);
}

/** After a reconnect: reload the views (events come from the backfill). */
export function resync(client: QueryClient, owner: string): void {
  void client.invalidateQueries({
    queryKey: queryKeys.owner(owner),
    predicate: (query) => query.queryKey[1] !== "activity",
  });
}

/** The history was reset (unknown cursor): reload everything. */
export function reload(client: QueryClient, owner: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.owner(owner) });
}
