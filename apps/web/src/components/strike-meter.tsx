import { duration } from "../lib/format.ts";
import { cn } from "./cn.ts";

/** Strikes towards the tripwire (I4): one dot per allowed strike. */
export function StrikeMeter({
  strikes,
  max,
  windowSecs,
}: {
  strikes: number;
  max: number;
  windowSecs: number;
}) {
  if (max === 0) return <p className="text-sm text-fg-muted">Tripwire off.</p>;
  const dots = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {dots.map((n) => (
          <span
            key={n}
            aria-hidden="true"
            className={cn(
              "size-3 rounded-full",
              n <= strikes ? "bg-blocked" : "bg-surface-2 ring-1 ring-line",
            )}
          />
        ))}
        <span className="text-sm font-medium">
          {strikes} of {max} strikes
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        Attempts to pay an unknown payee or more than a per-payment limit count. {max} within{" "}
        {duration(windowSecs)} freeze the agent on-chain.
      </p>
    </div>
  );
}
