import { describe, expect, it } from "vitest";
import { clip, duration, quoteMemo, shortAddress, untrusted, usdc } from "../src/text.ts";

describe("untrusted", () => {
  it("defangs URLs, bare domains and @names", () => {
    expect(untrusted("go to https://evil.com/pay now")).toBe("go to https[:]//evil[.]com/pay now");
    expect(untrusted("t.me/x and evil.com")).toBe("t[.]me/x and evil[.]com");
    expect(untrusted("ask @support or me@mail.io")).toBe("ask (at)support or me(at)mail[.]io");
    expect(untrusted("evil．com evil。com")).toBe("evil[.]com evil[.]com");
  });

  it("leaves amounts, versions and plain sentences alone", () => {
    expect(untrusted("tip 1.50 USDC, v2.0. Thanks")).toBe("tip 1.50 USDC, v2.0. Thanks");
  });

  it("strips bidi and zero-width characters, even inside a URL", () => {
    expect(untrusted("abc‮dcba‬")).toBe("abcdcba");
    expect(untrusted("⁦x⁧y⁨z⁩")).toBe("xyz");
    expect(untrusted("evil.​com h​ttps:​//x")).toBe("evil[.]com https[:]//x");
  });

  it("turns line breaks and control characters into spaces", () => {
    expect(untrusted("one\ntwo\r\n\tthree four\u0000")).toBe("one two three four");
  });

  it("keeps markup characters literal: notifiers send plain text", () => {
    expect(untrusted("<b>*hi*</b> _x_ [y](z)")).toBe("<b>*hi*</b> _x_ [y](z)");
  });
});

describe("clip", () => {
  it("leaves short text alone and ends long text with an ellipsis", () => {
    expect(clip("hello", 5)).toBe("hello");
    expect(clip("hello world", 6)).toBe("hello…");
  });

  it("never splits a surrogate pair", () => {
    const clipped = clip("ab😀😀😀", 4);
    expect(clipped).toBe("ab…");
    expect(clipped.length).toBeLessThanOrEqual(4);
  });
});

describe("formatting", () => {
  it("formats amounts, durations, addresses and memos", () => {
    expect(usdc(1_500_000n)).toBe("1.50 USDC");
    expect(usdc(5_000n)).toBe("0.005 USDC");
    expect(duration(1)).toBe("1 second");
    expect(duration(20)).toBe("20 seconds");
    expect(duration(90)).toBe("2 minutes");
    expect(duration(3600)).toBe("1 hour");
    expect(shortAddress("4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9")).toBe("4gMn…VUT9");
    expect(quoteMemo("x".repeat(100))).toBe(`“${"x".repeat(79)}…”`);
  });
});
