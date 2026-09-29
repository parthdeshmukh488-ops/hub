import { z } from "zod";
import { PROGRAM_CONSTANTS } from "./config.ts";

/** USDC has 6 decimals on Solana. */
export const USDC_DECIMALS = 6;

/** Largest value of an on-chain `u64`. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** True for a canonical non-negative integer string that fits in u64. */
export function isU64String(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= U64_MAX;
}

/**
 * A base-unit amount as it appears in JSON: a canonical non-negative integer string within u64.
 * One refinement (not regex + refine): zod 4 keeps running checks after a failed regex.
 */
export const AmountStringSchema = z
  .string()
  .refine(isU64String, "expected a base-unit amount: a non-negative integer string within u64");

/** A human amount in token units, e.g. "1.50" (agent tools and UI input only). */
export const UsdcAmountInputSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "expected a USDC amount like 1.50 (at most 6 decimals)");

/** Unix time in seconds. */
export const UnixSecondsSchema = z.number().int().nonnegative();

/** A 32-byte reference as lowercase hex (64 chars). */
export const ReferenceHexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected 32 bytes as hex");

/**
 * Parses a token amount written in token units ("1.50") into base units (1_500_000n).
 * Rejects negative numbers, exponents, more than `decimals` fraction digits, and values above u64.
 */
export function parseUsdc(input: string, decimals: number = USDC_DECIMALS): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input);
  if (!match) throw new RangeError(`Invalid amount "${input}": expected digits like 1.50`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new RangeError(`Invalid amount "${input}": at most ${decimals} decimals`);
  }
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (value > U64_MAX) throw new RangeError(`Invalid amount "${input}": exceeds u64`);
  return value;
}

/**
 * Formats base units as token units with at least `minFractionDigits` decimals and no
 * trailing zeros beyond that: 1_500_000n → "1.50", 5_000n → "0.005".
 */
export function formatUsdc(
  amount: bigint,
  options: { decimals?: number; minFractionDigits?: number } = {},
): string {
  const decimals = options.decimals ?? USDC_DECIMALS;
  const minFractionDigits = Math.min(options.minFractionDigits ?? 2, decimals);
  if (amount < 0n) throw new RangeError("Amounts are never negative");
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  let fraction = (amount % scale).toString().padStart(decimals, "0");
  while (fraction.length > minFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/** bigint → JSON amount string. */
export function amountToJson(amount: bigint): string {
  if (amount < 0n || amount > U64_MAX) throw new RangeError("amount out of u64 range");
  return amount.toString();
}

/** JSON amount string → bigint (validated). */
export function amountFromJson(value: string): bigint {
  return BigInt(AmountStringSchema.parse(value));
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Byte length of a string in UTF-8. */
export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

/** Encodes text into a zero-padded fixed-size UTF-8 buffer. Throws if it does not fit. */
export function encodeFixedUtf8(text: string, length: number): Uint8Array {
  const bytes = utf8Encoder.encode(text);
  if (bytes.length > length) {
    throw new RangeError(`"${text}" is ${bytes.length} bytes; the limit is ${length}`);
  }
  const out = new Uint8Array(length);
  out.set(bytes);
  return out;
}

/** Decodes a zero-padded fixed-size UTF-8 buffer (trailing zero bytes are stripped). */
export function decodeFixedUtf8(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return utf8Decoder.decode(bytes.subarray(0, end));
}

export const encodeLabel = (label: string): Uint8Array =>
  encodeFixedUtf8(label, PROGRAM_CONSTANTS.labelLen);
export const decodeLabel = (bytes: Uint8Array): string => decodeFixedUtf8(bytes);
export const encodeMemo = (memo: string): Uint8Array =>
  encodeFixedUtf8(memo, PROGRAM_CONSTANTS.memoLen);
export const decodeMemo = (bytes: Uint8Array): string => decodeFixedUtf8(bytes);

/** A label that fits the on-chain 32-byte field. */
export const LabelSchema = z
  .string()
  .refine((s) => utf8ByteLength(s) <= PROGRAM_CONSTANTS.labelLen, "label longer than 32 bytes");

/** A memo (payment purpose) that fits the on-chain 64-byte field. */
export const MemoSchema = z
  .string()
  .refine((s) => utf8ByteLength(s) <= PROGRAM_CONSTANTS.memoLen, "memo longer than 64 bytes");

/** Truncates text to at most `maxBytes` UTF-8 bytes without splitting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = utf8ByteLength(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

/** 32 bytes → lowercase hex. */
export function referenceToHex(reference: Uint8Array): string {
  if (reference.length !== PROGRAM_CONSTANTS.referenceLen) {
    throw new RangeError(`reference must be ${PROGRAM_CONSTANTS.referenceLen} bytes`);
  }
  return Array.from(reference, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lowercase hex → 32 bytes. */
export function referenceFromHex(hex: string): Uint8Array {
  const valid = ReferenceHexSchema.parse(hex);
  const out = new Uint8Array(PROGRAM_CONSTANTS.referenceLen);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(valid.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The reference of an x402 payment: sha256 of the exact Memo instruction content
 * (02-contracts §3, rule 2).
 */
export async function referenceFromMemo(memo: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", utf8Encoder.encode(memo));
  return new Uint8Array(digest);
}

/** 32 random bytes, for direct payments and payment requests (02-contracts §3, rule 3). */
export function randomReference(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(PROGRAM_CONSTANTS.referenceLen));
}

/** Hex of 16 random bytes: the x402 memo nonce when the merchant sends no `extra.memo`. */
export function randomMemoNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
