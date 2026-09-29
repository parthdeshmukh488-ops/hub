import { z } from "zod";
import { AddressSchema, PROGRAM_CONSTANTS } from "./config.ts";
import {
  AgentStatusSchema,
  DelegationKindSchema,
  FreezeReasonSchema,
  PayeeModeSchema,
  RequestStatusSchema,
} from "./enums.ts";
import {
  AmountStringSchema,
  LabelSchema,
  MemoSchema,
  ReferenceHexSchema,
  UnixSecondsSchema,
} from "./units.ts";

/** A u64 nonce as a decimal string. */
export const NonceStringSchema = z.string().regex(/^(0|[1-9]\d*)$/, "expected a u64 nonce string");

const NullableTime = UnixSecondsSchema.nullable();

// ── Principal ────────────────────────────────────────────────────────────────

export const PrincipalViewSchema = z.object({
  address: AddressSchema,
  owner: AddressSchema,
  guardian: AddressSchema.nullable(),
  frozen: z.boolean(),
  frozenAt: NullableTime,
  frozenBy: AddressSchema.nullable(),
  agentCount: z.number().int().nonnegative(),
  createdAt: UnixSecondsSchema,
});
export type PrincipalView = z.infer<typeof PrincipalViewSchema>;

// ── Policy ───────────────────────────────────────────────────────────────────

export const PolicyViewSchema = z.object({
  maxPerPayment: AmountStringSchema,
  /** "0" disables approval requests. */
  maxPerRequest: AmountStringSchema,
  payeeMode: PayeeModeSchema,
  /** 0 = off. */
  velocityMaxPayments: z.number().int().min(0).max(65_535),
  velocityWindowSecs: z.number().int().min(0).max(4_294_967_295),
  /** 0 = off. */
  tripwireMaxStrikes: z.number().int().min(0).max(255),
  tripwireWindowSecs: z.number().int().min(0).max(4_294_967_295),
  requestTtlSecs: z.number().int().min(0).max(4_294_967_295),
  validUntil: NullableTime,
});
export type PolicyView = z.infer<typeof PolicyViewSchema>;

/**
 * The reasons a policy would be rejected by the program with `InvalidPolicy`
 * (01-onchain-program §4.5). Empty when the policy is valid at time `now`.
 */
export function policyProblems(policy: PolicyView, now: number): string[] {
  const problems: string[] = [];
  const maxPerPayment = BigInt(policy.maxPerPayment);
  const maxPerRequest = BigInt(policy.maxPerRequest);
  if (maxPerPayment === 0n) problems.push("maxPerPayment must be greater than 0");
  if (maxPerRequest !== 0n && maxPerRequest <= maxPerPayment) {
    problems.push("maxPerRequest must be 0 (approvals off) or greater than maxPerPayment");
  }
  if (policy.velocityMaxPayments > 0 && policy.velocityWindowSecs === 0) {
    problems.push("velocityWindowSecs must be greater than 0 when the rate limit is on");
  }
  if (policy.tripwireMaxStrikes > 0 && policy.tripwireWindowSecs === 0) {
    problems.push("tripwireWindowSecs must be greater than 0 when the tripwire is on");
  }
  if (
    maxPerRequest !== 0n &&
    (policy.requestTtlSecs < 1 || policy.requestTtlSecs > PROGRAM_CONSTANTS.maxRequestTtlSecs)
  ) {
    problems.push(
      `requestTtlSecs must be between 1 and ${PROGRAM_CONSTANTS.maxRequestTtlSecs} when approvals are on`,
    );
  }
  if (policy.validUntil !== null && policy.validUntil <= now) {
    problems.push("validUntil must be in the future");
  }
  return problems;
}

// ── Allowance (Subscriptions delegation, derived at `asOf`) ─────────────────

export const AllowanceViewSchema = z.object({
  delegation: AddressSchema,
  kind: DelegationKindSchema,
  mint: AddressSchema,
  /** Recurring only. */
  amountPerPeriod: AmountStringSchema.nullable(),
  periodLengthSecs: z.number().int().positive().nullable(),
  currentPeriodStart: NullableTime,
  pulledInPeriod: AmountStringSchema.nullable(),
  /** Fixed only. */
  amountRemaining: AmountStringSchema.nullable(),
  /** Spendable now, for both kinds. */
  remaining: AmountStringSchema,
  expiresAt: NullableTime,
  asOf: UnixSecondsSchema,
});
export type AllowanceView = z.infer<typeof AllowanceViewSchema>;

