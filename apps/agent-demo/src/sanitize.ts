// Untrusted text (page content, labels, memos, the model's own words) is shown as text: it must
// not move the cursor, recolour the terminal or reorder what the viewer reads (CLAUDE.md,
// security rules). Newlines and tabs are the only control characters kept.

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** The text without terminal control characters or bidi overrides. */
export function plain(text: string): string {
  return text.replace(UNSAFE, "");
}

/** `plain`, on one line (whitespace runs become one space), cut to `max` characters. */
export function oneLine(text: string, max = 110): string {
  const flat = plain(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** `5Hk3…9fQa` */
export function shortId(id: string): string {
  const clean = plain(id);
  return clean.length > 12 ? `${clean.slice(0, 4)}…${clean.slice(-4)}` : clean;
}
