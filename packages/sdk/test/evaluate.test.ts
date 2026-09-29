import { isStrike, U64_MAX } from "@leash/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allowanceRemaining,
  type EvaluationInput,
  evaluatePayment,
  rollWindow,
} from "../src/index.ts";

const T = 1_790_935_200n;
const AGENT = "Agent111111111111111111111111111111111111111";
const MERCHANT = "Merchant11111111111111111111111111111111111";
const ATTACKER = "Attacker11111111111111111111111111111111111";
const REF = new Uint8Array(32).fill(7);

function input(patch: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    now: T,
    principalFrozen: false,
    agent: {
      address: AGENT,
      status: "active",
      policy: {
        maxPerPayment: 1_000_000n,
        maxPerRequest: 5_000_000n,
        payeeMode: "allowListOnly",
        velocityMaxPayments: 30,
        velocityWindowSecs: 60,
        tripwireMaxStrikes: 3,
        tripwireWindowSecs: 600,
        requestTtlSecs: 3600,
        validUntil: 0n,
      },
      velocityWindowStart: T - 30n,
      velocityCount: 5,
    },
    payeeEntry: {
      agent: AGENT,
      payee: MERCHANT,
      maxPerPayment: 2_000_000n,
      periodLimit: 3_000_000n,
      periodSecs: 86_400,
      periodStart: T - 3600n,
      spentInPeriod: 100_000n,
    },
    request: null,
    delegation: {
      kind: "recurring",
      amountPerPeriod: 5_000_000n,
      periodLengthSecs: 86_400n,
      currentPeriodStart: T - 3600n,
      pulledInPeriod: 100_000n,
      expiryTs: 0n,
    },
    sourceAmount: 100_000_000n,
    payment: { amount: 10_000n, destinationOwner: MERCHANT, reference: REF },
    ...patch,
  };
}

describe("branches the vectors do not reach", () => {
  it("reports a payee spend that would overflow u64", () => {
    const base = input();
    const result = evaluatePayment(
      input({
        payeeEntry: base.payeeEntry && {
          ...base.payeeEntry,
          periodLimit: U64_MAX,
          spentInPeriod: U64_MAX,
        },
      }),
    );
    expect(result).toEqual({ outcome: "error", error: "MathOverflow" });
  });

  it("reports a window end beyond i64", () => {
    const base = input();
    const result = evaluatePayment(
      input({ agent: { ...base.agent, velocityWindowStart: 9_223_372_036_854_775_800n } }),
    );
    expect(result).toEqual({ outcome: "error", error: "MathOverflow" });
  });

  it("rejects a recurring delegation with a zero period", () => {
    const result = evaluatePayment(
      input({
        delegation: {
          kind: "recurring",
          amountPerPeriod: 5_000_000n,
          periodLengthSecs: 0n,
          currentPeriodStart: T,
          pulledInPeriod: 0n,
          expiryTs: 0n,
        },
      }),
    );
    expect(result).toEqual({ outcome: "error", error: "UnsupportedDelegation" });
  });

  it("denies when the delegation is already over-pulled", () => {
    const result = evaluatePayment(
      input({
        delegation: {
          kind: "recurring",
          amountPerPeriod: 5_000_000n,
          periodLengthSecs: 86_400n,
          currentPeriodStart: T - 10n,
          pulledInPeriod: 6_000_000n,
          expiryTs: 0n,
        },
      }),
    );
    expect(result).toMatchObject({ outcome: "denied", reason: "allowanceExceeded" });
  });

  it("treats a reference of another length as a mismatch", () => {
    const result = evaluatePayment(
      input({
        request: {
          agent: AGENT,
          status: "approved",
          payee: MERCHANT,
          amount: 10_000n,
          reference: new Uint8Array(31),
          expiresAt: T + 60n,
        },
      }),
    );
    expect(result).toEqual({ outcome: "error", error: "RequestMismatch" });
  });

  it("marks strikes on denials", () => {
    expect(evaluatePayment(input({ payeeEntry: null }))).toEqual({
      outcome: "denied",
      reason: "payeeNotAllowed",
      strike: true,
    });
    expect(evaluatePayment(input({ sourceAmount: 0n }))).toEqual({
      outcome: "denied",
      reason: "insufficientFunds",
      strike: false,
    });
  });

  it("rethrows unexpected errors", () => {
    const broken = input();
    Object.defineProperty(broken, "delegation", {
      get() {
        throw new TypeError("boom");
      },
    });
    expect(() => evaluatePayment(broken)).toThrow(TypeError);
  });
});

describe("rollWindow", () => {
  it("starts a window that never started", () => {
    expect(rollWindow(0n, 60, 9n, T)).toEqual({ start: T, counter: 0n });
  });
  it("keeps a running window and restarts an elapsed one", () => {
    expect(rollWindow(T - 59n, 60, 9n, T)).toEqual({ start: T - 59n, counter: 9n });
    expect(rollWindow(T - 60n, 60, 9n, T)).toEqual({ start: T, counter: 0n });
  });
});

// ── Invariants over random states ────────────────────────────────────────────

