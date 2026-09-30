import { z } from "zod";
import { AddressSchema, SignatureSchema } from "./config.ts";
import { DENIAL_TOOL_CODES, type DenialToolCode } from "./enums.ts";
import { UnixSecondsSchema, UsdcAmountInputSchema } from "./units.ts";
import { NonceStringSchema } from "./views.ts";

// The agent tool contract (02-contracts §8). @leash/tools implements it; @leash/mcp exposes it;
// apps/agent-demo gives it to Claude. Tool names are exact.

export const TOOL_NAMES = {
  fetch: "leash_fetch",
  pay: "leash_pay",
  requestApproval: "leash_request_approval",
  status: "leash_status",
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Bodies returned by `leash_fetch` are truncated to this many characters. */
export const FETCH_BODY_MAX_CHARS = 20_000;

/** Purposes longer than the 64-byte memo are truncated at a character boundary by the tools. */
const PurposeSchema = z.string().min(1).max(500);

// ── Inputs ───────────────────────────────────────────────────────────────────

export const LeashFetchInputSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  method: z.enum(["GET", "POST"]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  /** Why the agent is fetching this; becomes the on-chain memo if it pays. */
  purpose: PurposeSchema,
});
export type LeashFetchInput = z.infer<typeof LeashFetchInputSchema>;

export const LeashPayInputSchema = z.object({
  to: AddressSchema,
  amountUsdc: UsdcAmountInputSchema,
  purpose: PurposeSchema,
});
export type LeashPayInput = z.infer<typeof LeashPayInputSchema>;

export const LeashRequestApprovalInputSchema = LeashPayInputSchema;
export type LeashRequestApprovalInput = z.infer<typeof LeashRequestApprovalInputSchema>;

export const LeashStatusInputSchema = z.object({});
export type LeashStatusInput = z.infer<typeof LeashStatusInputSchema>;

// ── Outputs ──────────────────────────────────────────────────────────────────

export const TOOL_ERROR_CODES = [
  ...DENIAL_TOOL_CODES,
  "UNSUPPORTED_PAYMENT",
  "MERCHANT_REJECTED",
  "NETWORK_ERROR",
  "INVALID_INPUT",
  "NOT_PAIRED",
  // Since contracts 1.2.0 (ADR 20260930-ws7-approval-request-errors).
  "APPROVAL_NOT_NEEDED",
  "TOO_MANY_OPEN_REQUESTS",
] as const;
export const ToolErrorCodeSchema = z.enum(TOOL_ERROR_CODES);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export const PaymentReceiptSchema = z.object({
  signature: SignatureSchema,
  explorerUrl: z.url(),
  amountUsdc: UsdcAmountInputSchema,
  payee: AddressSchema,
  payeeLabel: z.string().nullable(),
  purpose: z.string(),
  requestNonce: NonceStringSchema.nullable(),
});
export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>;

export const ToolErrorSchema = z.object({
  ok: z.literal(false),
  code: ToolErrorCodeSchema,
  /** Safe to show the model. Built from TOOL_ERROR_MESSAGES. */
  message: z.string(),
  /** True if the attempt is now on-chain (report_denied_attempt). */
  recorded: z.boolean(),
  strikes: z.number().int().nonnegative().optional(),
  frozen: z.boolean().optional(),
  retryable: z.boolean(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

export const LeashFetchSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.number().int(),
  contentType: z.string(),
  body: z.string().max(FETCH_BODY_MAX_CHARS + 100),
  payment: PaymentReceiptSchema.nullable(),
});
export const LeashFetchOutputSchema = z.discriminatedUnion("ok", [
  LeashFetchSuccessSchema,
  ToolErrorSchema,
]);
export type LeashFetchOutput = z.infer<typeof LeashFetchOutputSchema>;

export const LeashPayOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), payment: PaymentReceiptSchema }),
  ToolErrorSchema,
]);
export type LeashPayOutput = z.infer<typeof LeashPayOutputSchema>;

export const LeashRequestApprovalOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    request: z.object({
      address: AddressSchema,
      nonce: NonceStringSchema,
      expiresAt: UnixSecondsSchema,
      status: z.literal("pending"),
    }),
  }),
  ToolErrorSchema,
]);
export type LeashRequestApprovalOutput = z.infer<typeof LeashRequestApprovalOutputSchema>;

