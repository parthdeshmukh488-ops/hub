import type { AgentStatus, DenialReason, PayeeMode, RequestStatus } from "@leash/contracts";

// Input and output types of the policy evaluator. The shapes follow what Codama decodes from
// the on-chain accounts: `bigint` for u64/i64, `number` for u8/u16/u32, and on-chain sentinels
// (0 = "off", "never" or "no expiry"). Decoded accounts can therefore be passed in directly.

/** An agent's policy (01-onchain-program §4.5). */
export type PolicyState = {
  /** Instant limit per payment. */
  maxPerPayment: bigint;
  /** Upper bound for approved requests; 0n disables approvals. */
  maxPerRequest: bigint;
  payeeMode: PayeeMode;
  /** 0 = rate limit off. */
  velocityMaxPayments: number;
  velocityWindowSecs: number;
  /** 0 = tripwire off. */
  tripwireMaxStrikes: number;
  tripwireWindowSecs: number;
  requestTtlSecs: number;
  /** 0n = no expiry. Exclusive: expired when `now >= validUntil`. */
  validUntil: bigint;
};

/** The parts of an Agent account the evaluator reads. */
export type AgentState = {
  /** The Agent PDA. */
  address: string;
  status: AgentStatus;
  policy: PolicyState;
  /** 0n = the window never started. */
  velocityWindowStart: bigint;
  velocityCount: number;
};

/** An allowlist entry (Payee account). It may belong to another agent or payee: the evaluator checks. */
export type PayeeEntryState = {
  /** The Agent PDA that owns this entry. */
  agent: string;
  /** The payee wallet (owner of the destination token account). */
  payee: string;
  /** 0n = no payee-specific cap. */
  maxPerPayment: bigint;
  /** 0n = no payee-specific period budget. */
  periodLimit: bigint;
  periodSecs: number;
  /** 0n = the period never started. */
  periodStart: bigint;
  spentInPeriod: bigint;
};

/** A PaymentRequest account attached to the payment. */
export type PaymentRequestState = {
  /** The Agent PDA that created the request. */
  agent: string;
  status: RequestStatus;
  payee: string;
  amount: bigint;
  reference: Uint8Array;
  /** Exclusive: expired when `now >= expiresAt`. */
  expiresAt: bigint;
};

/** The Subscriptions delegation that funds the agent (01-onchain-program §8.3). */
export type DelegationState =
  | {
      kind: "recurring";
      amountPerPeriod: bigint;
      periodLengthSecs: bigint;
      currentPeriodStart: bigint;
      pulledInPeriod: bigint;
      /** 0n = no expiry. Inclusive: expired only when `now > expiryTs`. */
      expiryTs: bigint;
    }
  | {
      kind: "fixed";
      amountRemaining: bigint;
      /** 0n = no expiry. Inclusive: expired only when `now > expiryTs`. */
      expiryTs: bigint;
    };

/** The payment being evaluated. */
export type PaymentIntent = {
  amount: bigint;
  /** Owner of the destination token account: the wallet the allowlist is checked against. */
  destinationOwner: string;
  reference: Uint8Array;
};

export type EvaluationInput = {
  /** Unix seconds (the Clock sysvar on-chain). */
  now: bigint;
  principalFrozen: boolean;
  agent: AgentState;
  payeeEntry: PayeeEntryState | null;
  request: PaymentRequestState | null;
  delegation: DelegationState;
  /** Balance of the owner's token account. */
  sourceAmount: bigint;
  payment: PaymentIntent;
};

/** Errors `evaluate` can produce on-chain (01-onchain-program §7.1 and §10). */
export type EvaluationError =
  | "InvalidAmount"
  | "RequestMismatch"
  | "RequestNotApproved"
  | "RequestExpired"
  | "UnsupportedDelegation"
  | "MathOverflow";

/** Account state after an allowed payment (01-onchain-program §7.2). */
export type PaymentEffects = {
  velocity: { windowStart: bigint; count: number };
  /** null when the payment matched no allowlist entry. */
  payee: { periodStart: bigint; spentInPeriod: bigint } | null;
  delegation:
    | { kind: "recurring"; currentPeriodStart: bigint; pulledInPeriod: bigint }
    | { kind: "fixed"; amountRemaining: bigint };
  /** True when the payment consumes an approved request. */
  consumesRequest: boolean;
};

export type EvaluationResult =
  | { outcome: "allowed"; effects: PaymentEffects }
  | { outcome: "denied"; reason: DenialReason; strike: boolean }
  | { outcome: "error"; error: EvaluationError };
