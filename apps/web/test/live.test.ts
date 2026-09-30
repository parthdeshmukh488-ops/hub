import { DemoStorylineSchema, type LeashEvent, type StreamServerMessage } from "@leash/contracts";
import storylineJson from "@leash/contracts/fixtures/demo-storyline.json";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import { type InfiniteData, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "../src/data/fixtures.ts";
import { DEMO_OWNER } from "../src/data/owner.ts";
import type { AgentDetail, EventsPage, Overview } from "../src/data/source.ts";
import { applyMessage, queryKeys } from "../src/live/apply.ts";
import { insertEvent, matchesFilter, refreshFor, upsertAgent } from "../src/live/merge.ts";
import { LiveStream, type SocketLike } from "../src/live/stream.ts";

const storyline = DemoStorylineSchema.parse(storylineJson);
const events = storyline.events;
const byType = (type: LeashEvent["type"]) => {
  const found = events.find((e) => e.type === type);
  if (!found) throw new Error(`no ${type}`);
  return found;
};
const newestFirst = (list: readonly LeashEvent[]) => [...list].reverse();

describe("merge rules", () => {
  it("inserts in slot order, newest first, never twice, within the limit", () => {
    const list = newestFirst(events.slice(0, 5));
    const next = events[5] as LeashEvent;
    expect(insertEvent(list, next)[0]).toBe(next);
    expect(insertEvent(list, list[2] as LeashEvent)).toEqual(list);
    const older = insertEvent(newestFirst(events.slice(1, 5)), events[0] as LeashEvent);
    expect(older.at(-1)).toBe(events[0]);
    expect(insertEvent(list, next, 3)).toHaveLength(3);
  });

  it("puts the later event of one transaction first", () => {
    const denied = byType("PaymentDenied");
    const tripped = events.find((e) => e.type === "PaymentDenied" && e.tripped) as LeashEvent;
    const frozen = byType("AgentFrozen");
    const list = insertEvent(insertEvent([denied], tripped), frozen);
    expect(list.map((e) => e.type)).toEqual(["AgentFrozen", "PaymentDenied", "PaymentDenied"]);
  });

  it("filters by agent and type, and upserts agents in creation order", () => {
    const denied = byType("PaymentDenied");
    expect(matchesFilter(denied, {})).toBe(true);
    expect(matchesFilter(denied, { types: ["PaymentExecuted"] })).toBe(false);
    expect(matchesFilter(denied, { agent: "someone else" })).toBe(false);
    const [research, market] = overviewJson.agents as unknown as [
      Overview["agents"][0],
      Overview["agents"][0],
    ];
    expect(upsertAgent([market], research).map((a) => a.label)).toEqual([
      "Research Assistant",
      "Market Watcher",
    ]);
    expect(upsertAgent([research, market], { ...market, label: "Renamed" })[1]?.label).toBe(
      "Renamed",
    );
  });

  it("reloads exactly what an event can make stale", () => {
    expect(refreshFor(byType("AgentCreated"))).toMatchObject({ overview: true, requests: false });
    expect(refreshFor(byType("PaymentRequested"))).toMatchObject({
      overview: false,
      requests: true,
    });
    expect(refreshFor(byType("PaymentDenied"))).toEqual({
      overview: false,
      requests: false,
      agents: [],
    });
    const approvedPayment = events.find(
      (e) => e.type === "PaymentExecuted" && e.requestNonce !== null,
    );
    expect(approvedPayment && refreshFor(approvedPayment).requests).toBe(true);
  });
});

describe("applying stream messages to the cache", () => {
  async function seeded() {
    const source = createFixtureSource();
    const client = new QueryClient();
    const research = storyline.keys.researchAgent ?? "";
    const overview = await source.overview(DEMO_OWNER);
    const early = { ...overview, recentBlocked: [] };
    client.setQueryData(queryKeys.overview(DEMO_OWNER), early);
    const detail = await source.agent(DEMO_OWNER, research);
    client.setQueryData(
      queryKeys.agent(DEMO_OWNER, research),
      detail ? { ...detail, events: [] } : null,
    );
    const page: InfiniteData<EventsPage> = {
      pages: [{ items: [], nextBefore: null }],
      pageParams: [undefined],
    };
    client.setQueryData(queryKeys.activityFor(DEMO_OWNER, {}), page);
    client.setQueryData(queryKeys.activityFor(DEMO_OWNER, { types: ["PaymentExecuted"] }), page);
    return { client, research };
  }

  it("adds events to the lists they belong to, once", async () => {
    const { client, research } = await seeded();
    const denied = byType("PaymentDenied");
    const message: StreamServerMessage = { type: "event", event: denied };
    applyMessage(client, DEMO_OWNER, message);
    applyMessage(client, DEMO_OWNER, message);
    const all = client.getQueryData<InfiniteData<EventsPage>>(
      queryKeys.activityFor(DEMO_OWNER, {}),
    );
    const paymentsOnly = client.getQueryData<InfiniteData<EventsPage>>(
      queryKeys.activityFor(DEMO_OWNER, { types: ["PaymentExecuted"] }),
    );
    expect(all?.pages[0]?.items).toEqual([denied]);
    expect(paymentsOnly?.pages[0]?.items).toEqual([]);
    expect(client.getQueryData<AgentDetail>(queryKeys.agent(DEMO_OWNER, research))?.events).toEqual(
      [denied],
    );
    expect(client.getQueryData<Overview>(queryKeys.overview(DEMO_OWNER))?.recentBlocked).toEqual([
      denied,
    ]);
  });

  it("replaces an agent everywhere it is shown", async () => {
    const { client, research } = await seeded();
    const overview = client.getQueryData<Overview>(queryKeys.overview(DEMO_OWNER));
    const agent = overview?.agents.find((a) => a.address === research);
    if (!agent) throw new Error("no agent");
    applyMessage(client, DEMO_OWNER, {
      type: "agent",
      agent: { ...agent, status: "active", freezeReason: "none" },
    });
    expect(client.getQueryData<Overview>(queryKeys.overview(DEMO_OWNER))?.agents[0]?.status).toBe(
      "active",
    );
    expect(
      client.getQueryData<AgentDetail>(queryKeys.agent(DEMO_OWNER, research))?.agent.status,
    ).toBe("active");
  });

  it("marks what went stale for a reload", async () => {
    const { client } = await seeded();
    applyMessage(client, DEMO_OWNER, { type: "event", event: byType("AgentCreated") });
    expect(client.getQueryState(queryKeys.overview(DEMO_OWNER))?.isInvalidated).toBe(true);
  });
});

/** A controllable stand-in for the browser WebSocket. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("LiveStream", () => {
  function setup(eventsAfter = vi.fn(async (): Promise<LeashEvent[] | null> => [])) {
    FakeSocket.all = [];
    const received: StreamServerMessage[] = [];
    const statuses: string[] = [];
    const onResync = vi.fn();
    const onReset = vi.fn();
    const stream = new LiveStream({
      url: "ws://indexer/v1/stream",
      owner: DEMO_OWNER,
      source: { eventsAfter },
      onMessage: (m) => received.push(m),
      onResync,
      onReset,
      onStatus: (s) => statuses.push(s),
      createSocket: () => new FakeSocket(),
      backoffMs: () => 0,
    });
    return { stream, received, statuses, onResync, onReset, eventsAfter };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("subscribes on open, answers pings, and passes events on", () => {
    const { stream, received, statuses } = setup();
    stream.start();
    const socket = FakeSocket.all[0] as FakeSocket;
    socket.open();
    expect(socket.sent).toEqual([{ type: "subscribe", owners: [DEMO_OWNER] }]);
    socket.receive({ type: "ping" });
    expect(socket.sent.at(-1)).toEqual({ type: "pong" });
    socket.receive({ type: "event", event: events[0] });
    socket.receive({ type: "nonsense" });
    expect(received).toEqual([{ type: "event", event: events[0] }]);
    expect(statuses).toEqual(["connecting", "live"]);
    stream.stop();
  });

  it("reconnects after a drop and backfills from the last event it saw", async () => {
    const missed = events.slice(1, 3);
    const { stream, received, onResync, eventsAfter } = setup(vi.fn(async () => missed));
    stream.start();
    const first = FakeSocket.all[0] as FakeSocket;
    first.open();
    first.receive({ type: "event", event: events[0] });
    first.close();
    await tick();
    const second = FakeSocket.all[1] as FakeSocket;
    second.open();
    await tick();
    expect(eventsAfter).toHaveBeenCalledWith(DEMO_OWNER, events[0]?.id);
    expect(onResync).toHaveBeenCalledOnce();
    expect(received.map((m) => m.type === "event" && m.event.id)).toEqual(
      events.slice(0, 3).map((e) => e.id),
    );
    stream.stop();
  });

  it("asks for a full reload when the server no longer knows the last event", async () => {
    const { stream, onReset } = setup(vi.fn(async () => null));
    stream.start();
    const first = FakeSocket.all[0] as FakeSocket;
    first.open();
    first.receive({ type: "event", event: events[0] });
    first.close();
    await tick();
    (FakeSocket.all[1] as FakeSocket).open();
    await tick();
    expect(onReset).toHaveBeenCalledOnce();
    stream.stop();
  });

  it("stays closed after stop", async () => {
    const { stream } = setup();
    stream.start();
    (FakeSocket.all[0] as FakeSocket).open();
    stream.stop();
    await tick();
    expect(FakeSocket.all).toHaveLength(1);
  });
});
