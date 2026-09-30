import { describe, expect, it } from "vitest";
import {
  ApprovalNotPossibleError,
  LeashNetworkError,
  LeashSdkError,
  MerchantRejectedError,
  NotPairedError,
  PaymentDeniedError,
  UnsupportedPaymentError,
} from "../src/index.ts";

describe("SDK errors", () => {
  it("carry a stable code and stay LeashSdkErrors", () => {
    const errors = [
      new PaymentDeniedError({
        reason: "payeeNotAllowed",
        recorded: true,
        attempted: { to: "A", amount: 1n },
        strikes: 2,
      }),
      new ApprovalNotPossibleError("tooManyOpen"),
      new NotPairedError(),
      new UnsupportedPaymentError("network solana:mainnet"),
      new MerchantRejectedError("settlement failed"),
      new LeashNetworkError("RPC timeout"),
    ];
    expect(errors.map((e) => e.code)).toEqual([
      "PAYMENT_DENIED",
      "APPROVAL_NOT_POSSIBLE",
      "NOT_PAIRED",
      "UNSUPPORTED_PAYMENT",
      "MERCHANT_REJECTED",
      "NETWORK_ERROR",
    ]);
    expect(errors.every((e) => e instanceof LeashSdkError && e instanceof Error)).toBe(true);
  });

  it("keep what the tools need from a denial", () => {
    const denied = new PaymentDeniedError({
      reason: "exceedsPaymentLimit",
      recorded: false,
      attempted: { to: "Merchant", amount: 9_000_000n },
    });
    expect(denied).toMatchObject({
      reason: "exceedsPaymentLimit",
      recorded: false,
      strikes: undefined,
      frozen: undefined,
    });
    expect(denied.attempted.amount).toBe(9_000_000n);
    expect(new ApprovalNotPossibleError("notNeeded").why).toBe("notNeeded");
  });
});
