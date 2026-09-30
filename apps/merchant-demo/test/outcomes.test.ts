import { POLICY_PRESETS } from "@leash/contracts";
import { type EvaluationInput, evaluatePayment } from "@leash/sdk";
import { describe, expect, it } from "vitest";
import { ROUTES, type RouteId } from "../src/catalog.ts";
import { wallets } from "./helpers.ts";

// The demo storyline depends on these prices (WS9 storyline, threats T1 and T4). This runs every
// paid route through the SDK's copy of the program's rules, under the preset the demo pairs.

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("research-assistant preset is incomplete");
  return value;
}

const preset = POLICY_PRESETS["research-assistant"];
const policy = required(preset.policy);
const limits = required(preset.payees[0]?.limits);

const AGENT = "Agent111111111111111111111111111111111111111";
const NOW = 1_800_000_000n;

function attempt(route: RouteId, velocityCount = 0): ReturnType<typeof evaluatePayment> {
  const spec = ROUTES[route];
  if (spec.price === null || spec.payTo === null) throw new Error(`${route} is free`);
  const input: EvaluationInput = {
    now: NOW,
    principalFrozen: false,
    agent: {
      address: AGENT,
      status: "active",
      policy: {
        ...policy,
        maxPerPayment: BigInt(policy.maxPerPayment),
        maxPerRequest: BigInt(policy.maxPerRequest),
        validUntil: 0n,
      },
      velocityWindowStart: NOW - 10n,
      velocityCount,
    },
    // Only the merchant is allowlisted, as in the pairing preset.
    payeeEntry: {
      agent: AGENT,
      payee: wallets.merchant,
      maxPerPayment: BigInt(limits.maxPerPayment),
      periodLimit: BigInt(limits.periodLimit),
      periodSecs: limits.periodSecs,
      periodStart: 0n,
      spentInPeriod: 0n,
    },
    request: null,
    delegation: {
      kind: "recurring",
      amountPerPeriod: 5_000_000n,
      periodLengthSecs: 86_400n,
      currentPeriodStart: NOW - 60n,
      pulledInPeriod: 0n,
      expiryTs: 0n,
    },
    sourceAmount: 100_000_000n,
    payment: {
      amount: spec.price,
      destinationOwner: wallets[spec.payTo],
      reference: new Uint8Array(32),
    },
  };
  return evaluatePayment(input);
}

describe("what Leash does with each paid route (research-assistant preset)", () => {
  it("lets research, market data and the loop's first pages through", () => {
    expect(attempt("research").outcome).toBe("allowed");
    expect(attempt("market").outcome).toBe("allowed");
    expect(attempt("loop").outcome).toBe("allowed");
  });

  it("asks the owner for the premium report (the approval scene)", () => {
    expect(attempt("premium")).toEqual({
      outcome: "denied",
      reason: "approvalRequired",
      strike: false,
    });
  });

  it("blocks the injected tip as an unknown payee, a strike (the attack scene)", () => {
    expect(attempt("unlock")).toEqual({
      outcome: "denied",
      reason: "payeeNotAllowed",
      strike: true,
    });
  });

  it("blocks the overpriced research above even the approval limit, a strike", () => {
    expect(attempt("researchPremium")).toEqual({
      outcome: "denied",
      reason: "exceedsPaymentLimit",
      strike: true,
    });
  });

  it("stops the loop at the rate limit", () => {
    expect(attempt("loop", policy.velocityMaxPayments)).toEqual({
      outcome: "denied",
      reason: "velocityExceeded",
      strike: false,
    });
  });
});
