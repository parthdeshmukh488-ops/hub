import type { Alert, LeashEvent } from "@leash/contracts";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createHealthServer } from "../src/health.ts";
import { createIndexerClient, type IndexerClient } from "../src/indexer-client.ts";
import { createConsoleNotifier } from "../src/notifiers/console.ts";
import type { Notifier } from "../src/notifiers/notifier.ts";
import { Sentinel, type SentinelOptions } from "../src/sentinel.ts";
import { FakeIndexer } from "./fake-indexer.ts";
import { agentView, ev, key, MARKET, RESEARCH, SPARE, storyline, T0, WEB_URL } from "./helpers.ts";

const log = pino({ level: "silent" });
const GUARDIAN = key("guardian");

async function waitFor(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function recorder(): Notifier & { alerts: Alert[] } {
  const alerts: Alert[] = [];
  return { name: "recorder", alerts, send: async (alert) => void alerts.push(alert) };
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(
  options: {
    history?: LeashEvent[];
    wrapIndexer?: (real: IndexerClient) => IndexerClient;
  } & Partial<SentinelOptions> = {},
) {
  const fake = await new FakeIndexer().start();
  fake.history = [...(options.history ?? [])];
  cleanups.push(() => fake.close());
  const notifier = recorder();
  const real = createIndexerClient(fake.url);
  const sentinel = new Sentinel({
    indexer: options.wrapIndexer ? options.wrapIndexer(real) : real,
    guardian: GUARDIAN,
    notifiers: [notifier],
    config: DEFAULT_CONFIG,
    webUrl: WEB_URL,
    log,
    clock: () => 1_790_935_700,
    stream: { minBackoffMs: 20, maxBackoffMs: 50 },
    ...options,
  });
  cleanups.push(() => sentinel.stop());
  return { fake, sentinel, notifier };
}

const events = storyline.events;
const kindsOf = (alerts: Alert[]) => alerts.map((a) => [a.kind, a.agent]);
const EXPECTED = [
  ["approval_requested", RESEARCH],
  ["tripwire_fired", RESEARCH],
  ["approval_requested", MARKET],
];

describe("Sentinel against the indexer", () => {
  it("turns the live storyline into exactly the expected alerts", async () => {
    const { fake, sentinel, notifier } = await setup();
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    for (const event of events) fake.publish(event);
    await waitFor(() => notifier.alerts.length === 3, "three alerts");
    await sentinel.idle();
    expect(kindsOf(notifier.alerts)).toEqual(EXPECTED);
    expect(fake.received).toContainEqual({ type: "subscribe", owners: [key("owner")] });
    expect(sentinel.status()).toMatchObject({ ok: true, connected: true, alertsSent: 3 });
  });

  it("learns the past silently at start and alerts only on what comes next", async () => {
    const split = events.findIndex((e) => e.type === "RequestApproved");
    const { fake, sentinel, notifier } = await setup({ history: events.slice(0, split) });
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    await sentinel.idle();
    expect(notifier.alerts).toEqual([]);
    for (const event of events.slice(split)) fake.publish(event);
    await waitFor(() => notifier.alerts.length === 2, "two alerts");
    expect(kindsOf(notifier.alerts)).toEqual(EXPECTED.slice(1));
  });

  it("backfills what it missed while disconnected, without repeating anything", async () => {
    const split = events.findIndex((e) => e.type === "PaymentDenied");
    const { fake, sentinel, notifier } = await setup();
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    for (const event of events.slice(0, split)) fake.publish(event);
    await waitFor(() => notifier.alerts.length === 1, "the first approval");

    fake.dropConnections();
    // The attack happens while Sentinel is away: the history has it, the stream cannot push it.
    for (const event of events.slice(split)) fake.publish(event, { push: false });
    await waitFor(() => fake.connections === 2 && fake.subscribers() === 1, "a reconnect");
    await waitFor(() => notifier.alerts.length === 3, "the backfilled alerts");
    // Live duplicates of backfilled events change nothing.
    for (const event of events.slice(split)) fake.pushEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await sentinel.idle();
    expect(kindsOf(notifier.alerts)).toEqual(EXPECTED);
  });

  it("answers the server's ping with pong", async () => {
    const { fake, sentinel } = await setup();
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    fake.ping();
    await waitFor(() => fake.received.some((m) => m.type === "pong"), "a pong");
  });

  it("drops a connection that went silent and reconnects", async () => {
    const { fake, sentinel } = await setup({
      stream: { minBackoffMs: 20, maxBackoffMs: 50, idleTimeoutMs: 100 },
    });
    fake.greet = false;
    await sentinel.start();
    await waitFor(() => fake.connections >= 2, "a second connection");
  });

  it("warms up again when the indexer no longer knows its cursor", async () => {
    const { fake, sentinel, notifier } = await setup({ history: events.slice(0, 5) });
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    await sentinel.idle();

    fake.history = []; // the indexer's database was reset
    fake.dropConnections();
    await waitFor(() => fake.connections === 2 && fake.subscribers() === 1, "a reconnect");
    await sentinel.idle();
    expect(notifier.alerts).toEqual([]);

    const request = events.find((e) => e.type === "PaymentRequested");
    if (!request) throw new Error("storyline has no request");
    fake.publish(request);
    await waitFor(() => notifier.alerts.length === 1, "an alert after the reset");
  });

  it("alerts on agent views from the stream (a low allowance)", async () => {
    const { fake, sentinel, notifier } = await setup();
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    fake.pushAgent(agentView(RESEARCH, { remaining: "100000" }, 1_790_935_700));
    await waitFor(() => notifier.alerts.length === 1, "the allowance alert");
    expect(notifier.alerts[0]?.kind).toBe("allowance_low");
  });

  it("starts watching an owner that names the guardian later", async () => {
    const { fake, sentinel, notifier } = await setup({ refreshOwnersMs: 30 });
    fake.guardianOwners = [];
    await sentinel.start();
    expect(sentinel.status().owners).toEqual([]);
    fake.guardianOwners = [key("owner")];
    await waitFor(() => fake.subscribers() === 1, "the late subscription");
    for (const event of events) fake.publish(event);
    await waitFor(() => notifier.alerts.length === 3, "three alerts");
  });

  it("keeps trying when the indexer is not reachable at start", async () => {
    let failures = 1;
    const { fake, sentinel } = await setup({
      refreshOwnersMs: 30,
      wrapIndexer: (real) => ({
        ...real,
        guardianOwners: async (guardian) => {
          if (failures-- > 0) throw new Error("connection refused");
          return real.guardianOwners(guardian);
        },
      }),
    });
    await sentinel.start();
    expect(sentinel.status().ok).toBe(false);
    await waitFor(() => fake.subscribers() === 1, "the subscription after a retry");
    await waitFor(() => sentinel.status().ok, "health ok");
  });

  it("counts an alert a notifier failed to deliver and still uses the others", async () => {
    const working = recorder();
    const broken: Notifier = {
      name: "broken",
      send: async () => {
        throw new Error("telegram is down");
      },
    };
    const { fake, sentinel } = await setup({ notifiers: [broken, working] });
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    for (const event of events) fake.publish(event);
    await waitFor(() => working.alerts.length === 3, "three alerts");
    expect(sentinel.status()).toMatchObject({ alertsSent: 3, alertsFailed: 3 });
  });

  it("hands the rules' freezes to the guardian and delivers what it reports", async () => {
    const asked: unknown[] = [];
    const { fake, sentinel, notifier } = await setup({
      onActions: async (actions, alerts) => {
        asked.push(...actions);
        const trigger = alerts[0];
        if (!trigger) return [];
        return [
          {
            ...trigger,
            id: `guardian_freeze:${trigger.owner}:${trigger.id}`,
            kind: "guardian_freeze",
            severity: "critical",
            title: "Sentinel froze all agents",
          },
        ];
      },
    });
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    const nonStrike = { reason: "exceedsPayeePeriodLimit" as const };
    for (const event of [
      ev.denied(T0, RESEARCH, nonStrike),
      ev.denied(T0 + 10, MARKET, nonStrike),
      ev.denied(T0 + 20, SPARE, nonStrike),
    ]) {
      fake.publish(event);
    }
    await waitFor(() => notifier.alerts.length === 2, "the burst and the freeze alerts");
    expect(notifier.alerts.map((a) => a.kind)).toEqual(["burst_denials", "guardian_freeze"]);
    expect(asked).toEqual([
      { type: "freezePrincipal", owner: key("owner"), alertId: notifier.alerts[0]?.id },
    ]);
  });

  it("prints alerts with the console notifier", async () => {
    const lines: string[] = [];
    const { fake, sentinel } = await setup({
      notifiers: [createConsoleNotifier((text) => void lines.push(text))],
    });
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    for (const event of events) fake.publish(event);
    await waitFor(() => lines.length === 3, "three printed alerts");
    expect(lines[1]).toMatch(/^\[CRITICAL\] Research Assistant was frozen by its tripwire\n {2}/);
    expect(lines[1]).toContain(`  → Open agent: ${WEB_URL}/app/agents/${RESEARCH}\n`);
  });
});

describe("the health endpoint", () => {
  it("answers 200 while connected, 503 after losing the indexer, 404 elsewhere", async () => {
    const { fake, sentinel } = await setup({ stream: { minBackoffMs: 1000, maxBackoffMs: 1000 } });
    await sentinel.start();
    await waitFor(() => fake.subscribers() === 1, "the subscription");
    const health = createHealthServer(() => sentinel.status());
    await new Promise<void>((resolve) => health.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => void health.close());
    const address = health.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}`;

    const ok = await fetch(`${base}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, guardian: GUARDIAN, owners: [key("owner")] });

    fake.dropConnections();
    await waitFor(() => !sentinel.status().connected, "the disconnect");
    expect((await fetch(`${base}/health`)).status).toBe(503);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });
});
