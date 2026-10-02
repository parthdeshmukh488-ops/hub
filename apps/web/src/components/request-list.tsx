import type { RequestView } from "@leash/contracts";
import type { NameBook } from "../lib/events.ts";
import { absoluteTime, relativeTime, shortAddress, usdc } from "../lib/format.ts";
import { AmountText } from "./amount-text.tsx";
import { StatusBadge } from "./tone.tsx";

export type RequestActions = {
  /** Why the buttons are disabled (no wallet, sample data), or null. */
  disabledReason: string | null;
  onApprove: (request: RequestView) => void;
  onReject: (request: RequestView) => void;
};

/**
 * Payment requests waiting for the owner. The memo is the agent's own words: untrusted, shown as
 * text only (T18). Approve and Reject open the summary first; the wallet only opens from there.
 */
export function RequestList({
  requests,
  names,
  now,
  showAgent = false,
  actions,
}: {
  requests: readonly RequestView[];
  names: NameBook;
  now: number;
  showAgent?: boolean;
  actions?: RequestActions;
}) {
  const name = (address: string) => names.get(address) ?? shortAddress(address);
  return (
    <ul className="divide-y divide-line">
      {requests.map((request) => {
        const expired = request.expiresAt <= now;
        return (
          <li
            key={request.address}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">
                {showAgent && (
                  <span className="text-fg-muted">{name(request.agent)} wants to pay </span>
                )}
                {!showAgent && "Pay "}
                {name(request.payee)} <AmountText amount={request.amount} />
              </p>
              {request.memo !== "" && (
                <p className="truncate text-xs text-fg-muted">
                  <span className="font-medium">Agent note:</span> {request.memo}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={request.status === "approved" ? "ok" : "approval"}
                label={
                  request.status === "approved"
                    ? "Approved"
                    : expired
                      ? "Expired"
                      : `Expires ${relativeTime(request.expiresAt, now)}`
                }
                title={absoluteTime(request.expiresAt)}
              />
              {actions && !expired && (
                <>
                  <button
                    type="button"
                    disabled={actions.disabledReason !== null}
                    title={actions.disabledReason ?? undefined}
                    onClick={() => actions.onReject(request)}
                    aria-label={`Reject ${usdc(request.amount)} USDC to ${name(request.payee)}`}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reject
                  </button>
                  {request.status === "pending" && (
                    <button
                      type="button"
                      disabled={actions.disabledReason !== null}
                      title={actions.disabledReason ?? undefined}
                      onClick={() => actions.onApprove(request)}
                      aria-label={`Approve ${usdc(request.amount)} USDC to ${name(request.payee)}`}
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-canvas hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
