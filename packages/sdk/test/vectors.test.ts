import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type PolicyTestCase, PolicyTestVectorsSchema, referenceFromHex } from "@leash/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { type EvaluationInput, evaluatePayment } from "../src/index.ts";
import { testKeyAddress } from "../src/testing/index.ts";

// Parity with the program: every shared policy vector, outcome and effects.

const require = createRequire(import.meta.url);
const vectors = PolicyTestVectorsSchema.parse(
  JSON.parse(readFileSync(require.resolve("@leash/contracts/test-vectors/policy.json"), "utf8")),
);

const addresses = new Map<string, string>();
beforeAll(async () => {
  for (const name of [...Object.keys(vectors.keys), "agent", "otherAgent"]) {
    addresses.set(name, await testKeyAddress(name));
  }
});

function address(name: string): string {
  const value = addresses.get(name);
  if (!value) throw new Error(`no test key ${name}`);
  return value;
}

function toInput(c: PolicyTestCase): EvaluationInput {
  const agentAddress = (owner: "self" | "other") =>
    address(owner === "self" ? "agent" : "otherAgent");
  const { policy, stats } = c.agent;
  return {
    now: BigInt(c.now),
    principalFrozen: c.principal.frozen,
    agent: {
      address: address("agent"),
      status: c.agent.status,
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
      velocityWindowStart: BigInt(stats.velocityWindowStart),
      velocityCount: stats.velocityCount,
    },
    payeeEntry: c.payee && {
      agent: agentAddress(c.payee.agent),
      payee: address(c.payee.payee),
      maxPerPayment: BigInt(c.payee.maxPerPayment),
      periodLimit: BigInt(c.payee.periodLimit),
      periodSecs: c.payee.periodSecs,
      periodStart: BigInt(c.payee.periodStart),
      spentInPeriod: BigInt(c.payee.spentInPeriod),
    },
    request: c.request && {
      agent: agentAddress(c.request.agent),
      status: c.request.status,
      payee: address(c.request.payee),
      amount: BigInt(c.request.amount),
      reference: referenceFromHex(c.request.reference),
      expiresAt: BigInt(c.request.expiresAt),
    },
    delegation:
      c.delegation.kind === "fixed"
        ? {
            kind: "fixed",
            amountRemaining: BigInt(c.delegation.amountRemaining),
            expiryTs: BigInt(c.delegation.expiryTs),
          }
        : {
            kind: "recurring",
            amountPerPeriod: BigInt(c.delegation.amountPerPeriod),
            periodLengthSecs: BigInt(c.delegation.periodLengthSecs),
            currentPeriodStart: BigInt(c.delegation.currentPeriodStart),
            pulledInPeriod: BigInt(c.delegation.pulledInPeriod),
            expiryTs: BigInt(c.delegation.expiryTs),
          },
    sourceAmount: BigInt(c.sourceAmount),
    payment: {
      amount: BigInt(c.payment.amount),
      destinationOwner: address(c.payment.destinationOwner),
      reference: referenceFromHex(c.payment.reference),
    },
  };
}

describe(`policy test vectors (${vectors.cases.length} cases)`, () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const result = evaluatePayment(toInput(testCase));
    const expected = testCase.expect;

    if (expected.outcome === "denied") {
      expect(result).toMatchObject({ outcome: "denied", reason: expected.reason });
      return;
    }
    if (expected.outcome === "error") {
      expect(result).toEqual({ outcome: "error", error: expected.error });
      return;
    }
    if (result.outcome !== "allowed")
      throw new Error(`expected allowed, got ${JSON.stringify(result)}`);
    const { effects } = result;
    const actual = {
      velocityWindowStart: Number(effects.velocity.windowStart),
      velocityCount: effects.velocity.count,
      payeePeriodStart: effects.payee ? Number(effects.payee.periodStart) : undefined,
      payeeSpentInPeriod: effects.payee?.spentInPeriod.toString(),
      delegationPeriodStart:
        effects.delegation.kind === "recurring"
          ? Number(effects.delegation.currentPeriodStart)
          : undefined,
      delegationPulledInPeriod:
        effects.delegation.kind === "recurring"
          ? effects.delegation.pulledInPeriod.toString()
          : undefined,
      delegationAmountRemaining:
        effects.delegation.kind === "fixed"
          ? effects.delegation.amountRemaining.toString()
          : undefined,
    };
    expect(actual).toMatchObject(expected.effects ?? {});
    expect(effects.consumesRequest).toBe(testCase.request !== null);
  });
});
