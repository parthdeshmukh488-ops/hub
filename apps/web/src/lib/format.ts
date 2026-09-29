import { formatUsdc } from "@leash/contracts";

// Display helpers (04-conventions §8). Pure, so they are unit-tested and shared by all views.

/** Base units → "1.50" or "0.005": two decimals, up to six when needed. */
export function usdc(amount: bigint | string): string {
  return formatUsdc(typeof amount === "string" ? BigInt(amount) : amount);
}

/** "EGj9…M7ch". The full address is always available on hover and via copy. */
export function shortAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1
    ? address
    : `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** A length of time: "45 s", "10 min", "24 h", "30 days". */
export function duration(secs: number): string {
  if (secs < 60) return `${secs} s`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  if (secs < 172_800) return `${Math.round(secs / 3600)} h`;
  return `${Math.round(secs / 86_400)} days`;
}

/** "just now", "2 min ago", "in 58 min": relative to `now` (unix seconds). */
export function relativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (Math.abs(diff) < 45) return "just now";
  return diff > 0 ? `${duration(diff)} ago` : `in ${duration(-diff)}`;
}

/** "2026-10-02 10:05 UTC": the absolute time shown on hover. */
export function absoluteTime(timestamp: number): string {
  return `${new Date(timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Share of `part` in `whole` as a whole percentage, clamped to 0–100. */
export function percent(part: bigint, whole: bigint): number {
  if (whole <= 0n) return part > 0n ? 100 : 0;
  const value = Number((part * 100n) / whole);
  return Math.min(100, Math.max(0, value));
}

/** "per 24 h", "per 7 days": how a budget period reads. */
export function perPeriod(secs: number): string {
  return `per ${duration(secs)}`;
}
