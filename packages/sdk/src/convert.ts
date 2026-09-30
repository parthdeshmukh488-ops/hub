import type {
  AgentStatus,
  DenialReason,
  FreezeReason,
  PayeeLimits,
  PayeeMode,
  PolicyView,
  RequestStatus,
} from "@leash/contracts";
import type { PolicyState } from "./evaluate/types.ts";
import {
  AgentStatus as ChainAgentStatus,
  DenialReason as ChainDenialReason,
  FreezeReason as ChainFreezeReason,
  PayeeMode as ChainPayeeMode,
  RequestStatus as ChainRequestStatus,
  type Policy,
  type PolicyArgs,
} from "./generated/leash/index.ts";

// On-chain values (the generated client's enums, bigint amounts, 0 for "none") ⇄ the contract
// JSON of 02-contracts §3–§5. The records are exhaustive over the generated enums, so a new
// variant is a compile error here, not a silent miss.

export const AGENT_STATUS_FROM_CHAIN: Record<ChainAgentStatus, AgentStatus> = {
  [ChainAgentStatus.Active]: "active",
  [ChainAgentStatus.Frozen]: "frozen",
};

export const FREEZE_REASON_FROM_CHAIN: Record<ChainFreezeReason, FreezeReason> = {
  [ChainFreezeReason.None]: "none",
  [ChainFreezeReason.Owner]: "owner",
  [ChainFreezeReason.Guardian]: "guardian",
  [ChainFreezeReason.Tripwire]: "tripwire",
};

export const PAYEE_MODE_FROM_CHAIN: Record<ChainPayeeMode, PayeeMode> = {
  [ChainPayeeMode.AllowListOnly]: "allowListOnly",
  [ChainPayeeMode.AnyPayee]: "anyPayee",
};

export const PAYEE_MODE_TO_CHAIN: Record<PayeeMode, ChainPayeeMode> = {
  allowListOnly: ChainPayeeMode.AllowListOnly,
  anyPayee: ChainPayeeMode.AnyPayee,
};

export const REQUEST_STATUS_FROM_CHAIN: Record<ChainRequestStatus, RequestStatus> = {
  [ChainRequestStatus.Pending]: "pending",
  [ChainRequestStatus.Approved]: "approved",
};

export const DENIAL_REASON_FROM_CHAIN: Record<ChainDenialReason, DenialReason> = {
  [ChainDenialReason.PrincipalFrozen]: "principalFrozen",
  [ChainDenialReason.AgentFrozen]: "agentFrozen",
  [ChainDenialReason.AgentExpired]: "agentExpired",
  [ChainDenialReason.PayeeNotAllowed]: "payeeNotAllowed",
  [ChainDenialReason.ExceedsPaymentLimit]: "exceedsPaymentLimit",
  [ChainDenialReason.ApprovalRequired]: "approvalRequired",
  [ChainDenialReason.ExceedsPayeePaymentLimit]: "exceedsPayeePaymentLimit",
  [ChainDenialReason.ExceedsPayeePeriodLimit]: "exceedsPayeePeriodLimit",
  [ChainDenialReason.VelocityExceeded]: "velocityExceeded",
  [ChainDenialReason.AllowanceExpired]: "allowanceExpired",
  [ChainDenialReason.AllowanceExceeded]: "allowanceExceeded",
  [ChainDenialReason.InsufficientFunds]: "insufficientFunds",
};

/** A `Unix seconds or 0` field as the JSON's `number | null`. */
export const timeOrNull = (value: bigint): number | null => (value === 0n ? null : Number(value));

/** The on-chain `Policy` as its JSON view. */
export function policyToView(policy: Policy): PolicyView {
  return {
    maxPerPayment: policy.maxPerPayment.toString(),
    maxPerRequest: policy.maxPerRequest.toString(),
    payeeMode: PAYEE_MODE_FROM_CHAIN[policy.payeeMode],
    velocityMaxPayments: policy.velocityMaxPayments,
    velocityWindowSecs: policy.velocityWindowSecs,
    tripwireMaxStrikes: policy.tripwireMaxStrikes,
    tripwireWindowSecs: policy.tripwireWindowSecs,
    requestTtlSecs: policy.requestTtlSecs,
    validUntil: timeOrNull(policy.validUntil),
  };
}

/** A policy view as the `Policy` argument of `create_agent` and `update_policy`. */
export function policyFromView(view: PolicyView): PolicyArgs {
  return policyToChain(policyStateFromView(view));
}

/** The on-chain `Policy` as the evaluator's `PolicyState` (bigint amounts, contract names). */
export function policyToState(policy: Policy): PolicyState {
  return { ...policy, payeeMode: PAYEE_MODE_FROM_CHAIN[policy.payeeMode] };
}

/** A policy view (JSON) as a `PolicyState`, the policy type the owner builders take. */
export function policyStateFromView(view: PolicyView): PolicyState {
  return {
    maxPerPayment: BigInt(view.maxPerPayment),
    maxPerRequest: BigInt(view.maxPerRequest),
    payeeMode: view.payeeMode,
    velocityMaxPayments: view.velocityMaxPayments,
    velocityWindowSecs: view.velocityWindowSecs,
    tripwireMaxStrikes: view.tripwireMaxStrikes,
    tripwireWindowSecs: view.tripwireWindowSecs,
    requestTtlSecs: view.requestTtlSecs,
    validUntil: BigInt(view.validUntil ?? 0),
  };
}

/** A `PolicyState` as the `Policy` argument of `create_agent` and `update_policy`. */
export function policyToChain(policy: PolicyState): PolicyArgs {
  return { ...policy, payeeMode: PAYEE_MODE_TO_CHAIN[policy.payeeMode] };
}

/** Payee limits (JSON) as the `PayeeLimits` argument of `add_payee` and `update_payee`. */
export function payeeLimitsFromView(limits: PayeeLimits): {
  maxPerPayment: bigint;
  periodLimit: bigint;
  periodSecs: number;
} {
  return {
    maxPerPayment: BigInt(limits.maxPerPayment),
    periodLimit: BigInt(limits.periodLimit),
    periodSecs: limits.periodSecs,
  };
}
