import { perPeriod } from "../lib/format.ts";
import type { PayeeRow } from "../lib/payees.ts";
import { Address } from "./address.tsx";
import { AmountText } from "./amount-text.tsx";

/** The allowlist: who the agent may pay, and how much it spent with each this period. */
export function PayeeList({ rows }: { rows: PayeeRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No payees yet. In allow-list mode the agent cannot pay anyone.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li
          key={row.payee}
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.label}</p>
            <Address address={row.payee} />
          </div>
          <dl className="flex gap-6 text-xs">
            <div>
              <dt className="text-fg-muted">Per payment</dt>
              <dd>
                {row.maxPerPayment === 0n ? (
                  "Agent limit"
                ) : (
                  <AmountText amount={row.maxPerPayment} />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Spent this period</dt>
              <dd>
                {row.periodLimit === 0n ? (
                  "No payee budget"
                ) : (
                  <>
                    <AmountText amount={row.spentInPeriod} /> of{" "}
                    <AmountText amount={row.periodLimit} />{" "}
                    <span className="text-fg-muted">{perPeriod(row.periodSecs)}</span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Payments</dt>
              <dd>{row.paymentsCount}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
