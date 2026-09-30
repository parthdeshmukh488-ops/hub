import {
  AgentDetailResponseSchema,
  DemoStorylineSchema,
  type LeashEvent,
  OwnerOverviewResponseSchema,
  RequestsResponseSchema,
} from "@leash/contracts";
import agentDetailJson from "@leash/contracts/fixtures/agent-detail.json";
import storylineJson from "@leash/contracts/fixtures/demo-storyline.json";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import requestsJson from "@leash/contracts/fixtures/requests.json";
import { nameBookFrom } from "../lib/events.ts";
import { payeeRowFromView, payeeRowsFromEvents } from "../lib/payees.ts";
import type { AgentDetail, EventsPage, LeashDataSource, Overview, PaymentDeniedEvent } from "./source.ts";

/**
 * The demo storyline from `@leash/contracts/fixtures`, validated with the same schemas the
 * indexer's responses use. No network, no chain: the whole UI can be built and reviewed before
 * either exists.
 */
export function createFixtureSource(): LeashDataSource {
  const overview = OwnerOverviewResponseSchema.parse(overviewJson);
  const detail = AgentDetailResponseSchema.parse(agentDetailJson);
  const requests = RequestsResponseSchema.parse(requestsJson).items;
  const storyline = DemoStorylineSchema.parse(storylineJson);

  const oldestFirst = storyline.events;
  const newestFirst = [...oldestFirst].reverse();
  const names = nameBookFrom(oldestFirst);
  const now = Math.max(
    ...overview.agents.map((agent) => agent.allowance?.asOf ?? 0),
    ...oldestFirst.map((event) => event.timestamp),
  );
  const owner = overview.principal?.owner;
  const principalFrozen = overview.principal?.frozen ?? false;
  const isDenied = (event: LeashEvent): event is PaymentDeniedEvent => event.type === "PaymentDenied";
  const empty: Overview = { principal: null, agents: [], recentBlocked: [], names };

  return {
    kind: "fixtures",
    now: () => now,
    overview: async (who) =>
      who !== owner
        ? empty
        : { principal: overview.principal, agents: overview.agents, recentBlocked: newestFirst.filter(isDenied), names },
    agent: async (who, address): Promise<AgentDetail | null> => {
      const agent = overview.agents.find((candidate) => candidate.address === address);
      if (who !== owner || !agent) return null;
      return {
        principalFrozen,
        agent,
        payees:
          detail.agent.address === address
            ? detail.payees.map(payeeRowFromView)
            : payeeRowsFromEvents(address, oldestFirst, now),
        requests: requests.filter((request) => request.agent === address),
        events: newestFirst.filter((event) => event.agent === address),
        names,
      };
    },
    events: async (who, filter): Promise<EventsPage> => {
      if (who !== owner) return { items: [], nextBefore: null };
      const limit = filter.limit ?? 50;
      const start = filter.before === undefined ? 0 : newestFirst.findIndex((e) => e.id === filter.before) + 1;
      const matching = newestFirst
        .slice(start)
        .filter((e) => (filter.agent === undefined || e.agent === filter.agent) && (!filter.types || filter.types.includes(e.type)));
      const items = matching.slice(0, limit);
      return { items, nextBefore: matching.length > limit ? (items.at(-1)?.id ?? null) : null };
    },
    eventsAfter: async (who, afterId) => {
      const index = oldestFirst.findIndex((e) => e.id === afterId);
      if (who !== owner || index < 0) return null;
      return oldestFirst.slice(index + 1);
    },
    requests: async (who) => (who === owner ? requests : []),
  };
}
