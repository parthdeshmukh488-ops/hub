import {
  AddressSchema,
  API_ROUTES,
  type ApiErrorResponse,
  type Cluster,
  EventsQuerySchema,
  type HealthResponse,
  LEASH_EVENT_TYPES,
  RequestsQuerySchema,
  StatsQuerySchema,
} from "@leash/contracts";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { z } from "zod";
import type { Logger } from "./logger.ts";
import type { EventSource } from "./sources/source.ts";
import type { EventsFilter, Store } from "./store.ts";

// The REST API (02-contracts §7.1). Read-only by design: the indexer serves public on-chain data
// and never acts on-chain (T13).

export type AppDeps = {
  store: Store;
  source: Pick<EventSource, "kind" | "lagSeconds" | "healthy">;
  cluster: Cluster;
  programId: string;
  webOrigin: string;
  /** Unix seconds; views such as the allowance depend on it. */
  now: () => number;
  log: Logger;
};

type ErrorCode = ApiErrorResponse["error"]["code"];

class ApiError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const errorBody = (code: ErrorCode, message: string): ApiErrorResponse => ({
  error: { code, message },
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => issue.message).join("; ");
    throw new ApiError(400, "BAD_REQUEST", `Invalid ${what}: ${detail}`);
  }
  return result.data;
}

const address = (c: Context, name: string) =>
  parse(AddressSchema, c.req.param(name), `${name} address`);

function eventsFilter(c: Context): Omit<EventsFilter, "owner" | "agent"> & { agent?: string } {
  const query = parse(EventsQuerySchema, c.req.query(), "query");
  const unknown = (query.types ?? []).filter(
    (type) => !(LEASH_EVENT_TYPES as readonly string[]).includes(type),
  );
  if (unknown.length > 0)
    throw new ApiError(400, "BAD_REQUEST", `Unknown event types: ${unknown.join(", ")}`);
  return query;
}

export function createApp(deps: AppDeps): Hono {
  const { store } = deps;
  const app = new Hono();
  app.use("*", cors({ origin: deps.webOrigin, allowMethods: ["GET"] }));

  app.get(API_ROUTES.health, async (c) => {
    let ok = true;
    try {
      await store.ping();
    } catch (err) {
      deps.log.error({ err }, "database unreachable");
      ok = false;
    }
    const progress = ok ? await store.progress() : { lastProcessedSlot: null, lastEventAt: null };
    // A source that cannot make progress keeps HTTP 200 (the service answers) but says so.
    const body: HealthResponse = {
      ok: ok && deps.source.healthy(),
      cluster: deps.cluster,
      programId: deps.programId,
      ...progress,
      lagSeconds: deps.source.lagSeconds(),
    };
    return c.json(body, ok ? 200 : 503);
  });

  app.get(API_ROUTES.owner, async (c) =>
    c.json(await store.ownerOverview(address(c, "owner"), deps.now())),
  );

  app.get(API_ROUTES.agent, async (c) => {
    const detail = await store.agentDetail(address(c, "agent"), deps.now());
    if (!detail) throw new ApiError(404, "NOT_FOUND", "No agent at this address");
    return c.json(detail);
  });

  const page = async (filter: EventsFilter) => {
    const result = await store.events(filter);
    if (!result)
      throw new ApiError(404, "NOT_FOUND", "Unknown event id in before/after: reload the history");
    return result;
  };
  app.get(API_ROUTES.ownerEvents, async (c) =>
    c.json(await page({ ...eventsFilter(c), owner: address(c, "owner") })),
  );
  app.get(API_ROUTES.agentEvents, async (c) =>
    c.json(await page({ ...eventsFilter(c), agent: address(c, "agent") })),
  );

  app.get(API_ROUTES.ownerRequests, async (c) => {
    const { status } = parse(RequestsQuerySchema, c.req.query(), "query");
    return c.json(await store.requests(address(c, "owner"), status));
  });

  app.get(API_ROUTES.ownerStats, async (c) => {
    const { window } = parse(StatsQuerySchema, c.req.query(), "query");
    return c.json(await store.stats(address(c, "owner"), window, deps.now()));
  });

  app.get(API_ROUTES.guardianOwners, async (c) =>
    c.json({ owners: await store.guardianOwners(address(c, "guardian")) }),
  );

  app.notFound((c) => c.json(errorBody("NOT_FOUND", "No such route"), 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    deps.log.error({ err, path: c.req.path }, "request failed");
    return c.json(errorBody("INTERNAL", "Internal error"), 500);
  });
  return app;
}
