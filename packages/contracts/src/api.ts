import { z } from "zod";
import { AddressSchema, ClusterSchema } from "./config.ts";
import { RequestStatusSchema } from "./enums.ts";
import { EventIdSchema, LeashEventSchema } from "./events.ts";
import { UnixSecondsSchema } from "./units.ts";
import {
  AgentViewSchema,
  PayeeViewSchema,
  PrincipalViewSchema,
  RequestViewSchema,
  StatsViewSchema,
  StatsWindowSchema,
} from "./views.ts";

/** Indexer REST routes (02-contracts §7.1). Parameters are written as `:name`. */
export const API_ROUTES = {
  health: "/v1/health",
  owner: "/v1/owners/:owner",
  agent: "/v1/agents/:agent",
  ownerEvents: "/v1/owners/:owner/events",
  agentEvents: "/v1/agents/:agent/events",
  ownerRequests: "/v1/owners/:owner/requests",
  ownerStats: "/v1/owners/:owner/stats",
  guardianOwners: "/v1/guardians/:guardian/owners",
  stream: "/v1/stream",
} as const;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  cluster: ClusterSchema,
  programId: AddressSchema,
  lastProcessedSlot: z.number().int().nonnegative().nullable(),
  lastEventAt: UnixSecondsSchema.nullable(),
  lagSeconds: z.number().nonnegative().nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const OwnerOverviewResponseSchema = z.object({
  principal: PrincipalViewSchema.nullable(),
  agents: z.array(AgentViewSchema),
});
export type OwnerOverviewResponse = z.infer<typeof OwnerOverviewResponseSchema>;

export const AgentDetailResponseSchema = z.object({
  agent: AgentViewSchema,
  payees: z.array(PayeeViewSchema),
  requests: z.array(RequestViewSchema),
});
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;

export const EventsPageResponseSchema = z.object({
  items: z.array(LeashEventSchema),
  nextBefore: EventIdSchema.nullable(),
});
export type EventsPageResponse = z.infer<typeof EventsPageResponseSchema>;

export const RequestsResponseSchema = z.object({ items: z.array(RequestViewSchema) });
export type RequestsResponse = z.infer<typeof RequestsResponseSchema>;

export const StatsResponseSchema = StatsViewSchema;
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

export const GuardianOwnersResponseSchema = z.object({ owners: z.array(AddressSchema) });
export type GuardianOwnersResponse = z.infer<typeof GuardianOwnersResponseSchema>;

export const ApiErrorCodeSchema = z.enum(["NOT_FOUND", "BAD_REQUEST", "INTERNAL"]);
export const ApiErrorResponseSchema = z.object({
  error: z.object({ code: ApiErrorCodeSchema, message: z.string() }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** Query string of the events routes. Parses raw strings (values arrive as text). */
export const EventsQuerySchema = z
  .object({
    agent: AddressSchema.optional(),
    /** Comma-separated event types. */
    types: z
      .string()
      .transform((s) => s.split(",").filter((t) => t.length > 0))
      .optional(),
    before: EventIdSchema.optional(),
    after: EventIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !(q.before && q.after), "use either before or after, not both");
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const RequestsQuerySchema = z.object({ status: RequestStatusSchema.optional() });
export const StatsQuerySchema = z.object({ window: StatsWindowSchema.default("24h") });

// ── WebSocket /v1/stream (02-contracts §7.2) ─────────────────────────────────

export const StreamClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), owners: z.array(AddressSchema).min(1) }),
  z.object({ type: z.literal("unsubscribe"), owners: z.array(AddressSchema).min(1) }),
  z.object({ type: z.literal("pong") }),
]);
export type StreamClientMessage = z.infer<typeof StreamClientMessageSchema>;

export const StreamServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), cluster: ClusterSchema, serverTime: UnixSecondsSchema }),
  z.object({ type: z.literal("event"), event: LeashEventSchema }),
  z.object({ type: z.literal("agent"), agent: AgentViewSchema }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("error"),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type StreamServerMessage = z.infer<typeof StreamServerMessageSchema>;

/** Server heartbeat interval. */
export const STREAM_PING_INTERVAL_MS = 20_000;
