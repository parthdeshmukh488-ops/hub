import { formatUsdc } from "@leash/contracts";

// Alert text helpers. Labels and memos are written by owners and, for memos, by agents that may
// be manipulated, so they never reach an alert unchanged (03-security T18).

/** Invisible format characters: bidi overrides and isolates, zero-width characters, soft hyphen. */
const FORMAT_CHARS = /\p{Cf}/gu;
/** Control characters and line or paragraph separators: they could fake a second line. */
const BREAKING_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;
/** A dot (or a full-width or ideographic one) followed by a letter, as in a domain name. */
const DOMAIN_DOT = /[.．。｡](?=\p{L})/gu;
/** An @ that starts a name or an e-mail domain. */
const MENTION = /@(?=[\p{L}\p{N}_])/gu;

/**
 * Makes an owner- or agent-controlled string safe to show in an alert. It removes bidi and other
 * invisible characters, turns line breaks into spaces, and defangs what chat apps turn into tap
 * targets even in plain text: `://` → `[:]//`, a dot before a letter → `[.]`, `@name` →
 * `(at)name`. Markup characters stay as they are: notifiers send plain text.
 */
export function untrusted(text: string): string {
  return text
    .replace(FORMAT_CHARS, "")
    .replace(BREAKING_CHARS, " ")
    .replaceAll("://", "[:]//")
    .replace(DOMAIN_DOT, "[.]")
    .replace(MENTION, "(at)")
    .trim();
}

/**
 * Shortens `text` to at most `max` UTF-16 code units (what zod's `max` and Telegram count),
 * ending in "…", without splitting a surrogate pair.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max - 1) break;
    out += char;
  }
  return `${out}…`;
}

/** An agent-written memo in quotes, made safe and kept short. */
export function quoteMemo(memo: string): string {
  return `“${clip(untrusted(memo), 80)}”`;
}

/** `4gMn…VUT9`: enough to recognise an address, short enough for a phone. */
export function shortAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Base units as "1.50 USDC". */
export function usdc(amount: bigint): string {
  return `${formatUsdc(amount)} USDC`;
}

/** A duration for people: "20 seconds", "1 minute", "3 hours". */
export function duration(secs: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (secs < 60) return plural(Math.max(0, Math.round(secs)), "second");
  if (secs < 3600) return plural(Math.round(secs / 60), "minute");
  return plural(Math.round(secs / 3600), "hour");
}
