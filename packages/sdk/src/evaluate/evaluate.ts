import { type DenialReason, isStrike, U64_MAX } from "@leash/contracts";
import { I64_MAX, isAllowanceExpired, rollRecurringPeriod } from "../allowance.ts";
import type {
  DelegationState,
  EvaluationError,
  EvaluationInput,
  EvaluationResult,
  PaymentEffects,
  PaymentRequestState,
} from "./types.ts";

// The policy evaluation of the Leash program (01-onchain-program §7), mirrored line by line.
// The program is the authority; this copy lets the SDK, the web app and the tools predict the
// outcome of a payment without sending a transaction. `test-vectors/policy.json` proves the two
// agree: change both, or neither.

class Overflow extends Error {}

/** Checked u64 addition, as `checked_add` on-chain. */
function addU64(a: bigint, b: bigint): bigint {
  const sum = a + b;
  if (sum > U64_MAX) throw new Overflow();
  return sum;
}

/**
 * Leash windows (§7.2): a window restarts at the first event after the previous one ended.
 * A start of 0 means the window never started.
 */
export function rollWindow(
  start: bigint,
  lengthSecs: number,
  counter: bigint,
  now: bigint,
): { start: bigint; counter: bigint } {
  if (start === 0n) return { start: now, counter: 0n };
  const end = start + BigInt(lengthSecs);
  if (end > I64_MAX) throw new Overflow();
  return now >= end ? { start: now, counter: 0n } : { start, counter };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function denied(reason: DenialReason): EvaluationResult {
  return { outcome: "denied", reason, strike: isStrike(reason) };
}

function failed(error: EvaluationError): EvaluationResult {
  return { outcome: "error", error };
}

function requestError(
  request: PaymentRequestState,
  input: EvaluationInput,
): EvaluationError | null {
  if (request.agent !== input.agent.address) return "RequestMismatch";
  if (request.status !== "approved") return "RequestNotApproved";
  if (input.now >= request.expiresAt) return "RequestExpired";
  const { payment } = input;
  if (
    request.payee !== payment.destinationOwner ||
    request.amount !== payment.amount ||
    !bytesEqual(request.reference, payment.reference)
  ) {
    return "RequestMismatch";
  }
  return null;
}

type AllowanceOutcome =
  | { ok: true; effects: PaymentEffects["delegation"] }
  | { ok: false; result: EvaluationResult };

/** Step 10: the allowance pre-check, mirroring the Subscriptions validation (§7.3). */
function checkAllowance(
  delegation: DelegationState,
  amount: bigint,
  now: bigint,
): AllowanceOutcome {
  if (isAllowanceExpired(delegation.expiryTs, now)) {
    return { ok: false, result: denied("allowanceExpired") };
  }
  if (delegation.kind === "fixed") {
    if (amount > delegation.amountRemaining) {
      return { ok: false, result: denied("allowanceExceeded") };
    }
    return {
      ok: true,
      effects: { kind: "fixed", amountRemaining: delegation.amountRemaining - amount },
    };
  }
  const period = rollRecurringPeriod(delegation, now);
  if (period === "invalid") return { ok: false, result: failed("UnsupportedDelegation") };
  if (period === "notStarted") return { ok: false, result: denied("allowanceExceeded") };
  // Upstream computes `available = amount_per_period - pulled` (an underflow is an error there,
  // meaning nothing is left) and compares the amount against it, so it can never overflow.
  if (period.pulledInPeriod > delegation.amountPerPeriod) {
    return { ok: false, result: denied("allowanceExceeded") };
  }
  const available = delegation.amountPerPeriod - period.pulledInPeriod;
  if (amount > available) return { ok: false, result: denied("allowanceExceeded") };
  return {
    ok: true,
    effects: {
      kind: "recurring",
      currentPeriodStart: period.currentPeriodStart,
      pulledInPeriod: period.pulledInPeriod + amount,
    },
  };
}

/**
 * Evaluates a payment exactly as the Leash program's `pay` would (01-onchain-program §7.1):
 * the first failing check wins. For an allowed payment it also returns the account state the
 * program would write (§7.2).
 *
 * Pure: it reads only its input and never mutates it.
 */
export function evaluatePayment(input: EvaluationInput): EvaluationResult {
  try {
    return evaluate(input);
  } catch (error) {
    if (error instanceof Overflow) return failed("MathOverflow");
    throw error;
  }
}

function evaluate(input: EvaluationInput): EvaluationResult {
  const { now, agent, payment } = input;
  const { policy } = agent;
  const { amount } = payment;

  // 0–3: amount, freezes, expiry.
  if (amount === 0n) return failed("InvalidAmount");
  if (input.principalFrozen) return denied("principalFrozen");
  if (agent.status === "frozen") return denied("agentFrozen");
  if (policy.validUntil !== 0n && now >= policy.validUntil) return denied("agentExpired");

  // 4: the allowlist. An entry counts only if it belongs to this agent and names the owner of
  // the destination token account.
  const entry = input.payeeEntry;
  const matchedEntry =
    entry !== null && entry.agent === agent.address && entry.payee === payment.destinationOwner
      ? entry
      : null;
  if (policy.payeeMode === "allowListOnly" && matchedEntry === null) {
    return denied("payeeNotAllowed");
  }

  if (input.request !== null) {
    // 5: an approved request waives checks 6–8 for exactly this payee, amount and reference.
    const error = requestError(input.request, input);
    if (error !== null) return failed(error);
  } else {
    // 6: instant limit, or approval.
    if (amount > policy.maxPerPayment) {
      return policy.maxPerRequest !== 0n && amount <= policy.maxPerRequest
        ? denied("approvalRequired")
        : denied("exceedsPaymentLimit");
    }
    if (matchedEntry !== null) {
      // 7: the payee's per-payment cap.
      if (matchedEntry.maxPerPayment !== 0n && amount > matchedEntry.maxPerPayment) {
        return denied("exceedsPayeePaymentLimit");
      }
      // 8: the payee's period budget.
      if (matchedEntry.periodLimit !== 0n) {
        const window = rollWindow(
          matchedEntry.periodStart,
          matchedEntry.periodSecs,
          matchedEntry.spentInPeriod,
          now,
        );
        if (addU64(window.counter, amount) > matchedEntry.periodLimit) {
          return denied("exceedsPayeePeriodLimit");
        }
      }
    }
  }

  // 9: the rate limit. A limit that is off is not tracked (ADR 20260929-ws0-disabled-limits).
  let velocity: PaymentEffects["velocity"] = {
    windowStart: agent.velocityWindowStart,
    count: agent.velocityCount,
  };
  if (policy.velocityMaxPayments !== 0) {
    const window = rollWindow(
      agent.velocityWindowStart,
      policy.velocityWindowSecs,
      BigInt(agent.velocityCount),
      now,
    );
    const count = window.counter + 1n;
    if (count > BigInt(policy.velocityMaxPayments)) return denied("velocityExceeded");
    velocity = { windowStart: window.start, count: Number(count) };
  }

  // 10: the allowance ceiling (I1).
  const allowance = checkAllowance(input.delegation, amount, now);
  if (!allowance.ok) return allowance.result;

  // 11: the owner's balance.
  if (input.sourceAmount < amount) return denied("insufficientFunds");

  // Payee accounting: every allowed payment to a matching entry with a period limit counts,
  // approved requests included (their limit checks were waived, not their spend).
  let payee: PaymentEffects["payee"] = null;
  if (matchedEntry !== null) {
    if (matchedEntry.periodLimit !== 0n) {
      const window = rollWindow(
        matchedEntry.periodStart,
        matchedEntry.periodSecs,
        matchedEntry.spentInPeriod,
        now,
      );
      payee = { periodStart: window.start, spentInPeriod: addU64(window.counter, amount) };
    } else {
      payee = { periodStart: matchedEntry.periodStart, spentInPeriod: matchedEntry.spentInPeriod };
    }
  }

  return {
    outcome: "allowed",
    effects: {
      velocity,
      payee,
      delegation: allowance.effects,
      consumesRequest: input.request !== null,
    },
  };
}
