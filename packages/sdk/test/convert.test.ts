import {
  AGENT_STATUS_CODES,
  DENIAL_REASONS,
  FREEZE_REASON_CODES,
  PAYEE_MODE_CODES,
  type PolicyView,
  REQUEST_STATUS_CODES,
} from "@leash/contracts";
import { describe, expect, it } from "vitest";
import {
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
} from "../src/index.ts";

const view: PolicyView = {
  maxPerPayment: "1000000",
  maxPerRequest: "18446744073709551615",
  payeeMode: "anyPayee",
  velocityMaxPayments: 65_535,
  velocityWindowSecs: 4_294_967_295,
  tripwireMaxStrikes: 255,
  tripwireWindowSecs: 600,
  requestTtlSecs: 3_600,
  validUntil: 1_790_935_200,
};

describe("enum maps", () => {
  it("agree with the codes of @leash/contracts", () => {
    const expected = <T extends string>(codes: Record<T, number>) =>
      Object.fromEntries(Object.entries(codes).map(([name, code]) => [code, name]));
    expect(AGENT_STATUS_FROM_CHAIN).toEqual(expected(AGENT_STATUS_CODES));
    expect(FREEZE_REASON_FROM_CHAIN).toEqual(expected(FREEZE_REASON_CODES));
    expect(PAYEE_MODE_FROM_CHAIN).toEqual(expected(PAYEE_MODE_CODES));
    expect(PAYEE_MODE_TO_CHAIN).toEqual(PAYEE_MODE_CODES);
    expect(REQUEST_STATUS_FROM_CHAIN).toEqual(expected(REQUEST_STATUS_CODES));
    // DenialReason code n is stored as n - 1 (ADR 20260930-ws1-program-interface).
    expect(DENIAL_REASON_FROM_CHAIN).toEqual(
      Object.fromEntries(DENIAL_REASONS.map((d) => [d.code - 1, d.name])),
    );
  });
});

describe("policy conversion", () => {
  it("round-trips a policy view, with and without an end date", () => {
    for (const policy of [
      view,
      { ...view, validUntil: null, payeeMode: "allowListOnly" as const },
    ]) {
      const args = policyFromView(policy);
      const onChain = {
        ...args,
        maxPerPayment: BigInt(args.maxPerPayment),
        maxPerRequest: BigInt(args.maxPerRequest),
        validUntil: BigInt(args.validUntil),
      };
      expect(policyToView(onChain)).toEqual(policy);
    }
    expect(policyFromView({ ...view, validUntil: null }).validUntil).toBe(0n);
  });

  it("converts payee limits and optional times", () => {
    expect(
      payeeLimitsFromView({ maxPerPayment: "2000000", periodLimit: "0", periodSecs: 0 }),
    ).toEqual({
      maxPerPayment: 2_000_000n,
      periodLimit: 0n,
      periodSecs: 0,
    });
    expect(timeOrNull(0n)).toBeNull();
    expect(timeOrNull(1_790_935_200n)).toBe(1_790_935_200);
  });
});
