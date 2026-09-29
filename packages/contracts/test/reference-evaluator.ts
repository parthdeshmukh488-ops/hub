// Test-only reference implementation of payment evaluation (01-onchain-program §7), used to
// check the hand-written expectations in test-vectors/policy.json. It is deliberately a
// line-by-line transcription of the spec, not an optimized evaluator. The production
// evaluators live in the program (WS1) and @leash/sdk (WS2); both must match the vectors.
import type { PolicyTestCase } from "../src/index.ts";

type Expect = PolicyTestCase["expect"];
type Effects = NonNullable<Extract<Expect, { outcome: "allowed" }>["effects"]>;

/** Leash windows (§7.2): restart at the first event after the previous window ended. */
function rolled(start: number, secs: number, counter: bigint, now: number): [number, bigint] {
  return start === 0 || now >= start + secs ? [now, 0n] : [start, counter];
}

/** Mirror of Subscriptions' validate_recurring_transfer period roll-forward (§7.3). */
function rollRecurring(
  start: number,
  pulled: bigint,
  periodLength: number,
  expiry: number,
  now: number,
): { start: number; pulled: bigint } | "notStarted" {
  if (now < start) return "notStarted";
  const since = now - start;
  if (since < periodLength) return { start, pulled };
  const candidate = start + Math.floor(since / periodLength) * periodLength;
  if (expiry === 0 || candidate < expiry) return { start: candidate, pulled: 0n };
  const lastBillable = expiry - 1;
  if (lastBillable >= start) {
    const lastStart = start + Math.floor((lastBillable - start) / periodLength) * periodLength;
    if (lastStart > start) return { start: lastStart, pulled: 0n };
  }
  return { start, pulled };
}

/** Subscriptions' is_expired: expiry is inclusive. */
const isExpired = (expiry: number, now: number) => expiry !== 0 && now > expiry;

export function evaluate(c: PolicyTestCase): { expect: Expect; effects?: Effects } {
  const { now } = c;
  const amount = BigInt(c.payment.amount);
  const policy = c.agent.policy;
  const stats = c.agent.stats;
  const destination = c.payment.destinationOwner;

  if (amount === 0n) return { expect: { outcome: "error", error: "InvalidAmount" } };
  if (c.principal.frozen) return { expect: { outcome: "denied", reason: "principalFrozen" } };
  if (c.agent.status === "frozen") return { expect: { outcome: "denied", reason: "agentFrozen" } };
  if (policy.validUntil !== null && now >= policy.validUntil) {
    return { expect: { outcome: "denied", reason: "agentExpired" } };
  }

  const payee =
    c.payee !== null && c.payee.agent === "self" && c.payee.payee === destination ? c.payee : null;
  if (policy.payeeMode === "allowListOnly" && payee === null) {
    return { expect: { outcome: "denied", reason: "payeeNotAllowed" } };
  }

  if (c.request !== null) {
    const r = c.request;
    if (r.agent !== "self") return { expect: { outcome: "error", error: "RequestMismatch" } };
    if (r.status !== "approved")
      return { expect: { outcome: "error", error: "RequestNotApproved" } };
    if (!(now < r.expiresAt)) return { expect: { outcome: "error", error: "RequestExpired" } };
    if (
      r.payee !== destination ||
      r.amount !== c.payment.amount ||
      r.reference !== c.payment.reference
    ) {
      return { expect: { outcome: "error", error: "RequestMismatch" } };
    }
  } else {
    if (amount > BigInt(policy.maxPerPayment)) {
      const maxPerRequest = BigInt(policy.maxPerRequest);
      const reason =
        maxPerRequest !== 0n && amount <= maxPerRequest
          ? "approvalRequired"
          : "exceedsPaymentLimit";
      return { expect: { outcome: "denied", reason } };
    }
    if (payee && BigInt(payee.maxPerPayment) !== 0n && amount > BigInt(payee.maxPerPayment)) {
      return { expect: { outcome: "denied", reason: "exceedsPayeePaymentLimit" } };
    }
    if (payee && BigInt(payee.periodLimit) !== 0n) {
      const [, spent] = rolled(
        payee.periodStart,
        payee.periodSecs,
        BigInt(payee.spentInPeriod),
        now,
      );
      if (spent + amount > BigInt(payee.periodLimit)) {
        return { expect: { outcome: "denied", reason: "exceedsPayeePeriodLimit" } };
      }
    }
  }

  let velocity: [number, bigint] = [stats.velocityWindowStart, BigInt(stats.velocityCount)];
  if (policy.velocityMaxPayments !== 0) {
    velocity = rolled(
      stats.velocityWindowStart,
      policy.velocityWindowSecs,
      BigInt(stats.velocityCount),
      now,
    );
    if (velocity[1] + 1n > BigInt(policy.velocityMaxPayments)) {
      return { expect: { outcome: "denied", reason: "velocityExceeded" } };
    }
    velocity = [velocity[0], velocity[1] + 1n];
  }

  const effects: Effects = {
    velocityWindowStart: velocity[0],
    velocityCount: Number(velocity[1]),
  };

  const d = c.delegation;
  if (isExpired(d.expiryTs, now))
    return { expect: { outcome: "denied", reason: "allowanceExpired" } };
  if (d.kind === "fixed") {
    if (amount > BigInt(d.amountRemaining)) {
      return { expect: { outcome: "denied", reason: "allowanceExceeded" } };
    }
    effects.delegationAmountRemaining = (BigInt(d.amountRemaining) - amount).toString();
  } else {
    const period = rollRecurring(
      d.currentPeriodStart,
      BigInt(d.pulledInPeriod),
      d.periodLengthSecs,
      d.expiryTs,
      now,
    );
    if (period === "notStarted" || period.pulled + amount > BigInt(d.amountPerPeriod)) {
      return { expect: { outcome: "denied", reason: "allowanceExceeded" } };
    }
    effects.delegationPeriodStart = period.start;
    effects.delegationPulledInPeriod = (period.pulled + amount).toString();
  }

  if (BigInt(c.sourceAmount) < amount)
    return { expect: { outcome: "denied", reason: "insufficientFunds" } };

  // Payee accounting applies to every allowed payment to a matching entry with a period limit,
  // including approved requests (whose limit checks were skipped).
  if (payee) {
    if (BigInt(payee.periodLimit) !== 0n) {
      const [start, spent] = rolled(
        payee.periodStart,
        payee.periodSecs,
        BigInt(payee.spentInPeriod),
        now,
      );
      effects.payeePeriodStart = start;
      effects.payeeSpentInPeriod = (spent + amount).toString();
    } else {
      effects.payeePeriodStart = payee.periodStart;
      effects.payeeSpentInPeriod = payee.spentInPeriod;
    }
  }
  return { expect: { outcome: "allowed" }, effects };
}