export const LeashStatusOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    agent: z.object({
      label: z.string(),
      status: z.enum(["active", "frozen"]),
      freezeReason: z.enum(["none", "owner", "guardian", "tripwire"]),
    }),
    allowance: z.object({
      remainingUsdc: UsdcAmountInputSchema,
      perPeriodUsdc: UsdcAmountInputSchema.nullable(),
      periodEndsAt: UnixSecondsSchema.nullable(),
      expiresAt: UnixSecondsSchema.nullable(),
    }),
    limits: z.object({
      maxPerPaymentUsdc: UsdcAmountInputSchema,
      maxPerRequestUsdc: UsdcAmountInputSchema,
    }),
    payees: z.array(
      z.object({
        label: z.string(),
        wallet: AddressSchema,
        maxPerPaymentUsdc: UsdcAmountInputSchema.nullable(),
        remainingInPeriodUsdc: UsdcAmountInputSchema.nullable(),
      }),
    ),
    strikes: z.number().int().nonnegative(),
    tripwireMaxStrikes: z.number().int().nonnegative(),
  }),
  ToolErrorSchema,
]);
export type LeashStatusOutput = z.infer<typeof LeashStatusOutputSchema>;

// ── Messages ─────────────────────────────────────────────────────────────────
// Rule: a message states what happened and why, and steers the model to stop.
// It never suggests a way around the policy (another recipient, splitting a payment, …).

const STOP = "Do not retry this payment or try another way to pay.";
/**
 * The sentence that says a denial is on-chain. Tools drop it from the message when the attempt
 * could not be recorded (`recorded: false`), so the model is never told something untrue.
 */
export const TOOL_MESSAGE_RECORDED = "The attempt was recorded and the owner was notified.";
const RECORDED = TOOL_MESSAGE_RECORDED;

/** The message returned to the model for each tool error code. */
export const TOOL_ERROR_MESSAGES: Record<ToolErrorCode, string> = {
  PRINCIPAL_FROZEN: `All payments are paused by the owner. ${STOP} Continue the task without paying, or tell the owner.`,
  AGENT_FROZEN: `This agent's payments are frozen by the owner. ${STOP} Continue the task without paying, or tell the owner.`,
  AGENT_EXPIRED: `This agent's permission to pay has expired. ${STOP} Tell the owner if payments are still needed.`,
  PAYEE_NOT_ALLOWED: `Blocked by the owner's spending policy: this recipient is not on the allowlist. ${RECORDED} ${STOP} Continue the task without paying, or ask the owner.`,
  EXCEEDS_PAYMENT_LIMIT: `Blocked by the owner's spending policy: this amount is above the agent's limit. ${RECORDED} ${STOP} Continue the task without paying, or ask the owner.`,
  APPROVAL_REQUIRED:
    "This payment needs the owner's approval. A request was sent to the owner. Continue with other work; the same request can be retried after the owner approves it.",
  EXCEEDS_PAYEE_PAYMENT_LIMIT: `Blocked by the owner's spending policy: this amount is above the limit for this recipient. ${RECORDED} ${STOP} Continue the task without paying, or ask the owner.`,
  EXCEEDS_PAYEE_PERIOD_LIMIT: `The budget for this recipient is used up for now. ${STOP} Continue the task without paying, or ask the owner.`,
  VELOCITY_EXCEEDED: `Paused by the owner's spending policy: too many payments in a short time. Stop repeating paid requests. ${STOP}`,
  ALLOWANCE_EXPIRED: `The owner's allowance for this agent has expired. ${STOP} Tell the owner if payments are still needed.`,
  ALLOWANCE_EXCEEDED: `The owner's allowance for this period is used up. ${STOP} Continue the task without paying, or tell the owner.`,
  INSUFFICIENT_FUNDS: `The owner's wallet does not hold enough funds. ${STOP} Tell the owner.`,
  UNSUPPORTED_PAYMENT:
    "This service asks for a payment this agent cannot make (different network, token or payment scheme). Do not pay it; continue without this service.",
  MERCHANT_REJECTED:
    "The service rejected the payment and nothing was charged. Continue without this service or try again later.",
  NETWORK_ERROR:
    "The payment could not be completed because of a network error. Nothing was charged. You may try again later.",
  INVALID_INPUT: "The tool input is invalid. Check the parameters and try again.",
  NOT_PAIRED:
    "This agent has no spending permission yet. Ask the owner to pair it before paying for anything.",
  APPROVAL_NOT_NEEDED:
    "This amount is within the agent's own per-payment limit, so it needs no approval. No request was sent.",
  TOO_MANY_OPEN_REQUESTS:
    "Too many payment requests are already waiting for the owner. No new request was sent. Do not send more requests; continue with other work.",
};

/** Tool error codes that the SDK reports on-chain when they occur (see ADR 20260929-ws0-denial-reporting-policy). */
export const REPORTED_DENIAL_CODES: readonly DenialToolCode[] = DENIAL_TOOL_CODES.filter(
  (code) => code !== "APPROVAL_REQUIRED",
);

/** Non-strike denials are reported at most once per reason per agent within this window. */
export const NON_STRIKE_REPORT_COOLDOWN_SECS = 60;
