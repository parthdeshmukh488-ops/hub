import type { AllowanceView } from "@leash/contracts";
import { getAddressDecoder } from "@solana/kit";
import { LeashSdkError } from "./errors.ts";
import type { DelegationState } from "./evaluate/types.ts";

// The Subscriptions program's allowance semantics (01-onchain-program §7.3 and §8.3), ported
// from `program/src/instructions/helpers/transfer_validation.rs` of
// github.com/solana-foundation/subscriptions (v0.5 line). Keep this file byte-for-byte faithful:
// the Leash program mirrors the same logic, and the policy test vectors pin both.

/**
 * Subscriptions' `is_expired`: expiry is inclusive, so a delegation can still be used at
 * exactly `expiryTs` (see ADR 20260929-ws0-allowance-expiry-is-inclusive).
 */
export function isAllowanceExpired(expiryTs: bigint, now: bigint): boolean {
  return expiryTs !== 0n && now > expiryTs;
}

/** Largest Solana timestamp (`i64`). Internal; not re-exported from the package root. */
export const I64_MAX = 9_223_372_036_854_775_807n;

export type RecurringPeriod = { currentPeriodStart: bigint; pulledInPeriod: bigint };
type RecurringState = Extract<DelegationState, { kind: "recurring" }>;

/**
 * The period roll-forward of `validate_recurring_transfer`: once the current period has
 * elapsed, the start moves forward by whole periods and the pulled amount resets. With a finite
 * expiry, no fresh period opens at or after the expiry boundary (the "expiry clamp").
 *
 * Callers check `isAllowanceExpired` first, as upstream does.
 * Returns "notStarted" when `now` is before the current period start, and "invalid" for a period
 * length of 0 or beyond i64 (upstream rejects both; its create instruction never stores one).
 */
export function rollRecurringPeriod(
  delegation: RecurringState,
  now: bigint,
): RecurringPeriod | "notStarted" | "invalid" {
  const { periodLengthSecs: period, expiryTs: expiry } = delegation;
  const start = delegation.currentPeriodStart;
  const pulled = delegation.pulledInPeriod;
  if (period <= 0n || period > I64_MAX) return "invalid";
  if (now < start) return "notStarted";
  // Upstream uses `saturating_sub`; the difference only exceeds i64 for a negative start.
  const elapsed = now - start > I64_MAX ? I64_MAX : now - start;
  if (elapsed < period) return { currentPeriodStart: start, pulledInPeriod: pulled };
  const candidate = start + (elapsed / period) * period;
  if (expiry === 0n || candidate < expiry) {
    return { currentPeriodStart: candidate, pulledInPeriod: 0n };
  }
  // The next boundary is at or after expiry: advance only to the last period start strictly
  // before expiry, so the final in-bounds period keeps billing without a fresh allowance.
  const lastBillable = expiry - 1n;
  if (lastBillable >= start) {
    const lastInBoundsStart = start + ((lastBillable - start) / period) * period;
    if (lastInBoundsStart > start) {
      return { currentPeriodStart: lastInBoundsStart, pulledInPeriod: 0n };
    }
  }
  return { currentPeriodStart: start, pulledInPeriod: pulled };
}

/** How much the delegatee could pull at time `now` (0n if expired, not started or invalid). */
export function allowanceRemaining(delegation: DelegationState, now: bigint): bigint {
  if (isAllowanceExpired(delegation.expiryTs, now)) return 0n;
  if (delegation.kind === "fixed") return delegation.amountRemaining;
  const period = rollRecurringPeriod(delegation, now);
  if (typeof period === "string") return 0n;
  const remaining = delegation.amountPerPeriod - period.pulledInPeriod;
  return remaining > 0n ? remaining : 0n;
}

/** A Subscriptions delegation account, decoded (v1 layout). */
export type DecodedDelegation = {
  address: string;
  version: number;
  delegator: string;
  delegatee: string;
  payer: string;
  initId: bigint;
  subscriptionAuthority: string;
  mint: string;
  state: DelegationState;
};

