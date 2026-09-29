import { usdc } from "../lib/format.ts";
import { cn } from "./cn.ts";

/** A USDC amount from base units. Tabular digits so columns line up. */
export function AmountText({ amount, className }: { amount: bigint | string; className?: string }) {
  return (
    <span className={cn("font-mono tabular-nums whitespace-nowrap", className)}>
      {usdc(amount)}
      <span className="ml-1 text-[0.8em] text-fg-muted">USDC</span>
    </span>
  );
}
