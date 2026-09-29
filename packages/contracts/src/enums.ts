import { z } from "zod";
import { PROGRAM_CONSTANTS } from "./config.ts";

// On-chain enums are u8 values that never change (01-onchain-program §5).
// JSON uses the lowerCamelCase variant names (02-contracts §4).

export const AGENT_STATUS_CODES = { active: 0, frozen: 1 } as const;
export const AgentStatusSchema = z.enum(["active", "frozen"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const FREEZE_REASON_CODES = { none: 0, owner: 1, guardian: 2, tripwire: 3 } as const;
export const FreezeReasonSchema = z.enum(["none", "owner", "guardian", "tripwire"]);
export type FreezeReason = z.infer<typeof FreezeReasonSchema>;

export const PAYEE_MODE_CODES = { allowListOnly: 0, anyPayee: 1 } as const;
export const PayeeModeSchema = z.enum(["allowListOnly", "anyPayee"]);
export type PayeeMode = z.infer<typeof PayeeModeSchema>;

export const REQUEST_STATUS_CODES = { pending: 0, approved: 1 } as const;
export const RequestStatusSchema = z.enum(["pending", "approved"]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

/** Same numbers as the Subscriptions account discriminators. */
export const DELEGATION_KIND_CODES = { fixed: 2, recurring: 3 } as const;
export const DelegationKindSchema = z.enum(["fixed", "recurring"]);
export type DelegationKind = z.infer<typeof DelegationKindSchema>;

export type DenialInfo = {
  /** On-chain `DenialReason` code (1–12). */
  code: number;
  /** JSON value. */
  name: DenialReason;
  /** Anchor error variant name; its code is `6000 + code - 1`. */
  anchorError: string;
  /** Agent tool error code. */
  toolCode: DenialToolCode;
  /** Whether this reason counts towards the tripwire. */
  strike: boolean;
  /** Short owner-facing copy for the UI and alerts. */
  ownerCopy: string;
};

export const DENIAL_REASON_NAMES = [
  "principalFrozen",
  "agentFrozen",
  "agentExpired",
  "payeeNotAllowed",
  "exceedsPaymentLimit",
  "approvalRequired",
  "exceedsPayeePaymentLimit",
  "exceedsPayeePeriodLimit",
  "velocityExceeded",
  "allowanceExpired",
  "allowanceExceeded",
  "insufficientFunds",
] as const;
export const DenialReasonSchema = z.enum(DENIAL_REASON_NAMES);
export type DenialReason = z.infer<typeof DenialReasonSchema>;

export const DENIAL_TOOL_CODES = [
  "PRINCIPAL_FROZEN",
  "AGENT_FROZEN",
  "AGENT_EXPIRED",
  "PAYEE_NOT_ALLOWED",
  "EXCEEDS_PAYMENT_LIMIT",
  "APPROVAL_REQUIRED",
  "EXCEEDS_PAYEE_PAYMENT_LIMIT",
  "EXCEEDS_PAYEE_PERIOD_LIMIT",
  "VELOCITY_EXCEEDED",
  "ALLOWANCE_EXPIRED",
  "ALLOWANCE_EXCEEDED",
  "INSUFFICIENT_FUNDS",
] as const;
export type DenialToolCode = (typeof DENIAL_TOOL_CODES)[number];

/**
 * The DenialReason master table (02-contracts §4). Index `i` holds code `i + 1`.
 * The Leash program's first 12 error variants follow this exact order.
 */
export const DENIAL_REASONS: readonly DenialInfo[] = [
  {
    code: 1,
    name: "principalFrozen",
    anchorError: "DeniedPrincipalFrozen",
    toolCode: "PRINCIPAL_FROZEN",
    strike: false,
    ownerCopy: "All agents are paused",
  },
  {
    code: 2,
    name: "agentFrozen",
    anchorError: "DeniedAgentFrozen",
    toolCode: "AGENT_FROZEN",
    strike: false,
    ownerCopy: "This agent is paused",
  },
  {
    code: 3,
    name: "agentExpired",
    anchorError: "DeniedAgentExpired",
    toolCode: "AGENT_EXPIRED",
    strike: false,
    ownerCopy: "This agent's access has expired",
  },
  {
    code: 4,
    name: "payeeNotAllowed",
    anchorError: "DeniedPayeeNotAllowed",
    toolCode: "PAYEE_NOT_ALLOWED",
    strike: true,
    ownerCopy: "Tried to pay someone not on the allowlist",
  },
  {
    code: 5,
    name: "exceedsPaymentLimit",
    anchorError: "DeniedExceedsPaymentLimit",
    toolCode: "EXCEEDS_PAYMENT_LIMIT",
    strike: true,
    ownerCopy: "Tried to pay more than allowed per payment",
  },
  {
    code: 6,
    name: "approvalRequired",
    anchorError: "DeniedApprovalRequired",
    toolCode: "APPROVAL_REQUIRED",
    strike: false,
    ownerCopy: "Needs your approval",
  },
  {
    code: 7,
    name: "exceedsPayeePaymentLimit",
    anchorError: "DeniedExceedsPayeePaymentLimit",
    toolCode: "EXCEEDS_PAYEE_PAYMENT_LIMIT",
    strike: true,
    ownerCopy: "Tried to pay this payee more than allowed",
  },
  {
    code: 8,
    name: "exceedsPayeePeriodLimit",
    anchorError: "DeniedExceedsPayeePeriodLimit",
    toolCode: "EXCEEDS_PAYEE_PERIOD_LIMIT",
    strike: false,
    ownerCopy: "This payee's budget is used up",
  },
  {
    code: 9,
    name: "velocityExceeded",
    anchorError: "DeniedVelocityExceeded",
    toolCode: "VELOCITY_EXCEEDED",
    strike: false,
    ownerCopy: "Too many payments too fast",
  },
  {
    code: 10,
    name: "allowanceExpired",
    anchorError: "DeniedAllowanceExpired",
    toolCode: "ALLOWANCE_EXPIRED",
    strike: false,
    ownerCopy: "The allowance has expired",
  },
  {
    code: 11,
    name: "allowanceExceeded",
    anchorError: "DeniedAllowanceExceeded",
    toolCode: "ALLOWANCE_EXCEEDED",
    strike: false,
    ownerCopy: "The allowance for this period is used up",
  },
  {
    code: 12,
    name: "insufficientFunds",
    anchorError: "DeniedInsufficientFunds",
    toolCode: "INSUFFICIENT_FUNDS",
    strike: false,
    ownerCopy: "Your wallet balance is too low",
  },
];

const byName = new Map(DENIAL_REASONS.map((d) => [d.name, d]));

/** Master-table entry for a denial reason. */
export function denialInfo(reason: DenialReason): DenialInfo {
  const info = byName.get(reason);
  if (!info) throw new RangeError(`Unknown denial reason ${reason}`);
  return info;
}

/** Denial reason for an on-chain code (1–12), or null. */
export function denialFromCode(code: number): DenialReason | null {
  return DENIAL_REASONS[code - 1]?.name ?? null;
}

/** Anchor error code for a denial reason. */
export function anchorErrorCodeFor(reason: DenialReason): number {
  return PROGRAM_CONSTANTS.anchorErrorBase + denialInfo(reason).code - 1;
}

/** Denial reason for an Anchor error code (6000–6011), or null for any other code. */
export function denialFromAnchorErrorCode(errorCode: number): DenialReason | null {
  return denialFromCode(errorCode - PROGRAM_CONSTANTS.anchorErrorBase + 1);
}

/** Whether a reason counts towards the tripwire. */
export function isStrike(reason: DenialReason): boolean {
  return denialInfo(reason).strike;
}

/**
 * Every `LeashError` variant in on-chain order (01-onchain-program §10); code = 6000 + index.
 * New errors are appended; existing codes never move. WS1's IDL must match this list.
 */
export const LEASH_ERRORS = [
  ...DENIAL_REASONS.map((d) => d.anchorError),
  "Unauthorized",
  "InvalidPolicy",
  "InvalidAmount",
  "InvalidAgentKey",
  "InvalidPayee",
  "MintMismatch",
  "InvalidDestination",
  "DelegationMismatch",
  "UnsupportedDelegation",
  "RequestMismatch",
  "RequestNotApproved",
  "RequestExpired",
  "RequestNotPending",
  "RequestNotExpired",
  "ApprovalsDisabled",
  "ApprovalNotNeeded",
  "TooManyOpenRequests",
  "AttemptWouldSucceed",
  "AgentNotEmpty",
  "MathOverflow",
] as const;
export type LeashErrorName = (typeof LEASH_ERRORS)[number];

/** Name of the Leash error with this Anchor code, or null. */
export function leashErrorName(errorCode: number): LeashErrorName | null {
  return LEASH_ERRORS[errorCode - PROGRAM_CONSTANTS.anchorErrorBase] ?? null;
}
