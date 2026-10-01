import type { LeashChain } from "@leash/sdk";
import { describe, expect, it } from "vitest";
import { ownerDecisions } from "../src/approvals.ts";
import { demoBed } from "./helpers.ts";

describe("waiting for the owner", () => {
  async function withPendingRequest() {
    const demo = await demoBed();
    await demo.runtime.agent.requestApproval({
      to: demo.bed.keys.merchant.address,
      amount: 1_500_000n,
      purpose: "Premium report",
    });
    return demo;
  }

  it("has nothing to wait for without a pending request", async () => {
    const demo = await demoBed();
    const wait = ownerDecisions({
      chain: demo.bed.chain,
      agent: demo.bed.accounts.agent,
      ui: demo.ui,
    });
    expect(await wait()).toBeNull();
  });

  it("gives up after the timeout and tells the model to continue without it", async () => {
    const demo = await withPendingRequest();
    let now = 0;
    const wait = ownerDecisions({
      chain: demo.bed.chain,
      agent: demo.bed.accounts.agent,
      ui: demo.ui,
      timeoutMs: 10,
      pollMs: 5,
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    const update = await wait();
    expect(update?.approved).toBe(false);
    expect(update?.note).toMatch(
      /^Update from Leash: The owner has not answered your payment request for 1\.50 USDC to \w{4}…\w{4} yet\. Continue without it\.$/,
    );
    expect(demo.screen()).toContain("No answer from the owner for 1.50 USDC");
  });

  it("keeps polling through a failed read", async () => {
    const demo = await withPendingRequest();
    let reads = 0;
    const flaky: LeashChain = {
      ...demo.bed.chain,
      getProgramAccounts: async (...args) => {
        reads += 1;
        if (reads === 2) throw new Error("rpc down");
        return demo.bed.chain.getProgramAccounts(...args);
      },
    };
    let acted = false;
    const wait = ownerDecisions({
      chain: flaky,
      agent: demo.bed.accounts.agent,
      ui: demo.ui,
      sleep: async () => {
        if (reads >= 2 && !acted) {
          acted = true;
          await demo.owner.approveAll();
        }
      },
    });
    const update = await wait();
    expect(update?.approved).toBe(true);
    expect(update?.note).toContain("The owner approved your payment request for 1.50 USDC");
    expect(reads).toBeGreaterThanOrEqual(3);
  });
});
