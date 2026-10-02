import { runDemo } from "@leash/agent-demo/demo";
import { SCENES, type SceneId, STORYLINE } from "@leash/agent-demo/scenes";
import { createUi } from "@leash/agent-demo/ui";
import {
  type Alert,
  CAIP2,
  EventsPageResponseSchema,
  explorerTxUrl,
  type LeashEvent,
  type LeashEventOf,
  OwnerOverviewResponseSchema,
  resolveClusterConfig,
} from "@leash/contracts";
import { startTestIndexer, type TestIndexer } from "@leash/indexer/testing";
import { loadContent } from "@leash/merchant-demo/content";
import { createApp } from "@leash/merchant-demo/server";
import { buildApproveRequest, fetchOpenRequests, LEASH_PROGRAM_ADDRESS } from "@leash/sdk";
import { createTestbed, type Testbed } from "@leash/sdk/testing";
import { createIndexerClient, DEFAULT_CONFIG, Sentinel } from "@leash/sentinel";
import { connectLeash } from "@leash/tools/node";
import { litesvmFacilitatorClient } from "@leash/x402/testing";
import { address } from "@solana/kit";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordingSvm } from "./facilitator-svm.ts";

// The pitch storyline through the whole system, in process on LiteSVM, with no network:
//   the demo agent (scripted scenes) → its tools → merchant-demo with x402 payments on → the
//   official facilitator → the Leash program and Subscriptions (the real binaries) → the indexer
//   in chain mode over the same chain → Sentinel, live on the indexer's stream.
// The test is the owner: it approves the agent's request once Sentinel has alerted about it.

const MERCHANT_URL = "http://merchant.test";
const WEB_URL = "http://localhost:3000";

let bed: Testbed;
let indexer: TestIndexer;
let sentinel: Sentinel;
const alerts: Alert[] = [];
const screen: string[] = [];
let play: (scene: SceneId, ownerActs?: () => Promise<void>) => Promise<void>;

async function waitFor(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The indexer reads the chain's new transactions; Sentinel gets them on the stream. */
async function sync(): Promise<void> {
  await indexer.sync();
  // Let the stream's messages reach Sentinel's queue, then let it finish them.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await sentinel.idle();
}

async function api<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`${indexer.url}${path}`);
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

beforeAll(async () => {
  bed = await createTestbed();

  // merchant-demo (lab included) with x402 payments through the official facilitator. Its
  // settlements are recorded in the testbed chain's history, so the indexer sees them.
  const app = createApp(
    {
      wallets: { merchant: bed.keys.merchant.address, attacker: bed.keys.attacker.address },
      payments: "on",
      x402: {
        facilitator: litesvmFacilitatorClient(
          recordingSvm(bed),
          [bed.keys.stranger],
          CAIP2.localnet,
        ),
        network: CAIP2.localnet,
        asset: bed.mint,
      },
    },
    loadContent(),
  );
  const merchantFetch = async (input: string | URL | Request, init?: RequestInit) =>
    app.fetch(new Request(input, init));

  // The agent's real tools and the demo's screen.
  const cluster = resolveClusterConfig("localnet", { usdcMint: bed.mint });
  const runtime = connectLeash({
    cluster,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    chain: bed.chain,
    fetch: merchantFetch,
    logger: { warn: () => {} },
  });
  const ui = createUi({
    write: (line) => screen.push(line),
    color: false,
    explorer: (signature) => explorerTxUrl(cluster, signature),
  });

  // The indexer follows the same chain, read only when the test says so.
  indexer = await startTestIndexer({
    source: { kind: "chain", chain: bed.chain, programId: LEASH_PROGRAM_ADDRESS },
    now: () => Number(bed.now()),
  });

  // Sentinel watches the principals whose guardian is the testbed's guardian key.
  sentinel = new Sentinel({
    indexer: createIndexerClient(indexer.url),
    guardian: bed.keys.guardian.address,
    notifiers: [{ name: "collect", send: async (alert) => void alerts.push(alert) }],
    config: DEFAULT_CONFIG,
    webUrl: WEB_URL,
    log: pino({ level: "silent" }),
    clock: () => Number(bed.now()),
    refreshOwnersMs: 60_000,
  });
  await sentinel.start();
  await waitFor(() => sentinel.status().ok, "Sentinel connected with its owner");
  await sentinel.idle();

  play = async (scene, ownerActs) => {
    let acted = false;
    const [result] = await runDemo({
      tools: runtime.tools,
      chain: bed.chain,
      agent: bed.accounts.agent,
      ui,
      scenes: [scene],
      merchant: MERCHANT_URL,
      fetch: merchantFetch,
      model: null,
      ownerWait: {
        pollMs: 1,
        sleep: async () => {
          if (acted || !ownerActs) return;
          acted = true;
          await ownerActs();
        },
      },
    });
    expect(result?.stop).toBe("end_turn");
    await sync();
  };
});

afterAll(async () => {
  await sentinel?.stop();
  await indexer?.close();
});

describe("the pitch storyline, through the whole system", () => {
  it("starts with Sentinel watching the owner, and nothing to report", async () => {
    expect(sentinel.status()).toMatchObject({
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
      await sync();
      await waitFor(
        () => alerts.some((a) => a.kind === "approval_requested"),
        "the approval alert",
      );
      const [request] = await fetchOpenRequests(bed.chain, bed.accounts.agent);
      if (!request) throw new Error("no open request");
      await bed.send(bed.keys.owner, [
        await buildApproveRequest({
          owner: bed.keys.owner,
          agent: bed.accounts.agent,
          request: address(request.address),
        }),
      ]);
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
    await sentinel.idle();

    expect(await balance("attacker")).toBe(0n);
    expect(await balance("merchant")).toBe(merchantBefore);
    // The whole story paid the merchant 1.57 USDC, as in apps/agent-demo's test: every x402
    // settlement ran once, though the indexer also saw it (recordingSvm).
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
