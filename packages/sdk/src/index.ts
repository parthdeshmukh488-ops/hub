/**
 * @leash/sdk — the one TypeScript way to talk to Leash (docs/workstreams/WS2-sdk.md).
 * Build step 2: the policy evaluator and the Subscriptions allowance math.
 */
export {
  allowanceAt,
  allowanceRemaining,
  type DecodedDelegation,
  decodeDelegation,
  isAllowanceExpired,
  type RecurringPeriod,
  rollRecurringPeriod,
  SUBSCRIPTIONS_DELEGATION_LAYOUT,
} from "./allowance.ts";
export {
  ApprovalNotPossibleError,
  type AttemptedPayment,
  LeashNetworkError,
  LeashSdkError,
  type LeashSdkErrorCode,
  MerchantRejectedError,
  NotPairedError,
  PaymentDeniedError,
  UnsupportedPaymentError,
} from "./errors.ts";
export { evaluatePayment, rollWindow } from "./evaluate/evaluate.ts";
export type {
  AgentState,
  DelegationState,
  EvaluationError,
  EvaluationInput,
  EvaluationResult,
  PayeeEntryState,
  PaymentEffects,
  PaymentIntent,
  PaymentRequestState,
  PolicyState,
} from "./evaluate/types.ts";
