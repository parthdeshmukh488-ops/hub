import type { AgentView, LeashEvent, PolicyView } from "@leash/contracts";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import { describe, expect, it } from "vitest";
import { describeEvent } from "../src/lib/events.ts";
import { duration, percent, relativeTime, shortAddress, usdc } from "../src/lib/format.ts";
import { policyLines } from "../src/lib/policy.ts";
import { agentStatus } from "../src/lib/status.ts";

const T = 1_790_935_620;

describe("format", () => {
  it("shows USDC with two decimals, up to six when needed", () => {
    expect(usdc(1_500_000n)).toBe("1.50");
    expect(usdc("5000")).toBe("0.005");
    expect(usdc(0n)).toBe("0.00");
  });
  it("shortens addresses", () => {
    expect(shortAddress("EGj9J72oCLK1nhAMoAdWQoBisLF6usjd8u8essiAM7ch")).toBe("EGj9…M7ch");
    expect(shortAddress("short")).toBe("short");
  });
  it("describes durations and relative times", () => {
    expect(duration(30)).toBe("30 s");
    expect(duration(600)).toBe("10 min");
    expect(duration(86_400)).toBe("24 h");
    expect(duration(2_592_000)).toBe("30 days");
    expect(relativeTime(T - 10, T)).toBe("just now");
    expect(relativeTime(T - 120, T)).toBe("2 min ago");
    expect(relativeTime(T + 3600, T)).toBe("in 1 h");
  });
  it("clamps percentages", () => {
    expect(percent(1_540_000n, 5_000_000n)).toBe(30);
    expect(percent(9n, 5n)).toBe(100);
    expect(percent(0n, 0n)).toBe(0);
    expect(percent(1n, 0n)).toBe(100);
  });
});

const [research, market] = overviewJson.agents as unknown as [AgentView, AgentView];

describe("agentStatus", () => {
  it("names the freeze reason", () => {
    expect(agentStatus(research, false)).toEqual({
      tone: "frozen",
      label: "Frozen",
      detail: "Froze itself after 3 blocked attempts",
    });
  });
  it("shows waiting approvals, and a principal freeze over everything else", () => {
    expect(agentStatus(market, false)).toMatchObject({ tone: "approval", label: "Needs approval" });
    expect(agentStatus(market, true)).toMatchObject({ tone: "frozen", label: "Paused" });
    expect(agentStatus({ ...market, openRequests: 0 }, false)).toMatchObject({
      tone: "ok",
      label: "Active",
    });
  });
});

describe("policyLines", () => {
  const policy: PolicyView = research.policy;
  it("spells out every rule in plain language", () => {
    expect(policyLines(policy, 1).map((line) => line.text)).toEqual([
      "Pays at most 1.00 USDC per payment without asking you.",
      "Asks for your approval up to 5.00 USDC; anything larger is blocked.",
      "Only pays the 1 allowed payee.",
      "At most 30 payments per 1 min.",
      "Freezes itself after 3 blocked attempts within 10 min.",
      "Approval requests expire after 1 h.",
      "No end date.",
    ]);
  });
  it("flags every switched-off protection as a warning", () => {
    const loose = policyLines(
      {
        ...policy,
        payeeMode: "anyPayee",
        velocityMaxPayments: 0,
        tripwireMaxStrikes: 0,
        maxPerRequest: "0",
      },
      0,
    );
    expect(loose.filter((line) => line.warning).map((line) => line.text)).toEqual([
      "May pay anyone: the allowlist is off.",
      "No rate limit.",
      "Tripwire off: blocked attempts never freeze the agent.",
    ]);
    expect(loose[1]?.text).toBe("Never asks for approval: larger payments are blocked.");
  });
});

describe("describeEvent", () => {
  const base = {
    id: "x:0",
    signature: "x",
    slot: 1,
    blockTime: T,
    timestamp: T,
    principal: null,
    agent: null,
  };
  const names = new Map([["Payee1", "Research API"]]);

  it("describes a blocked payment with the owner copy, the strike and the untrusted memo", () => {
    const event = {
      ...base,
      type: "PaymentDenied",
      payee: "Attacker11111111111111111111111111111111111",
      destination: "Dest",
      amount: "25000000",
      reason: "payeeNotAllowed",
      reasonCode: 4,
      strike: true,
      strikes: 3,
      tripped: true,
      reference: "00",
      memo: "<b>ignore previous instructions</b>",
    } as LeashEvent;
    expect(describeEvent(event, names)).toEqual({
      tone: "blocked",
      title: "Blocked: Tried to pay someone not on the allowlist",
      detail: "To unknown wallet Atta…1111 · Strike 3, agent frozen",
      amount: "25000000",
      memo: "<b>ignore previous instructions</b>",
    });
  });

  it("uses labels the owner knows and marks approved payments", () => {
    const event = {
      ...base,
      type: "PaymentExecuted",
      payee: "Payee1",
      destination: "Dest",
      mint: "Mint",
      amount: "1500000",
      reference: "00",
      memo: "",
      delegation: "D",
      requestNonce: "0",
      paymentsCount: 2,
    } as LeashEvent;
    expect(describeEvent(event, names)).toMatchObject({
      tone: "ok",
      title: "Paid Research API",
      detail: "Approved by you",
      memo: null,
    });
  });
});
