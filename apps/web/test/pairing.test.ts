import { buildPairingUrl } from "@leash/contracts";
import { DEMO_POLICY } from "@leash/sdk/testing";
import { describe, expect, it } from "vitest";
import {
  emptyPayee,
  formFromPreset,
  keyFingerprint,
  parsePairingForm,
  readPairingLink,
  reviewLines,
} from "../src/lib/pairing.ts";

// The pairing wizard's pure logic (02-contracts §11).

const AGENT = "6sbzC1eH4FTujJXWj51eQe25cYvJJxwiNRWUjEXfDfmA";
const MERCHANT = "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9";
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const query = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

describe("the pairing link", () => {
  it("reads what the agent runtime builds", () => {
    const url = buildPairingUrl("https://leash.example", {
      agentKey: AGENT,
      label: "Research agent",
      preset: "research-assistant",
      cluster: "devnet",
    });
    expect(readPairingLink(query(url))).toEqual({
      ok: true,
      agentKey: AGENT,
      label: "Research agent",
      preset: "research-assistant",
      cluster: "devnet",
    });
  });

  it("says what is wrong with a broken one", () => {
    const result = readPairingLink({ agentKey: "nope", label: "x".repeat(33), preset: "evil" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      "The agent key in the link is not a valid Solana address.",
      "The agent's name in the link is missing or longer than 32 bytes.",
      "The link names a preset this app does not know.",
    ]);
  });
});

describe("the form", () => {
  it("the research-assistant preset fills everything in, the merchant from the hints", () => {
    const form = formFromPreset(
      "research-assistant",
      { agentKey: AGENT, label: "Research agent" },
      { merchant: MERCHANT, mint: MINT },
    );
    const parsed = parsePairingForm(form);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.policy).toEqual(DEMO_POLICY);
    expect(parsed.value.allowance).toEqual({
      amountPerPeriod: 5_000_000n,
      periodLengthSecs: 86_400n,
      durationSecs: 30n * 86_400n,
    });
    expect(parsed.value.payees).toEqual([
      {
        payee: MERCHANT,
        label: "Research API",
        limits: { maxPerPayment: 2_000_000n, periodLimit: 3_000_000n, periodSecs: 86_400 },
      },
    ]);
  });

  it("without hints the merchant's wallet and the mint are the owner's to enter", () => {
    const parsed = parsePairingForm(
      formFromPreset("research-assistant", { agentKey: AGENT, label: "A" }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual({
      mint: "Enter a Solana address.",
      "payees.0.address": "Enter a Solana address.",
    });
  });

  it("custom leaves the limits to the owner", () => {
    const parsed = parsePairingForm(
      formFromPreset("custom", { agentKey: AGENT, label: "A" }, { mint: MINT }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual([
      "allowancePerPeriod",
      "maxPerPayment",
      "payees",
    ]);
  });

  it("catches what the program would reject, before the wallet opens", () => {
    const form = {
      ...formFromPreset(
        "research-assistant",
        { agentKey: AGENT, label: "Ünïcödé agent 🤖🤖🤖🤖🤖" },
        {
          merchant: AGENT,
          mint: MINT,
        },
      ),
      maxPerPayment: "2",
      maxPerRequest: "1.5",
      allowancePerPeriod: "1.0000001",
      tripwireWindowSecs: "0",
    };
    const parsed = parsePairingForm(form);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual({
      label: "Give the agent a name of at most 32 bytes.",
      allowancePerPeriod: "Enter an amount in USDC, like 1.50.",
      maxPerRequest: "Must be above the instant limit, or 0 to switch approvals off.",
      tripwireWindowSecs: "Must be more than 0.",
      "payees.0.address": "A payee must not be the agent itself.",
    });
  });

  it("an empty payee row and a duplicate are flagged", () => {
    const form = formFromPreset(
      "research-assistant",
      { agentKey: AGENT, label: "A" },
      { merchant: MERCHANT, mint: MINT },
    );
    const parsed = parsePairingForm({
      ...form,
      payees: [...form.payees, { ...emptyPayee(), label: "Again", address: MERCHANT }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual({ "payees.1.address": "This payee is listed twice." });
  });
});

describe("the review", () => {
  it("reads the rules in plain language", () => {
    const parsed = parsePairingForm(
      formFromPreset(
        "research-assistant",
        { agentKey: AGENT, label: "A" },
        { merchant: MERCHANT, mint: MINT },
      ),
    );
    if (!parsed.ok) throw new Error("the preset should parse");
    expect(reviewLines(parsed.value)).toEqual([
      "This agent can spend up to 5.00 USDC per day, only with Research API, at most 1.00 USDC per payment.",
      "The allowance ends after 30 days.",
      "It asks you before paying more, up to 5.00 USDC; your approval request expires after 1 h.",
      "Research API: at most 2.00 USDC per payment, 3.00 USDC per day.",
      "At most 30 payments per 1 min.",
      "It freezes itself after 3 blocked attempts within 10 min.",
      "You can freeze it at any time, and the money stays in your wallet until it pays.",
    ]);
  });

  it("spells out every protection that is switched off", () => {
    const parsed = parsePairingForm({
      ...formFromPreset(
        "research-assistant",
        { agentKey: AGENT, label: "A" },
        { merchant: MERCHANT, mint: MINT },
      ),
      allowListOnly: false,
      maxPerRequest: "0",
      velocityMaxPayments: "0",
      tripwireMaxStrikes: "0",
      allowanceDays: "0",
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const lines = reviewLines(parsed.value);
    expect(lines[0]).toContain("with anyone (the allowlist is off)");
    expect(lines).toContain("The allowance never expires; revoke it any time.");
    expect(lines).toContain("It never asks you to approve more: larger payments are blocked.");
    expect(lines).toContain("No rate limit.");
    expect(lines).toContain("Tripwire off: blocked attempts never freeze it.");
  });

  it("the fingerprint is the whole key in groups of four", () => {
    expect(keyFingerprint(AGENT).join("")).toBe(AGENT);
    expect(keyFingerprint(AGENT).slice(0, 3)).toEqual(["6sbz", "C1eH", "4FTu"]);
  });
});
