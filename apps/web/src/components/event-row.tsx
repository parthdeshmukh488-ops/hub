import type { LeashEvent } from "@leash/contracts";
import { describeEvent, type NameBook } from "../lib/events.ts";
import { AmountText } from "./amount-text.tsx";
import { cn } from "./cn.ts";
import { RelativeTime } from "./relative-time.tsx";
import { ToneIcon } from "./tone.tsx";

/** One event in a feed. The agent's memo is untrusted and rendered as plain text (T18). */
export function EventRow({
  event,
  names,
  now,
}: {
  event: LeashEvent;
  names: NameBook;
  now: number;
}) {
  const d = describeEvent(event, names);
  return (
    <li className="flex gap-3 py-3">
      <ToneIcon tone={d.tone} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{d.title}</p>
          {d.amount !== null && (
            <AmountText
              amount={d.amount}
              className={cn(
                "text-sm",
                d.tone === "blocked" && "text-fg-muted line-through decoration-blocked",
              )}
            />
          )}
        </div>
        {d.detail !== null && <p className="text-xs text-fg-muted">{d.detail}</p>}
        {d.memo !== null && (
          <p className="truncate text-xs text-fg-muted">
            <span className="font-medium">Agent note:</span> {d.memo}
          </p>
        )}
        <p className="text-xs text-fg-muted">
          <RelativeTime timestamp={event.timestamp} now={now} />
        </p>
      </div>
    </li>
  );
}
