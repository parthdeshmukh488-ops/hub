import { LeashStatusOutputSchema } from "@leash/contracts";
import { describe, expect, it } from "vitest";
import { SCENE_IDS } from "../src/scenes.ts";
import { demoBed, loadScene } from "./helpers.ts";

// The scene scripts (scripted mode) replayed through the real loop, the real tools, the real
// merchant-demo app and the official facilitator, on the real program in LiteSVM. What the screen
// shows is what happened on-chain.

describe("scene scripts", () => {
  it("are honest about what they are", () => {
    for (const scene of SCENE_IDS) {
      const recording = loadScene(scene);
      expect(recording.scene).toBe(scene);
      if (recording.source === "script") {
        expect(recording.disclosure, scene).toMatch(/^(Scripted replay|Simulating)/);
      }
    }
    expect(loadScene("injection").disclosure).toContain("Simulating a successful injection");
  });

  it("normal: pays for research per call, every payment on-chain", async () => {
    const demo = await demoBed();
    const result = await demo.play("normal", demo.replay("normal"));
    expect(result.stop).toBe("end_turn");
    expect(result.payments.map((p) => p.amountUsdc)).toEqual([
      "0.01",
      "0.01",
      "0.01",
      "0.02",
      "0.02",
    ]);
    expect(result.blocked).toEqual([]);
    expect(await demo.bed.balanceOf(demo.bed.keys.merchant.address)).toBe(70_000n);
    const screen = demo.screen();
    expect(screen).toContain("✓ active · 5.00 of 5.00 USDC left · strikes 0/3");
    expect(screen).toMatch(
      /✓ paid 0\.02 USDC → Research API · tx \w{4}…\w{4} https:\/\/explorer\.solana\.com\/tx\//,
    );
    expect(screen).toContain("Summary: spent 0.07 USDC in 5 payments · 0 blocked · agent active");
  });

  it("normal: a research call that comes back free or failed stops the replay", async () => {
    const answers = [
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
      new Response('{"free":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    for (const answer of answers) {
      // The second research call (motor types) gets the merchant's broken answer.
      const demo = await demoBed({
        intercept: (request) =>
          request.url.includes("q=hub+or+mid-drive") ? answer.clone() : null,
      });
      const result = await demo.play("normal", demo.replay("normal"));
      expect(result.stop).toBe("diverged");
      // The calls in that turn ran; nothing after it did.
      expect(result.payments.map((p) => p.amountUsdc)).toEqual(["0.01", "0.01"]);
      const screen = demo.screen();
      expect(screen).toContain("A live result differs from the script, so the replay stops here.");
      expect(screen).not.toContain("Summary: spent 0.07 USDC");
      if (answer.status === 500) {
        expect(screen).toContain("✗ the merchant answered 500 text/plain · not paid");
        expect(screen).not.toMatch(/✓ 500/);
      } else {
        expect(screen).toMatch(/✓ 200 application\/json · \d+ chars · free/);
      }
    }
  });

  it("approval: above the instant limit, the loop waits for the owner, then pays with the approved request", async () => {
    const demo = await demoBed();
    const result = await demo.play("approval", demo.replay("approval"), {
      ownerActs: () => demo.owner.approveAll(),
    });
    expect(result.approvals).toBe(1);
    expect(result.payments).toEqual([expect.objectContaining({ amountUsdc: "1.50" })]);
    expect(await demo.bed.balanceOf(demo.bed.keys.merchant.address)).toBe(1_500_000n);
    expect(await demo.owner.pending()).toEqual([]);
    const screen = demo.screen();
    expect(screen).toContain("⏸ above the instant limit: approval request sent to the owner");
    expect(screen).toMatch(/Waiting for the owner to approve 1\.50 USDC to \w{4}…\w{4}/);
    expect(screen).toContain("The owner approved 1.50 USDC");
    expect(screen).toContain("approved request");
  });

  it("approval declined: the model is told, and nothing is paid", async () => {
    const demo = await demoBed();
    const result = await demo.play("approval", demo.replay("approval"), {
      ownerActs: () => demo.owner.rejectAll(),
    });
    // The script was written for an approval: its retry now meets a new approval request instead
    // of a payment, and the replay stops rather than show an answer that assumes the report.
    expect(result.stop).toBe("diverged");
    expect(result.payments).toEqual([]);
    expect(await demo.bed.balanceOf(demo.bed.keys.merchant.address)).toBe(0n);
    const screen = demo.screen();
    expect(screen).toContain("The owner declined 1.50 USDC");
    expect(screen).toContain("A live result differs from the script, so the replay stops here.");
    // It stops before the turn written for an approval: no "approved" thinking, no second request.
    expect(screen).not.toContain("The owner approved the request");
    expect(await demo.owner.pending()).toEqual([]);
    expect(result.approvals).toBe(1);
    expect(screen).not.toContain("Top three picks");
  });

  it("injection: the manipulated agent's three tries are blocked, and the tripwire freezes it on-chain", async () => {
    const demo = await demoBed();
    const result = await demo.play("injection", demo.replay("injection"));
    expect(result.payments).toEqual([]);
    expect(result.blocked).toEqual([
      { code: "PAYEE_NOT_ALLOWED", strike: true },
      { code: "PAYEE_NOT_ALLOWED", strike: true },
      { code: "PAYEE_NOT_ALLOWED", strike: true },
    ]);
    expect(result.frozen).toBe(true);
    expect(await demo.bed.balanceOf(demo.bed.keys.attacker.address)).toBe(0n);
    const status = LeashStatusOutputSchema.parse(await demo.runtime.tools.status());
    expect(status).toMatchObject({
      ok: true,
      agent: { status: "frozen", freezeReason: "tripwire" },
    });
    const screen = demo.screen();
    expect(screen).toContain("✗ BLOCKED:");
    expect(screen).toContain("strike 3");
    expect(screen).toContain("recorded on-chain");
    expect(screen).toContain("TRIPWIRE: repeated blocked payments froze this agent on-chain.");
    expect(screen).toContain("agent frozen");
  });

  it("runaway: the rate limit stops the loop after 30 payments", async () => {
    const demo = await demoBed();
    const result = await demo.play("runaway", demo.replay("runaway"));
    expect(result.payments).toHaveLength(30);
    expect(result.blocked).toEqual([{ code: "VELOCITY_EXCEEDED", strike: false }]);
    expect(result.frozen).toBe(false);
    expect(demo.screen()).toContain(
      "Summary: spent 0.30 USDC in 30 payments · 1 blocked · agent active",
    );
  }, 60_000);
});
