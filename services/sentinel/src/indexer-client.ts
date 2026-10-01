import {
  type AgentDetailResponse,
  AgentDetailResponseSchema,
  API_ROUTES,
  ApiErrorResponseSchema,
  type EventsPageResponse,
  EventsPageResponseSchema,
  GuardianOwnersResponseSchema,
  type OwnerOverviewResponse,
  OwnerOverviewResponseSchema,
} from "@leash/contracts";
import type { z } from "zod";

// The indexer's REST API (02-contracts §7.1). Every response is parsed: it is a boundary.

/** An HTTP error from the indexer, with its `{ error: { code } }` when it sent one. */
export class IndexerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IndexerError";
  }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface IndexerClient {
  guardianOwners(guardian: string): Promise<string[]>;
  owner(owner: string): Promise<OwnerOverviewResponse>;
  agent(agent: string): Promise<AgentDetailResponse>;
  /** Events after `after` in ascending order (02 §7.1); without `after`, the newest first. */
  ownerEvents(owner: string, query: { after?: string; limit: number }): Promise<EventsPageResponse>;
  /** The URL of the WebSocket stream. */
  streamUrl: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createIndexerClient(baseUrl: string, fetchImpl: FetchLike = fetch): IndexerClient {
  const base = baseUrl.replace(/\/+$/, "");
  const path = (route: string, params: Record<string, string>) =>
    route.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));

  async function get<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${base}${url}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = ApiErrorResponseSchema.safeParse(body);
      throw new IndexerError(
        response.status,
        error.success ? error.data.error.code : "HTTP_ERROR",
        error.success ? error.data.error.message : `Indexer answered ${response.status} for ${url}`,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new IndexerError(
        response.status,
        "BAD_RESPONSE",
        `Unexpected indexer response for ${url}`,
      );
    }
    return parsed.data;
  }

  return {
    streamUrl: `${base.replace(/^http/, "ws")}${API_ROUTES.stream}`,
    guardianOwners: async (guardian) =>
      (await get(path(API_ROUTES.guardianOwners, { guardian }), GuardianOwnersResponseSchema))
        .owners,
    owner: (owner) => get(path(API_ROUTES.owner, { owner }), OwnerOverviewResponseSchema),
    agent: (agent) => get(path(API_ROUTES.agent, { agent }), AgentDetailResponseSchema),
    ownerEvents: (owner, query) => {
      const search = new URLSearchParams({ limit: String(query.limit) });
      if (query.after) search.set("after", query.after);
      return get(
        `${path(API_ROUTES.ownerEvents, { owner })}?${search.toString()}`,
        EventsPageResponseSchema,
      );
    },
  };
}
