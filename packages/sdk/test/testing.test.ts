import { isAddress } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { testKeyAddress, testKeySeed } from "../src/testing/index.ts";

describe("test keys (documented derivation, shared with the Rust tests)", () => {
  it("derive the seed as sha256('leash:test-key:' + name)", async () => {
    const seed = await testKeySeed("merchant");
    const expected = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("leash:test-key:merchant")),
    );
    expect(seed).toEqual(expected);
  });

  it("are valid, deterministic and distinct addresses", async () => {
    const merchant = await testKeyAddress("merchant");
    expect(isAddress(merchant)).toBe(true);
    expect(await testKeyAddress("merchant")).toBe(merchant);
    expect(await testKeyAddress("attacker")).not.toBe(merchant);
  });
});
