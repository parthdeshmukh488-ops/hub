import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { LEASH_PROGRAM_ID } from "@leash/contracts";
import { USDC } from "@leash/sdk/testing";
import { describe, expect, it } from "vitest";
import {
  SMART_WALLET_MAX_COMPUTE_UNITS,
  smartWalletAllowlist,
  X402_DEFAULT_SMART_WALLET_PROGRAMS,
} from "../src/facilitator/index.ts";
import { createX402Bed, facilitatorOf, NETWORK, payloadOf, standardPayment } from "./helpers.ts";

// Path 1: the facilitator still works for ordinary wallets (WS3 test table, row 1).

describe("the facilitator configuration", () => {
  it("copies the installed @x402/svm default allowlist exactly, and adds Leash", () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("@x402/svm/exact/facilitator"), "utf8");
    const list = /DEFAULT_SMART_WALLET_ALLOWED_PROGRAMS = \[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
    const literals = [...list.matchAll(/"([1-9A-HJ-NP-Za-km-z]{32,44})"/g)].map((m) => m[1]);
    expect(list).toContain("LIGHTHOUSE_PROGRAM_ADDRESS");
    expect(X402_DEFAULT_SMART_WALLET_PROGRAMS.slice(0, -1)).toEqual(literals);
    expect(smartWalletAllowlist({})).toEqual([
      ...X402_DEFAULT_SMART_WALLET_PROGRAMS,
      LEASH_PROGRAM_ID,
    ]);
    expect(smartWalletAllowlist({ allowLeash: false })).toEqual(X402_DEFAULT_SMART_WALLET_PROGRAMS);
    expect(SMART_WALLET_MAX_COMPUTE_UNITS).toBe(400_000);
  });

  it("advertises the exact scheme on the network with its fee payer", async () => {
    const bed = await createX402Bed();
    const supported = facilitatorOf(bed).getSupported();
    expect(supported.kinds).toContainEqual(
      expect.objectContaining({ x402Version: 2, scheme: "exact", network: NETWORK }),
    );
    expect(JSON.stringify(supported)).toContain(bed.facilitatorKey.address);
  });
});

describe("Path 1: a standard wallet payment", () => {
  it("verifies and settles a plain TransferChecked", async () => {
    const bed = await createX402Bed();
    const facilitator = facilitatorOf(bed);
    const requirements = bed.requirements(USDC / 100n);
    const payload = payloadOf(
      await standardPayment(bed, bed.keys.owner, USDC / 100n),
      requirements,
    );

    const verified = await facilitator.verify(payload, requirements);
    expect(verified).toMatchObject({ isValid: true, payer: bed.keys.owner.address });
    const settled = await facilitator.settle(payload, requirements);
    expect(settled).toMatchObject({ success: true, network: NETWORK });
    expect(settled.transaction).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(USDC / 100n);
  });

  it("refuses an amount below the requirement", async () => {
    const bed = await createX402Bed();
    const requirements = bed.requirements(USDC);
    const payload = payloadOf(await standardPayment(bed, bed.keys.owner, USDC / 2n), requirements);
    const verified = await facilitatorOf(bed).verify(payload, requirements);
    expect(verified.isValid).toBe(false);
  });
});