// ── Agent ────────────────────────────────────────────────────────────────────

export const AgentStatsViewSchema = z.object({
  paymentsCount: z.number().int().nonnegative(),
  totalPaid: AmountStringSchema,
  deniedCount: z.number().int().nonnegative(),
  lastPaymentAt: NullableTime,
  velocityCount: z.number().int().nonnegative(),
  velocityWindowStart: NullableTime,
  strikes: z.number().int().nonnegative(),
  strikeWindowStart: NullableTime,
  requestNonce: NonceStringSchema,
});
export type AgentStatsView = z.infer<typeof AgentStatsViewSchema>;

export const AgentViewSchema = z.object({
  address: AddressSchema,
  principal: AddressSchema,
  owner: AddressSchema,
  agentKey: AddressSchema,
  mint: AddressSchema,
  label: LabelSchema,
  status: AgentStatusSchema,
  freezeReason: FreezeReasonSchema,
  frozenAt: NullableTime,
  payeeCount: z.number().int().nonnegative(),
  openRequests: z.number().int().nonnegative(),
  policy: PolicyViewSchema,
  stats: AgentStatsViewSchema,
  allowance: AllowanceViewSchema.nullable(),
  createdAt: UnixSecondsSchema,
  updatedAt: UnixSecondsSchema,
});
export type AgentView = z.infer<typeof AgentViewSchema>;

// ── Payee ────────────────────────────────────────────────────────────────────

export const PayeeLimitsSchema = z.object({
  /** "0" = no payee-specific cap. */
  maxPerPayment: AmountStringSchema,
  /** "0" = no payee-specific period budget. */
  periodLimit: AmountStringSchema,
  periodSecs: z.number().int().min(0).max(4_294_967_295),
});
export type PayeeLimits = z.infer<typeof PayeeLimitsSchema>;

/** The reasons payee limits would be rejected (`period_secs` must be > 0 with a period limit). */
export function payeeLimitsProblems(limits: PayeeLimits): string[] {
  return BigInt(limits.periodLimit) > 0n && limits.periodSecs === 0
    ? ["periodSecs must be greater than 0 when a period limit is set"]
    : [];
}

export const PayeeViewSchema = PayeeLimitsSchema.extend({
  address: AddressSchema,
  agent: AddressSchema,
  payee: AddressSchema,
  label: LabelSchema,
  periodStart: NullableTime,
  spentInPeriod: AmountStringSchema,
  totalPaid: AmountStringSchema,
  paymentsCount: z.number().int().nonnegative(),
  createdAt: UnixSecondsSchema,
});
export type PayeeView = z.infer<typeof PayeeViewSchema>;

// ── Payment request ──────────────────────────────────────────────────────────

export const RequestViewSchema = z.object({
  address: AddressSchema,
  agent: AddressSchema,
  nonce: NonceStringSchema,
  payee: AddressSchema,
  amount: AmountStringSchema,
  reference: ReferenceHexSchema,
  memo: MemoSchema,
  status: RequestStatusSchema,
  createdAt: UnixSecondsSchema,
  expiresAt: UnixSecondsSchema,
  approvedAt: NullableTime,
  rentPayer: AddressSchema,
});
export type RequestView = z.infer<typeof RequestViewSchema>;

// ── Stats ────────────────────────────────────────────────────────────────────

export const StatsWindowSchema = z.enum(["1h", "24h", "7d"]);
export type StatsWindow = z.infer<typeof StatsWindowSchema>;

export const StatsViewSchema = z.object({
  window: StatsWindowSchema,
  totals: z.object({
    paid: AmountStringSchema,
    payments: z.number().int().nonnegative(),
    denied: z.number().int().nonnegative(),
    strikes: z.number().int().nonnegative(),
    frozenAgents: z.number().int().nonnegative(),
  }),
  byAgent: z.array(
    z.object({
      agent: AddressSchema,
      label: LabelSchema,
      paid: AmountStringSchema,
      payments: z.number().int().nonnegative(),
      denied: z.number().int().nonnegative(),
    }),
  ),
  byPayee: z.array(
    z.object({
      payee: AddressSchema,
      label: LabelSchema.nullable(),
      paid: AmountStringSchema,
      payments: z.number().int().nonnegative(),
    }),
  ),
});
export type StatsView = z.infer<typeof StatsViewSchema>;
