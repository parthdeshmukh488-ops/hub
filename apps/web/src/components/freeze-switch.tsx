"use client";

import * as Switch from "@radix-ui/react-switch";
import { Snowflake } from "lucide-react";
import { useId } from "react";
import { cn } from "./cn.ts";

type Props = {
  frozen: boolean;
  /** What the switch freezes: "Freeze all agents", "Freeze this agent". */
  label: string;
  /** Why the switch cannot be used right now, or null when it can. */
  disabledReason: string | null;
  onChange?: (frozen: boolean) => void;
  size?: "md" | "lg";
};

/** The off switch. On = frozen. Always shows its state as text, not only as colour. */
export function FreezeSwitch({ frozen, label, disabledReason, onChange, size = "md" }: Props) {
  const id = useId();
  const large = size === "lg";
  return (
    <div className="flex items-center gap-3">
      <Switch.Root
        id={id}
        checked={frozen}
        onCheckedChange={onChange}
        disabled={disabledReason !== null}
        title={disabledReason ?? undefined}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full border border-line bg-surface-2 transition-colors",
          "data-[state=checked]:border-frozen data-[state=checked]:bg-frozen-soft disabled:cursor-not-allowed",
          large ? "h-9 w-16" : "h-6 w-11",
        )}
      >
        <Switch.Thumb
          className={cn(
            "grid place-items-center rounded-full bg-fg-muted shadow transition-transform data-[state=checked]:bg-frozen",
            large
              ? "size-7 translate-x-1 data-[state=checked]:translate-x-8"
              : "size-4.5 translate-x-0.5 data-[state=checked]:translate-x-5.5",
          )}
        >
          {frozen && (
            <Snowflake
              aria-hidden="true"
              className={cn("text-canvas", large ? "size-4" : "size-3")}
            />
          )}
        </Switch.Thumb>
      </Switch.Root>
      <label htmlFor={id} className="flex flex-col leading-tight">
        <span
          className={cn("font-semibold", large ? "text-base" : "text-sm", frozen && "text-frozen")}
        >
          {frozen ? "Frozen" : "Running"}
        </span>
        <span className="text-xs text-fg-muted">{label}</span>
        {disabledReason !== null && (
          <span className="text-xs text-fg-muted/80">{disabledReason}</span>
        )}
      </label>
    </div>
  );
}
