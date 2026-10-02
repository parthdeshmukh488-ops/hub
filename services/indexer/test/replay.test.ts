import { type LeashEvent, LeashEventSchema } from "@leash/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AccountFacts } from "../src/projection/records.ts";
import { createFixtureSource, replayEvent, timeMap } from "../src/sources/fixtures.ts";
import type { EventSink } from "../src/sources/source.ts";
import { storyline } from "./helpers.ts";

const T0 = storyline.events[0]?.timestamp ?? 0;
const LAST = storyline.events.at(-1)?.timestamp ?? 0;
const requested = storyline.events.find((e) => e.type === "PaymentRequested");

/** A sink that records deliveries, and a fake clock that sleeping advances. */
function harness(startMs = 1_800_000_000_000) {
  let now = startMs;
  const calls: Array<
    | { kind: "accounts"; facts: AccountFacts }
    | { kind: "events"; events: LeashEvent[]; at: number }
    | { kind: "reset" }
  > = [];
  const sink: EventSink = {
    accounts: async (facts) => void calls.push({ kind: "accounts", facts }),
    events: async (events) => void calls.push({ kind: "events", events, at: now }),
    resetProjections: async () => void calls.push({ kind: "reset" }),
    snapshot: async () => {},
  };
  const clock = () => now;
  const sleep = async (ms: number, signal: AbortSignal) => {
    if (signal.aborted) throw new Error("aborted");
    now += ms;
  };
  const delivered = () => calls.flatMap((c) => (c.kind === "events" ? c.events : []));
  return { sink, clock, sleep, calls, delivered, now: () => now };
}

describe("time map", () => {
  it("compresses the timeline by the speed and keeps deadlines' durations", () => {
    const map = timeMap(storyline, 1_800_000_000_000, { speed: 10 });
    expect(map.at(T0)).toBe(1_800_000_000);
    expect(map.at(T0 + 100)).toBe(1_800_000_010);
    expect(map.deadline(T0 + 100, T0 + 100 + 3600)).toBe(1_800_000_010 + 3600);
    expect(map.dueAtMs(T0 + 100)).toBe(1_800_000_010_000);
  });

  it("at speed 0 ends the storyline now; with original times changes nothing", () => {
    expect(timeMap(storyline, 1_800_000_000_000, { speed: 0 }).at(LAST)).toBe(1_800_000_000);
    expect(timeMap(storyline, 1_800_000_000_000, { speed: 0, originalTimes: true }).at(T0)).toBe(
      T0,
    );
  });
});

describe("replayEvent", () => {
  it("gives later loops fresh, valid signatures and ids, later slots, and moved times", () => {
    if (requested?.type !== "PaymentRequested") throw new Error("storyline has no request");
    const map = timeMap(storyline, 1_800_000_000_000, { speed: 1 });
    const again = replayEvent(requested, 1, map, 5000);
    expect(LeashEventSchema.parse(again)).toEqual(again);
    expect(again.signature).not.toBe(requested.signature);
    expect(again.id).toBe(`${again.signature}:0`);
    expect(again.slot).toBe(requested.slot + 5000);
    expect(again.type === "PaymentRequested" && again.expiresAt - again.timestamp).toBe(
      requested.expiresAt - requested.timestamp,
    );
    expect(replayEvent(requested, 1, map, 5000)).toEqual(again);
    expect(replayEvent(requested, 0, map, 5000).id).toBe(requested.id);
  });
});

describe("fixture source", () => {
  it("delivers accounts first, then every transaction on schedule", async () => {
    const h = harness();
    const source = createFixtureSource(storyline, {
      speed: 10,
      loop: false,
      clock: h.clock,
      sleep: h.sleep,
    });
    await source.start(h.sink);
    await source.finished();
    expect(h.calls[0]?.kind).toBe("accounts");
    expect(h.delivered()).toHaveLength(storyline.events.length);
    const last = h.calls.at(-1);
    // The last transaction is due (LAST - T0) / 10 seconds after the start.
    expect(last?.kind === "events" && last.at).toBe(1_800_000_000_000 + ((LAST - T0) * 1000) / 10);
    // Events of one transaction are delivered together.
    const frozen = h.calls.find(
      (c) => c.kind === "events" && c.events.some((e) => e.type === "AgentFrozen"),
    );
    expect(frozen?.kind === "events" && frozen.events.map((e) => e.type)).toEqual([
      "PaymentDenied",
      "AgentFrozen",
    ]);
  });

  it("loops with a projection reset and new ids, until stopped", async () => {
    const h = harness();
    const source = createFixtureSource(storyline, {
      speed: 100,
      loop: true,
      clock: h.clock,
      sleep: h.sleep,
      loopPauseMs: 5,
    });
    const secondLoop = new Promise<void>((resolve) => {
      const original = h.sink.events;
      h.sink.events = async (events) => {
        await original(events);
        if (h.delivered().length > storyline.events.length) resolve();
      };
    });
    await source.start(h.sink);
    await secondLoop;
    await source.stop();
    expect(h.calls.filter((c) => c.kind === "reset")).toHaveLength(1);
    const ids = h.delivered().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(storyline.events.length);
  });

  it("at speed 0 delivers everything before start resolves, and never loops", async () => {
    const h = harness();
    const sleep = vi.fn(h.sleep);
    const source = createFixtureSource(storyline, { speed: 0, loop: true, clock: h.clock, sleep });
    await source.start(h.sink);
    expect(h.delivered()).toHaveLength(storyline.events.length);
    expect(h.calls.filter((c) => c.kind === "reset")).toHaveLength(0);
    expect(sleep).not.toHaveBeenCalled();
    expect(source.lagSeconds()).toBe(0);
  });

  it("reports background failures to onError", async () => {
    const h = harness();
    const onError = vi.fn();
    const source = createFixtureSource(storyline, {
      speed: 10,
      loop: false,
      clock: h.clock,
      sleep: h.sleep,
      onError,
    });
    await source.start({ ...h.sink, events: async () => Promise.reject(new Error("disk full")) });
    await source.finished();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full" }));
  });
});
