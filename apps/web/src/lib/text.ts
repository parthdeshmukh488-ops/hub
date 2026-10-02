import { shortAddress } from "./format.ts";

// Labels and memos are written by owners and agents (a manipulated agent writes the memo of its
// request). React already renders them as text (T18); this also strips what could hide or reorder
// text in a summary the owner signs on, and clips it.

const HIDDEN = /[\p{Cc}\p{Cf}]/gu;

/** An untrusted label or memo for a summary: no control or format characters, at most `max`. */
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

/** A label made safe, or the short address when it is empty. */
export function nameOf(label: string | null | undefined, address: string): string {
  return (label && safeText(label, 32)) || shortAddress(address);
}
