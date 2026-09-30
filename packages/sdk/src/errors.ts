import type { DenialReason } from "@leash/contracts";

/** Error codes thrown by the SDK. Tool and denial codes come from @leash/contracts. */
export type LeashSdkErrorCode =
  | "UNSUPPORTED_DELEGATION"
  | "INVALID_ACCOUNT_DATA"
  | "PAYMENT_DENIED"
  | "APPROVAL_NOT_POSSIBLE"
  | "NOT_PAIRED"
  | "UNSUPPORTED_PAYMENT"
  | "MERCHANT_REJECTED"
  | "NETWORK_ERROR";

/**
 * Base class of every error the SDK throws. `code` is stable; `message` is for humans and logs.
 * Messages never contain keys or RPC URLs; still, never show them to a model (the tools use the
 * contract's fixed messages instead).
 */
export class LeashSdkError extends Error {
  readonly code: LeashSdkErrorCode;

  constructor(code: LeashSdkErrorCode, message: string) {
    super(message);
    this.name = "LeashSdkError";
    this.code = code;
  }
}

/** The payment the policy looked at: recipient wallet and amount in base units. */
export type AttemptedPayment = { to: string; amount: bigint };

/**
 * The Leash policy blocked a payment (01-onchain-program §7). `recorded` is true once the
 * attempt is on-chain (`report_denied_attempt`, ADR 20260929-ws0-denial-reporting-policy).
 */
export class PaymentDeniedError extends LeashSdkError {
  readonly reason: DenialReason;
  readonly recorded: boolean;
  /** Strikes in the current window after this attempt, when it was recorded. */
  readonly strikes: number | undefined;
  /** True if this attempt froze the agent (tripwire). */
  readonly frozen: boolean | undefined;
  readonly attempted: AttemptedPayment;

  constructor(args: {
    reason: DenialReason;
    recorded: boolean;
    attempted: AttemptedPayment;
    strikes?: number;
    frozen?: boolean;
  }) {
    super("PAYMENT_DENIED", `Payment denied by the Leash policy: ${args.reason}`);
    this.name = "PaymentDeniedError";
    this.reason = args.reason;
    this.recorded = args.recorded;
    this.attempted = args.attempted;
    this.strikes = args.strikes;
    this.frozen = args.frozen;
  }
}

/** `request_payment` refused to open a request that policy does not need or cannot hold. */
export class ApprovalNotPossibleError extends LeashSdkError {
  readonly why: "notNeeded" | "tooManyOpen";

  constructor(why: "notNeeded" | "tooManyOpen") {
    super(
      "APPROVAL_NOT_POSSIBLE",
      why === "notNeeded"
        ? "The amount is within the instant limit"
        : "Too many open payment requests",
    );
    this.name = "ApprovalNotPossibleError";
    this.why = why;
  }
}

/** The agent has no Agent account yet: the owner has not paired it. */
export class NotPairedError extends LeashSdkError {
  constructor() {
    super("NOT_PAIRED", "The agent is not paired with an owner yet");
    this.name = "NotPairedError";
  }
}

/** A 402 challenge this agent cannot pay (network, asset or scheme; 02-contracts §9). */
export class UnsupportedPaymentError extends LeashSdkError {
  constructor(detail: string) {
    super("UNSUPPORTED_PAYMENT", `Unsupported payment requirement: ${detail}`);
    this.name = "UnsupportedPaymentError";
  }
}

/** The merchant or its facilitator refused a valid payment; nothing was charged. */
export class MerchantRejectedError extends LeashSdkError {
  constructor(detail: string) {
    super("MERCHANT_REJECTED", `The merchant rejected the payment: ${detail}`);
    this.name = "MerchantRejectedError";
  }
}

/** RPC, facilitator or merchant unreachable before anything was charged. */
export class LeashNetworkError extends LeashSdkError {
  constructor(detail: string) {
    super("NETWORK_ERROR", `Network error: ${detail}`);
    this.name = "LeashNetworkError";
  }
}
