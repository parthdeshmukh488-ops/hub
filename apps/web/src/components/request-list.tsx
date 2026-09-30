import type { RequestView } from "@leash/contracts";
import type { NameBook } from "../lib/events.ts";
import { absoluteTime, relativeTime, shortAddress } from "../lib/format.ts";
import { AmountText } from "./amount-text.tsx";
import { StatusBadge } from "./tone.tsx";

/**
 * Payment requests waiting for the owner. The memo is the agent's own words: untrusted, shown as
 * text only (T18). Approving and rejecting need a connected wallet; until then the buttons say why.
 */
export function RequestList({
  requests,
  names,
  now,
  showAgent = false,
  disabledReason,
}: {
  requests: readonly RequestView[];
  names: NameBook;
  now: number;
  showAgent?: boolean;
  disabledReason?: string;
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
              {disabledReason !== undefined && request.status === "pending" && !expired && (
                <>
                  <button
                    type="button"
                    disabled
                    title={disabledReason}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled
                    title={disabledReason}
                    className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-canvas disabled:opacity-50"
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
