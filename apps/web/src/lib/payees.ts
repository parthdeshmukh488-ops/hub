import type { LeashEvent, PayeeView } from "@leash/contracts";

/** One allowlist row as the agent page shows it. */
export type PayeeRow = {
  payee: string;
  label: string;
  maxPerPayment: bigint;
  periodLimit: bigint;
  periodSecs: number;
  /** Start of the current payee period; null if it never started. */
  periodStart: number | null;
  spentInPeriod: bigint;
  paymentsCount: number;
};

export function payeeRowFromView(view: PayeeView): PayeeRow {
  return {
    payee: view.payee,
    label: view.label,
    maxPerPayment: BigInt(view.maxPerPayment),
    periodLimit: BigInt(view.periodLimit),
    periodSecs: view.periodSecs,
    periodStart: view.periodStart,
    spentInPeriod: BigInt(view.spentInPeriod),
    paymentsCount: view.paymentsCount,
  };
}

/**
 * Rebuilds an agent's allowlist from its events, the way the program keeps the payee period
 * (01-onchain-program §7.2: a window restarts at the first payment after the previous one ended;
 * a period limit of 0 is not tracked). Fixture mode uses this for agents without a detail
 * fixture; the indexer serves `PayeeView`s directly.
 */
export function payeeRowsFromEvents(
  agent: string,
  events: readonly LeashEvent[],
  now: number,
): PayeeRow[] {
  const rows = new Map<string, Omit<PayeeRow, "periodStart"> & { periodStart: number }>();
  for (const event of events) {
    if (event.agent !== agent) continue;
    if (event.type === "PayeeAdded" || event.type === "PayeeUpdated") {
      const previous = rows.get(event.payee);
      rows.set(event.payee, {
        payee: event.payee,
        label: event.label,
        maxPerPayment: BigInt(event.maxPerPayment),
        periodLimit: BigInt(event.periodLimit),
        periodSecs: event.periodSecs,
        spentInPeriod: previous?.spentInPeriod ?? 0n,
        paymentsCount: previous?.paymentsCount ?? 0,
        periodStart: previous?.periodStart ?? 0,
      });
    } else if (event.type === "PayeeRemoved") {
      rows.delete(event.payee);
    } else if (event.type === "PaymentExecuted") {
      const row = rows.get(event.payee);
      if (!row) continue;
      row.paymentsCount += 1;
      if (row.periodLimit === 0n) continue;
      if (row.periodStart === 0 || event.timestamp >= row.periodStart + row.periodSecs) {
        row.periodStart = event.timestamp;
        row.spentInPeriod = 0n;
      }
      row.spentInPeriod += BigInt(event.amount);
    }
  }
  return [...rows.values()].map(({ periodStart, ...row }) => ({
    ...row,
    periodStart: periodStart === 0 ? null : periodStart,
    // A window that has ended shows as empty: the next payment starts a new one.
    spentInPeriod:
      periodStart !== 0 && now >= periodStart + row.periodSecs ? 0n : row.spentInPeriod,
  }));
}
