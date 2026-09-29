import type { AllowanceView } from "@leash/contracts";
import { duration, percent, perPeriod, relativeTime } from "../lib/format.ts";
import type { Tone } from "../lib/status.ts";
import { AmountText } from "./amount-text.tsx";
import { cn } from "./cn.ts";

/** How much of the allowance the agent has used, from the Subscriptions delegation (I1). */
export function allowanceUsage(allowance: AllowanceView): {
  used: number;
  tone: Tone;
  label: string;
} {
  if (allowance.kind === "fixed") {
    return { used: 0, tone: "ok", label: "One-time budget" };
  }
  const total = BigInt(allowance.amountPerPeriod ?? "0");
  const used = percent(BigInt(allowance.pulledInPeriod ?? "0"), total);
  if (BigInt(allowance.remaining) === 0n) return { used, tone: "blocked", label: "Used up" };
  if (used >= 80) return { used, tone: "approval", label: "Almost used up" };
  return { used, tone: "ok", label: "Within budget" };
}

const BAR: Record<Tone, string> = {
  ok: "bg-ok",
  approval: "bg-approval",
  blocked: "bg-blocked",
  frozen: "bg-frozen",
  neutral: "bg-fg-muted",
};

/** The hard ceiling: remaining this period, period end and allowance expiry. */
export function AllowanceGauge({
  allowance,
  now,
  compact = false,
}: {
  allowance: AllowanceView | null;
  now: number;
  compact?: boolean;
}) {
  if (allowance === null) {
    return <p className="text-sm text-fg-muted">No allowance. This agent cannot spend anything.</p>;
  }
  const usage = allowanceUsage(allowance);
  const recurring = allowance.kind === "recurring";
  const periodEnd =
    recurring && allowance.currentPeriodStart !== null && allowance.periodLengthSecs !== null
      ? allowance.currentPeriodStart + allowance.periodLengthSecs
      : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={cn(compact ? "text-sm" : "text-lg")}>
          <AmountText amount={allowance.remaining} className="font-semibold" />{" "}
          <span className="text-sm text-fg-muted">left</span>
        </p>
        {recurring && allowance.amountPerPeriod !== null && allowance.periodLengthSecs !== null && (
          <p className="text-xs text-fg-muted">
            of <AmountText amount={allowance.amountPerPeriod} />{" "}
            {perPeriod(allowance.periodLengthSecs)}
          </p>
        )}
      </div>
      {recurring && (
        <>
          <meter
            className="sr-only"
            min={0}
            max={100}
            value={usage.used}
            aria-label="Allowance used this period"
          >
            {usage.used}% used, {usage.label.toLowerCase()}
          </meter>
          <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", BAR[usage.tone])}
              style={{ width: `${usage.used}%` }}
            />
          </div>
        </>
      )}
      {!compact && (
        <p className="text-xs text-fg-muted">
          {periodEnd !== null && `New period ${relativeTime(periodEnd, now)}. `}
          {allowance.expiresAt === null
            ? "The allowance has no end date."
            : `The allowance ends in ${duration(Math.max(0, allowance.expiresAt - now))}.`}{" "}
          The agent can never spend more than this, even if Leash had a bug.
        </p>
      )}
    </div>
  );
}
