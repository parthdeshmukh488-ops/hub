import { getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { I64_MAX } from "../src/allowance.ts";
import {
  allowanceAt,
  allowanceRemaining,
  type DelegationState,
  decodeDelegation,
  isAllowanceExpired,
  LeashSdkError,
  rollRecurringPeriod,
} from "../src/index.ts";

const T = 1_790_935_200n;
const DAY = 86_400n;
const recurring = (patch: Partial<Extract<DelegationState, { kind: "recurring" }>> = {}) => ({
  kind: "recurring" as const,
  amountPerPeriod: 5_000_000n,
  periodLengthSecs: DAY,
  currentPeriodStart: T - 3600n,
  pulledInPeriod: 100_000n,
  expiryTs: 0n,
  ...patch,
});

describe("isAllowanceExpired (inclusive, as upstream)", () => {
  it("never expires without an expiry", () => expect(isAllowanceExpired(0n, T)).toBe(false));
  it("is still valid at exactly the expiry second", () =>
    expect(isAllowanceExpired(T, T)).toBe(false));
  it("expires one second later", () => expect(isAllowanceExpired(T, T + 1n)).toBe(true));
});

describe("rollRecurringPeriod", () => {
  it("keeps the period while it runs", () => {
    expect(rollRecurringPeriod(recurring(), T)).toEqual({
      currentPeriodStart: T - 3600n,
      pulledInPeriod: 100_000n,
    });
  });

  it("advances by whole periods and resets usage", () => {
    const d = recurring({ currentPeriodStart: T - 2n * DAY - 5n, pulledInPeriod: 5_000_000n });
    expect(rollRecurringPeriod(d, T)).toEqual({ currentPeriodStart: T - 5n, pulledInPeriod: 0n });
  });

  it("opens no fresh period at the expiry boundary (clamp)", () => {
    const d = recurring({ currentPeriodStart: T - DAY, expiryTs: T, pulledInPeriod: 4_995_000n });
    expect(rollRecurringPeriod(d, T)).toEqual({
      currentPeriodStart: T - DAY,
      pulledInPeriod: 4_995_000n,
    });
  });

  it("clamps to the last in-bounds period when several periods passed", () => {
    // Start at T-3d with expiry at T+1h: periods at T-2d, T-1d and T are all before expiry,
    // so the roll lands on T normally. With expiry exactly at T, the last in-bounds start is T-1d.
    const d = recurring({ currentPeriodStart: T - 3n * DAY, expiryTs: T, pulledInPeriod: 7n });
    expect(rollRecurringPeriod(d, T)).toEqual({ currentPeriodStart: T - DAY, pulledInPeriod: 0n });
  });

  it("reports a period that has not started, and a period length of 0 or beyond i64", () => {
    expect(rollRecurringPeriod(recurring({ currentPeriodStart: T + 1n }), T)).toBe("notStarted");
    expect(rollRecurringPeriod(recurring({ periodLengthSecs: 0n }), T)).toBe("invalid");
    expect(rollRecurringPeriod(recurring({ periodLengthSecs: I64_MAX + 1n }), T)).toBe("invalid");
  });

  it("keeps the period when the expiry is at or before its start (callers check expiry first)", () => {
    const d = recurring({
      currentPeriodStart: T - 3n * DAY,
      expiryTs: T - 3n * DAY,
      pulledInPeriod: 7n,
    });
    expect(rollRecurringPeriod(d, T)).toEqual({
      currentPeriodStart: T - 3n * DAY,
      pulledInPeriod: 7n,
    });
  });

  it("saturates the elapsed time at i64, as upstream's saturating_sub", () => {
    // Only a negative start gets here. Without saturation the start would land within a day of T.
    const d = recurring({ currentPeriodStart: -I64_MAX, pulledInPeriod: 7n });
    expect(rollRecurringPeriod(d, T)).toEqual({
      currentPeriodStart: -I64_MAX + (I64_MAX / DAY) * DAY,
      pulledInPeriod: 0n,
    });
  });
});

describe("allowanceRemaining", () => {
  it("is what is left in the current period", () => {
    expect(allowanceRemaining(recurring(), T)).toBe(4_900_000n);
  });
  it("is the full period again after a roll-over", () => {
    expect(
      allowanceRemaining(recurring({ currentPeriodStart: T - DAY, pulledInPeriod: 5_000_000n }), T),
    ).toBe(5_000_000n);
  });
  it("is 0 when expired, not started, invalid or over-pulled", () => {
    expect(allowanceRemaining(recurring({ expiryTs: T - 1n }), T)).toBe(0n);
    expect(allowanceRemaining(recurring({ currentPeriodStart: T + 1n }), T)).toBe(0n);
    expect(allowanceRemaining(recurring({ periodLengthSecs: 0n }), T)).toBe(0n);
    expect(allowanceRemaining(recurring({ pulledInPeriod: 6_000_000n }), T)).toBe(0n);
  });
  it("is the remaining amount for a fixed delegation", () => {
    expect(allowanceRemaining({ kind: "fixed", amountRemaining: 42n, expiryTs: 0n }, T)).toBe(42n);
  });
});

// ── Account decoding (01-onchain-program §8.3) ───────────────────────────────

const A = {
  delegator: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  delegatee: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
  payer: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  sa: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  mint: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
};
const addressEncoder = getAddressEncoder();

function encodeHeader(discriminator: number, length: number, version = 1): Uint8Array {
  const data = new Uint8Array(length);
  data[0] = discriminator;
  data[1] = version;
  data[2] = 254; // bump
  data.set(addressEncoder.encode(A.delegator as never), 3);
  data.set(addressEncoder.encode(A.delegatee as never), 35);
  data.set(addressEncoder.encode(A.payer as never), 67);
  new DataView(data.buffer).setBigInt64(99, 123n, true); // init_id
  data.set(addressEncoder.encode(A.sa as never), 107);
  data.set(addressEncoder.encode(A.mint as never), 139);
  return data;
}

function encodeRecurring(): Uint8Array {
  const data = encodeHeader(3, 211);
  const view = new DataView(data.buffer);
  view.setBigInt64(171, T - 3600n, true);
  view.setBigUint64(179, DAY, true);
  view.setBigInt64(187, T + 30n * DAY, true);
  view.setBigUint64(195, 5_000_000n, true);
  view.setBigUint64(203, 1_540_000n, true);
  return data;
}

function encodeFixed(): Uint8Array {
  const data = encodeHeader(2, 187);
  const view = new DataView(data.buffer);
  view.setBigUint64(171, 9_000_000n, true);
  view.setBigInt64(179, 0n, true);
  return data;
}

describe("decodeDelegation", () => {
  it("decodes a recurring delegation", () => {
    const decoded = decodeDelegation("Addr", encodeRecurring());
    expect(decoded).toMatchObject({
      version: 1,
      delegator: A.delegator,
      delegatee: A.delegatee,
      payer: A.payer,
      initId: 123n,
      subscriptionAuthority: A.sa,
      mint: A.mint,
      state: {
        kind: "recurring",
        currentPeriodStart: T - 3600n,
        periodLengthSecs: DAY,
        expiryTs: T + 30n * DAY,
        amountPerPeriod: 5_000_000n,
        pulledInPeriod: 1_540_000n,
      },
    });
  });

  it("decodes a fixed delegation", () => {
    expect(decodeDelegation("Addr", encodeFixed()).state).toEqual({
      kind: "fixed",
      amountRemaining: 9_000_000n,
      expiryTs: 0n,
    });
  });

  it.each([
    ["an unknown discriminator", encodeHeader(4, 211)],
    ["version 2", encodeHeader(3, 211, 2)],
    ["a longer account", encodeHeader(3, 212)],
    ["a truncated account", encodeRecurring().subarray(0, 200)],
    ["an account without a version byte", Uint8Array.of(3)],
    ["an empty account", new Uint8Array(0)],
  ])("rejects %s", (_label, data) => {
    expect(() => decodeDelegation("Addr", data)).toThrow(LeashSdkError);
  });
});

describe("allowanceAt", () => {
  it("builds the contracts view of a recurring delegation, rolled to now", () => {
    const view = allowanceAt(
      decodeDelegation("Delegation1111111111111111111111111", encodeRecurring()),
      T + DAY,
    );
    expect(view).toEqual({
      delegation: "Delegation1111111111111111111111111",
      kind: "recurring",
      mint: A.mint,
      amountPerPeriod: "5000000",
      periodLengthSecs: 86400,
      currentPeriodStart: Number(T - 3600n + DAY),
      pulledInPeriod: "0",
      amountRemaining: null,
      remaining: "5000000",
      expiresAt: Number(T + 30n * DAY),
      asOf: Number(T + DAY),
    });
  });

  it("keeps the stored period when the allowance has not started", () => {
    const decoded = decodeDelegation("Addr", encodeRecurring());
    const view = allowanceAt(decoded, T - 7200n);
    expect(view.currentPeriodStart).toBe(Number(T - 3600n));
    expect(view.remaining).toBe("0");
  });

  it("builds the view of a fixed delegation", () => {
    expect(allowanceAt(decodeDelegation("Addr", encodeFixed()), T)).toMatchObject({
      kind: "fixed",
      amountRemaining: "9000000",
      remaining: "9000000",
      amountPerPeriod: null,
      expiresAt: null,
    });
  });
});
