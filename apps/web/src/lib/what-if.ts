import { type AgentView, type AllowanceView, denialInfo, U64_MAX } from "@leash/contracts";
import { type DelegationState, type EvaluationError, evaluatePayment } from "@leash/sdk";
import { usdc } from "./format.ts";
import type { PayeeRow } from "./payees.ts";
import type { Tone } from "./status.ts";

// "What would happen if the agent paid X to Y?" answered by the SDK's copy of the program's
// evaluation (01-onchain-program §7), from the agent's current views.

export type WhatIfOutcome = { tone: Tone; title: string; detail: string };

/** The Subscriptions delegation behind an `AllowanceView`, as the evaluator reads it. */
export function delegationFromView(allowance: AllowanceView): DelegationState {
  const expiryTs = BigInt(allowance.expiresAt ?? 0);
  if (allowance.kind === "fixed") {
    return {
      kind: "fixed",
      amountRemaining: BigInt(allowance.amountRemaining ?? allowance.remaining),
      expiryTs,
    };
  }
  return {
    kind: "recurring",
    amountPerPeriod: BigInt(allowance.amountPerPeriod ?? "0"),
    periodLengthSecs: BigInt(allowance.periodLengthSecs ?? 0),
    currentPeriodStart: BigInt(allowance.currentPeriodStart ?? 0),
    pulledInPeriod: BigInt(allowance.pulledInPeriod ?? "0"),
    expiryTs,
  };
}

const ERRORS: Record<EvaluationError, string> = {
  InvalidAmount: "Enter an amount above zero.",
  MathOverflow: "The amount is too large.",
  UnsupportedDelegation: "The allowance cannot be read.",
  RequestMismatch: "The request does not match.",
  RequestNotApproved: "The request is not approved.",
  RequestExpired: "The request has expired.",
};

/**
 * Predicts a payment by `agent` to `destination`. `payee` is this agent's allowlist entry for
 * that destination, if any. The owner's balance is not known here, so it is assumed to be
 * enough: the answer is about the rules, not the wallet.
 */
export function whatIf(args: {
  agent: AgentView;
  principalFrozen: boolean;
  payee: PayeeRow | null;
  destination: string;
  amount: bigint;
  now: number;
}): WhatIfOutcome {
  const { agent, payee, amount } = args;
  if (agent.allowance === null) {
    return {
      tone: "blocked",
      title: "Blocked",
      detail: "This agent has no allowance, so it cannot pay anything.",
    };
  }
  const { policy, stats } = agent;
  const result = evaluatePayment({
    now: BigInt(args.now),
    principalFrozen: args.principalFrozen,
    agent: {
      address: agent.address,
      status: agent.status,
      policy: {
        maxPerPayment: BigInt(policy.maxPerPayment),
        maxPerRequest: BigInt(policy.maxPerRequest),
        payeeMode: policy.payeeMode,
        velocityMaxPayments: policy.velocityMaxPayments,
        velocityWindowSecs: policy.velocityWindowSecs,
        tripwireMaxStrikes: policy.tripwireMaxStrikes,
        tripwireWindowSecs: policy.tripwireWindowSecs,
        requestTtlSecs: policy.requestTtlSecs,
        validUntil: BigInt(policy.validUntil ?? 0),
      },
      velocityWindowStart: BigInt(stats.velocityWindowStart ?? 0),
      velocityCount: stats.velocityCount,
    },
    payeeEntry:
      payee === null
        ? null
        : {
            agent: agent.address,
            payee: payee.payee,
            maxPerPayment: payee.maxPerPayment,
            periodLimit: payee.periodLimit,
            periodSecs: payee.periodSecs,
            periodStart: BigInt(payee.periodStart ?? 0),
            spentInPeriod: payee.spentInPeriod,
          },
    request: null,
    delegation: delegationFromView(agent.allowance),
    sourceAmount: U64_MAX,
    payment: { amount, destinationOwner: args.destination, reference: new Uint8Array(32) },
  });

  if (result.outcome === "allowed") {
    return { tone: "ok", title: "Goes through", detail: "The agent can pay this on its own." };
  }
  if (result.outcome === "error") {
    return { tone: "blocked", title: "Rejected", detail: ERRORS[result.error] };
  }
  if (result.reason === "approvalRequired") {
    return {
      tone: "approval",
      title: "Needs your approval",
      detail: `It is above ${usdc(policy.maxPerPayment)} USDC per payment, so the agent has to ask you first.`,
    };
  }
  const strike = result.strike ? " The attempt would count as a strike." : "";
  return {
    tone: "blocked",
    title: "Blocked",
    detail: `${denialInfo(result.reason).ownerCopy}.${strike}`,
  };
}
