import { z } from "zod";
import { AddressSchema, ClusterSchema, SignatureSchema } from "./config.ts";
import { DenialReasonSchema, FreezeReasonSchema } from "./enums.ts";
import {
  AmountStringSchema,
  LabelSchema,
  MemoSchema,
  ReferenceHexSchema,
  UnixSecondsSchema,
} from "./units.ts";
import { NonceStringSchema, PolicyViewSchema } from "./views.ts";

/** Event id: `${signature}:${innerIndex}`, globally unique and stable. */
export const EventIdSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}:\d+$/, "expected <signature>:<innerIndex>");

const base = z.object({
  id: EventIdSchema,
  signature: SignatureSchema,
  slot: z.number().int().nonnegative(),
  /** From the transaction. */
  blockTime: UnixSecondsSchema,
  /** From the event itself. */
  timestamp: UnixSecondsSchema,
  principal: AddressSchema.nullable(),
  agent: AddressSchema.nullable(),
});

const payeeFields = {
  payee: AddressSchema,
  label: LabelSchema,
  maxPerPayment: AmountStringSchema,
  periodLimit: AmountStringSchema,
  periodSecs: z.number().int().nonnegative(),
};

export const PrincipalInitializedEventSchema = base.extend({
  type: z.literal("PrincipalInitialized"),
  owner: AddressSchema,
  guardian: AddressSchema.nullable(),
});
export const GuardianChangedEventSchema = base.extend({
  type: z.literal("GuardianChanged"),
  guardian: AddressSchema.nullable(),
});
export const PrincipalFrozenEventSchema = base.extend({
  type: z.literal("PrincipalFrozen"),
  by: AddressSchema,
});
export const PrincipalUnfrozenEventSchema = base.extend({
  type: z.literal("PrincipalUnfrozen"),
});
export const AgentCreatedEventSchema = base.extend({
  type: z.literal("AgentCreated"),
  agentKey: AddressSchema,
  mint: AddressSchema,
  label: LabelSchema,
  policy: PolicyViewSchema,
});
export const PolicyUpdatedEventSchema = base.extend({
  type: z.literal("PolicyUpdated"),
  policy: PolicyViewSchema,
});
export const AgentFrozenEventSchema = base.extend({
  type: z.literal("AgentFrozen"),
  reason: FreezeReasonSchema.exclude(["none"]),
  /** For `tripwire`, the agent key. */
  by: AddressSchema,
});
export const AgentUnfrozenEventSchema = base.extend({
  type: z.literal("AgentUnfrozen"),
});
export const AgentClosedEventSchema = base.extend({
  type: z.literal("AgentClosed"),
});
export const PayeeAddedEventSchema = base.extend({
  type: z.literal("PayeeAdded"),
  ...payeeFields,
});
export const PayeeUpdatedEventSchema = base.extend({
  type: z.literal("PayeeUpdated"),
  ...payeeFields,
});
export const PayeeRemovedEventSchema = base.extend({
  type: z.literal("PayeeRemoved"),
  payee: AddressSchema,
});
export const PaymentExecutedEventSchema = base.extend({
  type: z.literal("PaymentExecuted"),
  payee: AddressSchema,
  destination: AddressSchema,
  mint: AddressSchema,
  amount: AmountStringSchema,
  reference: ReferenceHexSchema,
  memo: MemoSchema,
  delegation: AddressSchema,
  /** Set when the payment consumed an approved request. */
  requestNonce: NonceStringSchema.nullable(),
  paymentsCount: z.number().int().positive(),
});
export const PaymentDeniedEventSchema = base.extend({
  type: z.literal("PaymentDenied"),
  payee: AddressSchema,
  destination: AddressSchema,
  amount: AmountStringSchema,
  reason: DenialReasonSchema,
  reasonCode: z.number().int().min(1).max(12),
  /** Whether this reason counts towards the tripwire. */
  strike: z.boolean(),
  /** Strikes in the current window after this attempt. */
  strikes: z.number().int().nonnegative(),
  /** True if this attempt froze the agent. */
  tripped: z.boolean(),
  reference: ReferenceHexSchema,
  memo: MemoSchema,
});
export const PaymentRequestedEventSchema = base.extend({
  type: z.literal("PaymentRequested"),
  request: AddressSchema,
  nonce: NonceStringSchema,
  payee: AddressSchema,
  amount: AmountStringSchema,
  reference: ReferenceHexSchema,
  memo: MemoSchema,
  expiresAt: UnixSecondsSchema,
});
export const RequestApprovedEventSchema = base.extend({
  type: z.literal("RequestApproved"),
  request: AddressSchema,
  nonce: NonceStringSchema,
});
export const RequestRejectedEventSchema = base.extend({
  type: z.literal("RequestRejected"),
  request: AddressSchema,
  nonce: NonceStringSchema,
  by: AddressSchema,
});
export const RequestExpiredEventSchema = base.extend({
  type: z.literal("RequestExpired"),
  request: AddressSchema,
  nonce: NonceStringSchema,
});

/** Every on-chain Leash event, as JSON (02-contracts §6). */
export const LeashEventSchema = z.discriminatedUnion("type", [
  PrincipalInitializedEventSchema,
  GuardianChangedEventSchema,
  PrincipalFrozenEventSchema,
  PrincipalUnfrozenEventSchema,
  AgentCreatedEventSchema,
  PolicyUpdatedEventSchema,
  AgentFrozenEventSchema,
  AgentUnfrozenEventSchema,
  AgentClosedEventSchema,
  PayeeAddedEventSchema,
  PayeeUpdatedEventSchema,
  PayeeRemovedEventSchema,
  PaymentExecutedEventSchema,
  PaymentDeniedEventSchema,
  PaymentRequestedEventSchema,
  RequestApprovedEventSchema,
  RequestRejectedEventSchema,
  RequestExpiredEventSchema,
]);
export type LeashEvent = z.infer<typeof LeashEventSchema>;
export type LeashEventType = LeashEvent["type"];

/** All event type names, in the order of 01-onchain-program §9. */
export const LEASH_EVENT_TYPES = LeashEventSchema.options.map(
  (option) => option.shape.type.value,
) as readonly LeashEventType[];

/** Narrows a LeashEvent union to one event type. */
export type LeashEventOf<T extends LeashEventType> = Extract<LeashEvent, { type: T }>;

/**
 * `fixtures/demo-storyline.json`: the pitch demo as an ordered event stream.
 * The indexer's fixture mode replays it (WS4); Sentinel and the web app are tested with it.
 */
export const DemoStorylineSchema = z.object({
  version: z.literal(1),
  description: z.string(),
  cluster: ClusterSchema,
  /** Named addresses used in the storyline (owner, agents, merchant, attacker, …). */
  keys: z.record(z.string(), AddressSchema),
  events: z.array(LeashEventSchema).min(1),
});
export type DemoStoryline = z.infer<typeof DemoStorylineSchema>;
