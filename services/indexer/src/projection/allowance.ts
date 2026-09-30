import type { AllowanceView } from "@leash/contracts";
import { allowanceAt, type DelegationState } from "@leash/sdk";
import type { DelegationRecord } from "./records.ts";

/** The SDK's delegation state (bigint) for a stored record. */
export function delegationState(record: DelegationRecord): DelegationState {
  const expiryTs = BigInt(record.expiresAt ?? 0);
  return record.kind === "fixed"
    ? { kind: "fixed", amountRemaining: BigInt(record.amountRemaining), expiryTs }
    : {
        kind: "recurring",
        amountPerPeriod: BigInt(record.amountPerPeriod),
        periodLengthSecs: BigInt(record.periodLengthSecs),
        currentPeriodStart: BigInt(record.currentPeriodStart),
        pulledInPeriod: BigInt(record.pulledInPeriod),
        expiryTs,
      };
}

/** The `AllowanceView` at `now` (unix seconds), with the period rolled forward by the SDK. */
export function allowanceView(record: DelegationRecord, now: number): AllowanceView {
  return allowanceAt(
    { address: record.address, mint: record.mint, state: delegationState(record) },
    BigInt(now),
  );
}