/** Account discriminators and v1 sizes of the Subscriptions delegation accounts. */
export const SUBSCRIPTIONS_DELEGATION_LAYOUT = {
  fixed: { discriminator: 2, v1Length: 187 },
  recurring: { discriminator: 3, v1Length: 211 },
} as const;

const addressDecoder = getAddressDecoder();

/**
 * Decodes a Subscriptions Fixed or Recurring delegation account (01-onchain-program §8.3).
 * Fails closed, like the Leash program: anything but a version-1 account of the exact v1 size is
 * rejected with `UNSUPPORTED_DELEGATION`.
 */
export function decodeDelegation(address: string, data: Uint8Array): DecodedDelegation {
  const discriminator = data[0];
  const kind =
    discriminator === SUBSCRIPTIONS_DELEGATION_LAYOUT.fixed.discriminator
      ? "fixed"
      : discriminator === SUBSCRIPTIONS_DELEGATION_LAYOUT.recurring.discriminator
        ? "recurring"
        : null;
  if (kind === null) {
    throw new LeashSdkError(
      "UNSUPPORTED_DELEGATION",
      `Account ${address} is not a fixed or recurring delegation (discriminator ${discriminator})`,
    );
  }
  const version = data[1] ?? 0;
  const expectedLength = SUBSCRIPTIONS_DELEGATION_LAYOUT[kind].v1Length;
  if (version !== 1 || data.length !== expectedLength) {
    throw new LeashSdkError(
      "UNSUPPORTED_DELEGATION",
      `Delegation ${address} has version ${version} and ${data.length} bytes; only version 1 (${expectedLength} bytes) is supported`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (offset: number) => view.getBigUint64(offset, true);
  const i64 = (offset: number) => view.getBigInt64(offset, true);
  const addressAt = (offset: number) => addressDecoder.decode(data.subarray(offset, offset + 32));

  const state: DelegationState =
    kind === "fixed"
      ? { kind, amountRemaining: u64(171), expiryTs: i64(179) }
      : {
          kind,
          currentPeriodStart: i64(171),
          periodLengthSecs: u64(179),
          expiryTs: i64(187),
          amountPerPeriod: u64(195),
          pulledInPeriod: u64(203),
        };
  return {
    address,
    version,
    delegator: addressAt(3),
    delegatee: addressAt(35),
    payer: addressAt(67),
    initId: i64(99),
    subscriptionAuthority: addressAt(107),
    mint: addressAt(139),
    state,
  };
}

/** The contracts `AllowanceView` of a delegation at time `now` (period rolled forward). */
export function allowanceAt(delegation: DecodedDelegation, now: bigint): AllowanceView {
  const { state } = delegation;
  const expiresAt = state.expiryTs === 0n ? null : Number(state.expiryTs);
  const base = {
    delegation: delegation.address,
    kind: state.kind,
    mint: delegation.mint,
    remaining: allowanceRemaining(state, now).toString(),
    expiresAt,
    asOf: Number(now),
  };
  if (state.kind === "fixed") {
    return {
      ...base,
      amountPerPeriod: null,
      periodLengthSecs: null,
      currentPeriodStart: null,
      pulledInPeriod: null,
      amountRemaining: state.amountRemaining.toString(),
    };
  }
  const period = rollRecurringPeriod(state, now);
  const current = typeof period === "string" ? null : period;
  return {
    ...base,
    amountPerPeriod: state.amountPerPeriod.toString(),
    periodLengthSecs: Number(state.periodLengthSecs),
    currentPeriodStart: Number(current?.currentPeriodStart ?? state.currentPeriodStart),
    pulledInPeriod: (current?.pulledInPeriod ?? state.pulledInPeriod).toString(),
    amountRemaining: null,
  };
}
