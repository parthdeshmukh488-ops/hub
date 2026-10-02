import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { DemoStoryline, LeashEvent, StorylineDelegation } from "@leash/contracts";
import { getBase58Decoder } from "@solana/kit";
import type { AccountFacts, DelegationRecord } from "../projection/records.ts";
import type { EventSink, EventSource } from "./source.ts";

// Fixture replay (ADR 20260930-ws4-fixture-replay): the demo storyline, delivered transaction by
// transaction on the replay clock, optionally looping with fresh signatures.

export type ReplayOptions = {
  /** 1 = real time, 10 = ten times faster, 0 = everything at once (no loop). */
  speed: number;
  loop: boolean;
  /** Keep the storyline's own times instead of following the replay clock (tests). */
  originalTimes?: boolean;
  /** Pause between loops, in wall-clock milliseconds. */
  loopPauseMs?: number;
  /** Wall clock in milliseconds. */
  clock?: () => number;
  /** Waits `ms`; rejects when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Called if delivery fails in the background. Without it, the error is rethrown. */
  onError?: (error: unknown) => void;
};

/** Maps storyline times onto one loop of the replay. */
export type TimeMap = {
  /** The storyline time of the first event. */
  origin: number;
  /** A moment on the storyline's timeline. */
  at(t: number): number;
  /** A deadline: keeps its distance to its anchor, so durations survive any speed. */
  deadline(anchor: number, t: number): number;
  /** When (wall-clock ms) the event at storyline time `t` is due. */
  dueAtMs(t: number): number;
};

export function timeMap(
  storyline: DemoStoryline,
  loopStartMs: number,
  options: Pick<ReplayOptions, "speed" | "originalTimes">,
): TimeMap {
  const first = storyline.events[0]?.timestamp ?? 0;
  const last = storyline.events.at(-1)?.timestamp ?? first;
  const startSecs = Math.floor(loopStartMs / 1000);
  const at = (t: number): number => {
    if (options.originalTimes) return t;
    // Speed 0 lays the whole storyline down at once, ending now.
    if (options.speed === 0) return t - last + startSecs;
    return startSecs + Math.floor((t - first) / options.speed);
  };
  return {
    origin: first,
    at,
    deadline: (anchor, t) => at(anchor) + (t - anchor),
    dueAtMs: (t) =>
      options.speed === 0 ? loopStartMs : loopStartMs + ((t - first) * 1000) / options.speed,
  };
}

const base58 = getBase58Decoder();

/** A fresh, valid-looking signature for loop `n` > 0 (deterministic). */
export function loopSignature(signature: string, n: number): string {
  const digest = createHash("sha512").update(`leash:replay:${n}:${signature}`).digest();
  return base58.decode(new Uint8Array(digest));
}

/** The event as it happens in loop `n` of the replay. */
export function replayEvent(
  event: LeashEvent,
  n: number,
  map: TimeMap,
  slotShift: number,
): LeashEvent {
  const signature = n === 0 ? event.signature : loopSignature(event.signature, n);
  const innerIndex = event.id.slice(event.id.lastIndexOf(":") + 1);
  const moved = {
    ...event,
    id: `${signature}:${innerIndex}`,
    signature,
    slot: event.slot + n * slotShift,
    blockTime: map.at(event.blockTime),
    timestamp: map.at(event.timestamp),
  };
  switch (moved.type) {
    case "PaymentRequested":
      return { ...moved, expiresAt: map.deadline(event.timestamp, moved.expiresAt) };
    case "AgentCreated":
    case "PolicyUpdated": {
      const { validUntil } = moved.policy;
      return {
        ...moved,
        policy: {
          ...moved.policy,
          validUntil: validUntil === null ? null : map.deadline(event.timestamp, validUntil),
        },
      };
    }
    default:
      return moved;
  }
}

function delegationRecord(d: StorylineDelegation, map: TimeMap): DelegationRecord {
  const base = { address: d.address, agent: d.agent, owner: d.owner, mint: d.mint };
  if (d.kind === "fixed") {
    // A fixed delegation has no start; its expiry keeps its distance to the storyline's start.
    const expiresAt = d.expiresAt === null ? null : map.deadline(map.origin, d.expiresAt);
    return { ...base, kind: "fixed", amountRemaining: d.amount, expiresAt };
  }
  return {
    ...base,
    kind: "recurring",
    amountPerPeriod: d.amountPerPeriod,
    periodLengthSecs: d.periodLengthSecs,
    currentPeriodStart: map.at(d.currentPeriodStart),
    pulledInPeriod: "0",
    expiresAt: d.expiresAt === null ? null : map.deadline(d.currentPeriodStart, d.expiresAt),
  };
}

/** The storyline's account facts for one loop. */
export function replayAccounts(storyline: DemoStoryline, map: TimeMap): AccountFacts {
  const accounts = storyline.accounts ?? { delegations: [], payeeEntries: [] };
  return {
    delegations: accounts.delegations.map((d) => delegationRecord(d, map)),
    payeeEntries: accounts.payeeEntries,
  };
}

/** Groups events by transaction, keeping order: one sink call per transaction. */
function transactions(events: readonly LeashEvent[]): LeashEvent[][] {
  const groups: LeashEvent[][] = [];
  for (const event of events) {
    const group = groups.at(-1);
    if (group?.[0]?.signature === event.signature) group.push(event);
    else groups.push([event]);
  }
  return groups;
}

const defaultSleep = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal });

/** A fixture source; `finished` resolves when a non-looping replay has delivered everything. */
export type FixtureSource = EventSource & { finished(): Promise<void> };

export function createFixtureSource(
  storyline: DemoStoryline,
  options: ReplayOptions,
): FixtureSource {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const loopPauseMs = options.loopPauseMs ?? 10_000;
  const slots = storyline.events.map((event) => event.slot);
  const slotShift = Math.max(...slots) - Math.min(...slots) + 1000;
  const groups = transactions(storyline.events);
  const controller = new AbortController();
  let running: Promise<void> | undefined;

  async function waitUntil(dueMs: number): Promise<void> {
    const wait = dueMs - clock();
    if (wait > 0) await sleep(wait, controller.signal);
  }

  async function run(sink: EventSink): Promise<void> {
    for (let n = 0; !controller.signal.aborted; n++) {
      const map = timeMap(storyline, clock(), options);
      if (n > 0) await sink.resetProjections();
      await sink.accounts(replayAccounts(storyline, map));
      for (const group of groups) {
        const first = group[0];
        if (!first) continue;
        await waitUntil(map.dueAtMs(first.timestamp));
        if (controller.signal.aborted) return;
        await sink.events(group.map((event) => replayEvent(event, n, map, slotShift)));
      }
      if (!options.loop || options.speed === 0) return;
      await sleep(loopPauseMs, controller.signal);
    }
  }

  /** The replay failed: it will not deliver anything more. */
  let failed = false;

  return {
    kind: "fixtures",
    async start(sink) {
      running = run(sink).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        failed = true;
        if (!options.onError) throw error;
        options.onError(error);
      });
      // At speed 0 everything is delivered before start resolves, so reads see the full story.
      if (options.speed === 0) await running;
    },
    async stop() {
      controller.abort();
      await running;
    },
    async finished() {
      await running;
    },
    // A replay has no upstream to lag behind.
    lagSeconds: () => 0,
    healthy: () => !failed,
  };
}
