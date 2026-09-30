import {
  AgentDetailResponseSchema,
  ApiErrorResponseSchema,
  EventsPageResponseSchema,
  type LeashEvent,
  OwnerOverviewResponseSchema,
  RequestsResponseSchema,
} from "@leash/contracts";
import type { z } from "zod";
import { payeeRowFromView } from "../lib/payees.ts";
import type { AgentDetail, EventsFilter, EventsPage, LeashDataSource, Overview } from "./source.ts";

/** The indexer answered with an error, or something that is not its contract. */
export class IndexerError extends Error {
  override readonly name = "IndexerError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads the indexer's REST API (02-contracts §7.1). Every response is validated: the indexer is
 * not a security boundary, but the UI still refuses data that does not match the contract.
 */
export function createIndexerSource(baseUrl: string, fetchImpl: typeof fetch = fetch): LeashDataSource {
  const root = baseUrl.replace(/\/+$/, "");

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, { headers: { accept: "application/json" } });
    } catch {
      throw new IndexerError(0, `Can't reach the indexer at ${root}. Is it running?`);
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = ApiErrorResponseSchema.safeParse(body);
      throw new IndexerError(response.status, error.success ? error.data.error.message : `HTTP ${response.status}`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new IndexerError(response.status, `Unexpected response from ${path}`);
    return parsed.data;
  }

  async function need<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const value = await get(path, schema);
    if (value === null) throw new IndexerError(404, `Not found: ${path}`);
    return value;
  }

  const query = (filter: EventsFilter & { after?: string }): string => {
    const params = new URLSearchParams();
    if (filter.agent) params.set("agent", filter.agent);
    if (filter.types?.length) params.set("types", filter.types.join(","));
    if (filter.before) params.set("before", filter.before);
    if (filter.after) params.set("after", filter.after);
    params.set("limit", String(filter.limit ?? 50));
    return params.toString();
  };

  const events = (owner: string, filter: EventsFilter): Promise<EventsPage> =>
    need(`/v1/owners/${owner}/events?${query(filter)}`, EventsPageResponseSchema);

  /** Agent and payee labels, for event descriptions. */
  async function names(owner: string, agents: Overview["agents"]): Promise<Map<string, string>> {
    const book = new Map<string, string>();
    const details = await Promise.all(
      agents.map((agent) => get(`/v1/agents/${agent.address}`, AgentDetailResponseSchema)),
    );
    for (const agent of agents) book.set(agent.address, agent.label);
    for (const detail of details) for (const payee of detail?.payees ?? []) book.set(payee.payee, payee.label);
    return book;
  }

  return {
    kind: "indexer",
    now: () => Math.floor(Date.now() / 1000),
    async overview(owner): Promise<Overview> {
      const [overview, blocked] = await Promise.all([
        need(`/v1/owners/${owner}`, OwnerOverviewResponseSchema),
        events(owner, { types: ["PaymentDenied"], limit: 10 }),
      ]);
      return {
        principal: overview.principal,
        agents: overview.agents,
        recentBlocked: blocked.items.filter((e) => e.type === "PaymentDenied"),
        names: await names(owner, overview.agents),
      };
    },
    async agent(owner, address): Promise<AgentDetail | null> {
      const [detail, overview, history] = await Promise.all([
        get(`/v1/agents/${address}`, AgentDetailResponseSchema),
        need(`/v1/owners/${owner}`, OwnerOverviewResponseSchema),
        events(owner, { agent: address, limit: 50 }),
      ]);
      if (!detail || detail.agent.owner !== owner) return null;
      const book = new Map(overview.agents.map((agent) => [agent.address, agent.label]));
      for (const payee of detail.payees) book.set(payee.payee, payee.label);
      return {
        principalFrozen: overview.principal?.frozen ?? false,
        agent: detail.agent,
        payees: detail.payees.map(payeeRowFromView),
        requests: detail.requests,
        events: history.items,
        names: book,
      };
    },
    events,
    async eventsAfter(owner, afterId): Promise<LeashEvent[] | null> {
      const collected: LeashEvent[] = [];
      let cursor = afterId;
      // Page forward until the gap is closed.
      for (;;) {
        const page = await get(`/v1/owners/${owner}/events?${query({ after: cursor, limit: 200 })}`, EventsPageResponseSchema);
        if (page === null) return null;
        collected.push(...page.items);
        const last = page.items.at(-1);
        if (page.items.length < 200 || !last) return collected;
        cursor = last.id;
      }
    },
    async requests(owner) {
      return (await need(`/v1/owners/${owner}/requests`, RequestsResponseSchema)).items;
    },
  };
}
