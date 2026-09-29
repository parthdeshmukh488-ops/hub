import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AmountStringSchema,
  amountFromJson,
  amountToJson,
  decodeFixedUtf8,
  decodeLabel,
  encodeFixedUtf8,
  encodeLabel,
  encodeMemo,
  formatUsdc,
  parseUsdc,
  randomMemoNonce,
  randomReference,
  referenceFromHex,
  referenceFromMemo,
  referenceToHex,
  truncateUtf8,
  U64_MAX,
  UsdcAmountInputSchema,
  utf8ByteLength,
} from "../src/index.ts";

describe("parseUsdc", () => {
  it.each([
    ["0", 0n],
    ["1", 1_000_000n],
    ["1.5", 1_500_000n],
    ["1.50", 1_500_000n],
    ["0.000001", 1n],
    ["25", 25_000_000n],
    ["18446744073709.551615", U64_MAX],
  ])("parses %s", (input, expected) => {
    expect(parseUsdc(input)).toBe(expected);
  });

  it.each(["", "-1", "1e3", " 1", "1 ", ".5", "1.", "1,5", "1.0000001", "18446744073709.551616"])(
    "rejects %j",
    (input) => {
      expect(() => parseUsdc(input)).toThrow(RangeError);
    },
  );
});

describe("formatUsdc", () => {
  it.each([
    [0n, "0.00"],
    [1n, "0.000001"],
    [5_000n, "0.005"],
    [10_000n, "0.01"],
    [1_500_000n, "1.50"],
    [1_234_567n, "1.234567"],
    [25_000_000n, "25.00"],
  ])("formats %s as %s", (amount, expected) => {
    expect(formatUsdc(amount)).toBe(expected);
  });

  it("honours minFractionDigits", () => {
    expect(formatUsdc(25_000_000n, { minFractionDigits: 0 })).toBe("25");
  });

  it("rejects negative amounts", () => {
    expect(() => formatUsdc(-1n)).toThrow(RangeError);
  });

  it("round-trips every u64 through parseUsdc", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: U64_MAX }), (amount) => {
        expect(parseUsdc(formatUsdc(amount))).toBe(amount);
      }),
    );
  });

  it("always produces input the tool schema accepts", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: U64_MAX }), (amount) => {
        expect(UsdcAmountInputSchema.safeParse(formatUsdc(amount)).success).toBe(true);
      }),
    );
  });
});

describe("JSON amounts", () => {
  it("accepts canonical non-negative integers within u64", () => {
    expect(AmountStringSchema.safeParse("0").success).toBe(true);
    expect(AmountStringSchema.safeParse(U64_MAX.toString()).success).toBe(true);
  });

  it.each(["", "01", "-1", "1.5", "1e6", (U64_MAX + 1n).toString()])("rejects %j", (value) => {
    expect(AmountStringSchema.safeParse(value).success).toBe(false);
  });

  it("round-trips", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: U64_MAX }), (amount) => {
        expect(amountFromJson(amountToJson(amount))).toBe(amount);
      }),
    );
  });
});

describe("fixed-size UTF-8 fields", () => {
  it("pads and strips", () => {
    const bytes = encodeLabel("Research API");
    expect(bytes).toHaveLength(32);
    expect(decodeLabel(bytes)).toBe("Research API");
  });

  it("handles multi-byte characters", () => {
    const text = "Café €1,500 🚲";
    expect(decodeFixedUtf8(encodeFixedUtf8(text, 32))).toBe(text);
  });

  it("rejects text longer than the field instead of truncating", () => {
    expect(() => encodeLabel("x".repeat(33))).toThrow(RangeError);
    expect(() => encodeMemo("€".repeat(22))).toThrow(RangeError); // 66 bytes
  });

  it("round-trips any string that fits", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 16 }), (text) => {
        fc.pre(!text.includes("\u0000") && utf8ByteLength(text) <= 64);
        expect(decodeFixedUtf8(encodeFixedUtf8(text, 64))).toBe(text);
      }),
    );
  });
});

describe("truncateUtf8", () => {
  it("never splits a character and never exceeds the limit", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), fc.integer({ min: 0, max: 64 }), (text, max) => {
        const out = truncateUtf8(text, max);
        expect(utf8ByteLength(out)).toBeLessThanOrEqual(max);
        expect(text.startsWith(out)).toBe(true);
      }),
    );
  });

  it("keeps short text unchanged", () => {
    expect(truncateUtf8("research: e-bikes", 64)).toBe("research: e-bikes");
  });
});

describe("references", () => {
  it("round-trips hex", () => {
    const reference = randomReference();
    expect(referenceFromHex(referenceToHex(reference))).toEqual(reference);
  });

  it("derives the x402 reference as sha256 of the memo", async () => {
    expect(referenceToHex(await referenceFromMemo("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("rejects malformed hex", () => {
    expect(() => referenceFromHex("AB".repeat(32))).toThrow();
    expect(() => referenceFromHex("ab")).toThrow();
  });

  it("produces 16-byte hex memo nonces", () => {
    expect(randomMemoNonce()).toMatch(/^[0-9a-f]{32}$/);
  });
});
