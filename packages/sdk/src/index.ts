/**
 * @leash/sdk — the one TypeScript way to talk to Leash (docs/workstreams/WS2-sdk.md).
 * Consumers never import `src/generated/` directly: everything they need is exported here.
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
  AGENT_STATUS_FROM_CHAIN,
  DENIAL_REASON_FROM_CHAIN,
  FREEZE_REASON_FROM_CHAIN,
  PAYEE_MODE_FROM_CHAIN,
  PAYEE_MODE_TO_CHAIN,
  payeeLimitsFromView,
  policyFromView,
  policyToView,
  REQUEST_STATUS_FROM_CHAIN,
  timeOrNull,
} from "./convert.ts";
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
export {
  type DecodeOptions,
  decodeLeashEventData,
  decodeLeashEvents,
  EVENT_IX_TAG,
  type InnerInstructionRecord,
  isEventData,
  type RpcTransactionJson,
  type TransactionRecord,
  transactionRecordFromRpc,
} from "./events.ts";
export {
  type DelegationSeeds,
  findAgentPda,
  findDelegationPda,
  findLeashEventAuthorityPda,
  findPayeePda,
  findPrincipalPda,
  findRequestPda,
  findSubscriptionAuthorityPda,
  findSubscriptionsEventAuthorityPda,
  LEASH_PROGRAM_ADDRESS,
  SUBSCRIPTIONS_PROGRAM_ADDRESS,
} from "./pda.ts";
export {
  type FailedTransactionMessage,
  findLeashFailure,
  type LeashFailure,
  LeashProgramError,
  leashFailureFromCode,
  toSdkError,
} from "./program-errors.ts";
