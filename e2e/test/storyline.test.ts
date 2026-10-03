import { SCENES, type SceneId, STORYLINE } from "@leash/agent-demo/scenes";
import {
  type Alert,
  EventsPageResponseSchema,
  type LeashEvent,
  type LeashEventOf,
  OwnerOverviewResponseSchema,
} from "@leash/contracts";
import type { Testbed } from "@leash/sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Stack, startStack, waitFor } from "../src/stack.ts";

// The pitch storyline through the whole system (src/stack.ts), in process on LiteSVM, with no
// network. The test is the owner: it approves the agent's request once Sentinel has alerted
// about it.

let stack: Stack;
let bed: Testbed;
const alerts: Alert[] = [];
const screen: string[] = [];

async function api<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`${stack.indexer.url}${path}`);
  expect(response.status).toBe(200);
  return schema.parse(await response.json());
}

/** The owner's events feed, oldest first. */
async function events(): Promise<LeashEvent[]> {
  const page = await api(
    `/v1/owners/${bed.keys.owner.address}/events?limit=200`,
    EventsPageResponseSchema,
  );
  return [...page.items].reverse();
}

const ofType = <T extends LeashEvent["type"]>(list: LeashEvent[], type: T) =>
  list.filter((e): e is LeashEventOf<T> => e.type === type);

const overview = () => api(`/v1/owners/${bed.keys.owner.address}`, OwnerOverviewResponseSchema);

const balance = (who: "merchant" | "attacker") => bed.balanceOf(bed.keys[who].address);

async function play(scene: SceneId, ownerActs?: () => Promise<void>): Promise<void> {
  const result = await stack.play(scene, ownerActs);
  expect(result.stop).toBe("end_turn");
}

beforeAll(async () => {
  stack = await startStack({
    write: (line) => screen.push(line),
    color: false,
    onAlert: (alert) => alerts.push(alert),
  });
  bed = stack.bed;
});

afterAll(async () => {
  await stack?.close();
});

describe("the pitch storyline, through the whole system", () => {
  it("starts with Sentinel watching the owner, and nothing to report", async () => {
    expect(stack.sentinel.status()).toMatchObject({
      guardian: bed.keys.guardian.address,
      owners: [bed.keys.owner.address],
    });
    const { principal, agents } = await overview();
    expect(principal).toMatchObject({ guardian: bed.keys.guardian.address, frozen: false });
    expect(agents.map((a) => [a.address, a.status])).toEqual([[bed.accounts.agent, "active"]]);
    expect(alerts).toEqual([]);
  });

  it("scene 1, normal work: the agent pays for research per call", async () => {
    await play("normal");
    const payments = ofType(await events(), "PaymentExecuted");
    expect(payments).toHaveLength(5);
    expect(payments.every((p) => p.payee === bed.keys.merchant.address)).toBe(true);
    const paid = payments.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    expect(await balance("merchant")).toBe(paid);
    expect(await balance("attacker")).toBe(0n);

    const [agent] = (await overview()).agents;
    expect(agent?.stats).toMatchObject({ paymentsCount: 5, totalPaid: paid.toString() });
    expect(alerts).toEqual([]);
  });

  it("scene 2, approval: the owner's phone buzzes, the owner approves, the agent pays once", async () => {
    const before = await balance("merchant");
    await play("approval", async () => {
      // The request is on-chain; the indexer reads it and Sentinel alerts, then the owner acts.
      await stack.sync();
      await waitFor(
        () => alerts.some((a) => a.kind === "approval_requested"),
        "the approval alert",
      );
      await stack.approveOpenRequest();
    });

    const feed = await events();
    const [requested] = ofType(feed, "PaymentRequested");
    const [approved] = ofType(feed, "RequestApproved");
    const fromRequest = ofType(feed, "PaymentExecuted").filter((p) => p.requestNonce !== null);
    expect(requested).toBeDefined();
    expect(approved?.request).toBe(requested?.request);
    expect(fromRequest).toHaveLength(1);
    expect(fromRequest[0]?.amount).toBe(requested?.amount);
    expect(await balance("merchant")).toBe(before + BigInt(requested?.amount ?? "0"));

    expect(alerts.map((a) => a.kind)).toEqual(["approval_requested"]);
    expect(alerts[0]).toMatchObject({
      severity: "info",
      owner: bed.keys.owner.address,
      agent: bed.accounts.agent,
      eventIds: [requested?.id],
    });
  });

  it("scene 3, the injection: three blocked payments to the attacker, and the tripwire freezes the agent", async () => {
    const merchantBefore = await balance("merchant");
    await play("injection");
    // Sentinel gets the tripwire from the stream: wait for it, as scene 2 waits for its alert.
    await waitFor(() => alerts.some((a) => a.kind === "tripwire_fired"), "the tripwire alert");
    await stack.sentinel.idle();

    expect(await balance("attacker")).toBe(0n);
    expect(await balance("merchant")).toBe(merchantBefore);
    // The whole story paid the merchant 1.57 USDC, as in apps/agent-demo's test: every x402
    // settlement ran once, though it went through the testbed chain that the indexer reads.
    expect(merchantBefore).toBe(1_570_000n);

    const feed = await events();
    const denied = ofType(feed, "PaymentDenied");
    expect(denied.map((d) => [d.payee, d.reason, d.strike, d.strikes, d.tripped])).toEqual([
      [bed.keys.attacker.address, "payeeNotAllowed", true, 1, false],
      [bed.keys.attacker.address, "payeeNotAllowed", true, 2, false],
      [bed.keys.attacker.address, "payeeNotAllowed", true, 3, true],
    ]);
    const frozen = ofType(feed, "AgentFrozen");
    expect(frozen.map((f) => [f.agent, f.reason])).toEqual([[bed.accounts.agent, "tripwire"]]);
    // The freeze comes in the same transaction as the third report, right after it.
    expect(feed.at(-1)?.id).toBe(frozen[0]?.id);
    expect(frozen[0]?.signature).toBe(denied[2]?.signature);

    const { agents } = await overview();
    expect(agents[0]).toMatchObject({
      status: "frozen",
      freezeReason: "tripwire",
      stats: { strikes: 3, deniedCount: 3 },
    });

    // The phone buzzes once more, for the tripwire. No burst alert: one agent, already frozen.
    expect(alerts.map((a) => a.kind)).toEqual(["approval_requested", "tripwire_fired"]);
    expect(alerts[1]).toMatchObject({
      severity: "critical",
      agent: bed.accounts.agent,
      eventIds: [...denied.map((d) => d.id), frozen[0]?.id],
    });
    expect(alerts[1]?.body).toMatch(/tried 3 payments its policy blocks/);
  });

  it("showed every scene of the storyline on the demo screen", () => {
    const text = screen.join("\n");
    for (const scene of STORYLINE) expect(text).toContain(`▶ ${SCENES[scene].title}`);
  });
});
