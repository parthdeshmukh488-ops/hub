import { formatUsdc } from "@leash/contracts";

// Labels and memos are written by owners and agents (a manipulated agent writes the memo of its
// request), and Blink clients render them: strip what could hide or reorder text, and clip.

const HIDDEN = /[\p{Cc}\p{Cf}]/gu;

/** An untrusted label or memo, safe to show: no control or format characters, at most `max`. */
export function safeText(text: string, max = 64): string {
  const clean = text.replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let out = "";
  for (const char of clean) {
    if (out.length + char.length > max - 1) break;
    out += char;
  }
  return `${out}…`;
}

/** `4gMn…VUT9`. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** A label made safe, or the short address when it is empty. */
export function nameOf(label: string | null | undefined, address: string): string {
  return (label && safeText(label, 32)) || shortAddress(address);
}

export function usdc(amount: string | bigint): string {
  return `${formatUsdc(BigInt(amount))} USDC`;
}