const amount = fc.bigInt({ min: 0n, max: 10_000_000n });
const time = fc.bigInt({ min: T - 200_000n, max: T + 200_000n });
const arbitraryInput = fc
  .record({
    now: time,
    principalFrozen: fc.boolean(),
    frozen: fc.boolean(),
    anyPayee: fc.boolean(),
    maxPerPayment: fc.bigInt({ min: 1n, max: 3_000_000n }),
    maxPerRequest: fc.oneof(fc.constant(0n), fc.bigInt({ min: 3_000_001n, max: 8_000_000n })),
    velocityMax: fc.integer({ min: 0, max: 40 }),
    velocityCount: fc.integer({ min: 0, max: 45 }),
    velocityStart: time,
    validUntil: fc.oneof(fc.constant(0n), time),
    hasEntry: fc.boolean(),
    entryForOtherAgent: fc.boolean(),
    entryPayMerchant: fc.boolean(),
    entryMax: amount,
    entryLimit: amount,
    entrySpent: amount,
    entryStart: fc.oneof(fc.constant(0n), time),
    fixed: fc.boolean(),
    perPeriod: amount,
    pulled: amount,
    periodStart: time,
    expiry: fc.oneof(fc.constant(0n), time),
    source: amount,
    payAmount: amount,
    toMerchant: fc.boolean(),
  })
  .map(
    (r): EvaluationInput => ({
      now: r.now,
      principalFrozen: r.principalFrozen,
      agent: {
        address: AGENT,
        status: r.frozen ? "frozen" : "active",
        policy: {
          maxPerPayment: r.maxPerPayment,
          maxPerRequest: r.maxPerRequest,
          payeeMode: r.anyPayee ? "anyPayee" : "allowListOnly",
          velocityMaxPayments: r.velocityMax,
          velocityWindowSecs: r.velocityMax === 0 ? 0 : 60,
          tripwireMaxStrikes: 3,
          tripwireWindowSecs: 600,
          requestTtlSecs: 3600,
          validUntil: r.validUntil,
        },
        velocityWindowStart: r.velocityStart,
        velocityCount: r.velocityCount,
      },
      payeeEntry: r.hasEntry
        ? {
            agent: r.entryForOtherAgent ? "Other111111111111111111111111111111111111111" : AGENT,
            payee: r.entryPayMerchant ? MERCHANT : ATTACKER,
            maxPerPayment: r.entryMax,
            periodLimit: r.entryLimit,
            periodSecs: r.entryLimit === 0n ? 0 : 86_400,
            periodStart: r.entryStart,
            spentInPeriod: r.entrySpent,
          }
        : null,
      request: null,
      delegation: r.fixed
        ? { kind: "fixed", amountRemaining: r.perPeriod, expiryTs: r.expiry }
        : {
            kind: "recurring",
            amountPerPeriod: r.perPeriod,
            periodLengthSecs: 86_400n,
            currentPeriodStart: r.periodStart,
            pulledInPeriod: r.pulled,
            expiryTs: r.expiry,
          },
      sourceAmount: r.source,
      payment: {
        amount: r.payAmount,
        destinationOwner: r.toMerchant ? MERCHANT : ATTACKER,
        reference: REF,
      },
    }),
  );

describe("invariants", () => {
  it("I1: an allowed payment never exceeds the allowance, the balance or the instant limit", () => {
    fc.assert(
      fc.property(arbitraryInput, (i) => {
        const result = evaluatePayment(i);
        if (result.outcome !== "allowed") return;
        expect(i.payment.amount > 0n).toBe(true);
        expect(i.payment.amount <= allowanceRemaining(i.delegation, i.now)).toBe(true);
        expect(i.payment.amount <= i.sourceAmount).toBe(true);
        expect(i.payment.amount <= i.agent.policy.maxPerPayment).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("I2: in allow-list mode, only this agent's entry for the destination lets money through", () => {
    fc.assert(
      fc.property(arbitraryInput, (i) => {
        const result = evaluatePayment(i);
        if (result.outcome !== "allowed" || i.agent.policy.payeeMode !== "allowListOnly") return;
        expect(i.payeeEntry?.agent).toBe(AGENT);
        expect(i.payeeEntry?.payee).toBe(i.payment.destinationOwner);
      }),
      { numRuns: 2000 },
    );
  });

  it("I3: nothing is allowed while the principal or the agent is frozen", () => {
    fc.assert(
      fc.property(arbitraryInput, (i) => {
        if (!i.principalFrozen && i.agent.status !== "frozen") return;
        expect(evaluatePayment(i).outcome).not.toBe("allowed");
      }),
    );
  });

  it("marks strikes exactly as the master table does, and never mutates its input", () => {
    fc.assert(
      fc.property(arbitraryInput, (i) => {
        const before = structuredClone(i);
        const result = evaluatePayment(i);
        if (result.outcome === "denied") expect(result.strike).toBe(isStrike(result.reason));
        expect(i).toEqual(before);
        expect(evaluatePayment(i)).toEqual(result);
      }),
    );
  });
});
