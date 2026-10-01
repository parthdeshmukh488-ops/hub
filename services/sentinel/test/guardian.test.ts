import { AlertSchema } from "@leash/contracts";
import {
  buildFreezePrincipal,
  buildSetGuardian,
  fetchAgentView,
  fetchPrincipalView,
  type LeashChain,
} from "@leash/sdk";
import { createTestbed, type Testbed } from "@leash/sdk/testing";
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createGuardian } from "../src/guardian.ts";
import { evaluateAll } from "../src/rules/evaluate.ts";
import { emptyOwnerState } from "../src/rules/state.ts";
import type { SentinelAction } from "../src/rules/types.ts";
import { context, ev, events, MARKET, RESEARCH, SPARE, T0, WEB_URL } from "./helpers.ts";

// Guardian freezes on the LiteSVM testbed: the real leash.so, with keys.guardian as the
// principal's guardian (the testbed's default).

const log = pino({ level: "silent" });

/** The testbed's chain, counting what Sentinel sends. */
function spied(chain: LeashChain) {
  const counts = { sent: 0 };
  const proxy = new Proxy(chain, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "sendAndConfirm" && typeof value === "function") {
        return (...args: unknown[]) => {
          counts.sent++;
          return value.apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { chain: proxy, counts };
}

let tb: Testbed;
beforeEach(async () => {
  tb = await createTestbed();
});

function guardian(options: { autofreeze?: boolean; signer?: "guardian" | "none" } = {}) {
  const { chain, counts } = spied(tb.chain);
  const g = createGuardian({
    chain,
    signer: options.signer === "none" ? null : tb.keys.guardian,
    autofreeze: options.autofreeze ?? true,
    webUrl: WEB_URL,
    log,
    clock: () => Number(tb.now()),
  });
  return { g, counts };
}

/** Three blocked payments across three agents within a minute: the rules ask to freeze the principal. */
function burst() {
  const nonStrike = { reason: "exceedsPayeePeriodLimit" as const };
  const result = evaluateAll(
    emptyOwnerState(tb.keys.owner.address),
    events([
      ev.agentCreated(T0 - 60, RESEARCH, "Research"),
      ev.denied(T0, RESEARCH, nonStrike),
      ev.denied(T0 + 10, MARKET, nonStrike),
      ev.denied(T0 + 20, SPARE, nonStrike),
    ]),
    context(),
  );
  expect(result.actions).toEqual([
    { type: "freezePrincipal", owner: tb.keys.owner.address, alertId: result.alerts[0]?.id },
  ]);
  return result;
}

const principal = () => fetchPrincipalView(tb.chain, tb.keys.owner.address);

describe("guardian freezes on LiteSVM", () => {
  it("freezes the principal after a burst of denials, signed by the guardian", async () => {
    const { actions, alerts } = burst();
    const { g, counts } = guardian();
    const done = await g.act(actions, alerts);

    expect(counts.sent).toBe(1);
    expect(await principal()).toMatchObject({ frozen: true, frozenBy: tb.keys.guardian.address });
    expect(done).toHaveLength(1);
    expect(AlertSchema.parse(done[0])).toEqual(done[0]);
    expect(done[0]).toMatchObject({
      kind: "guardian_freeze",
      severity: "critical",
      agent: null,
      title: "Sentinel froze all agents",
      eventIds: alerts[0]?.eventIds,
    });
    expect(done[0]?.body).toBe(
      "Sentinel froze all agents as your guardian: 3 blocked payments within 5 minutes. " +
        "Payments stay blocked until you unfreeze; only you can.",
    );
  });

  it("freezes one agent when a rule asks for that agent", async () => {
    const action: SentinelAction = {
      type: "freezeAgent",
      owner: tb.keys.owner.address,
      agent: tb.accounts.agent,
      alertId: "spend_spike:x",
    };
    const { g, counts } = guardian();
    const done = await g.act([action], []);
    expect(counts.sent).toBe(1);
    expect(await fetchAgentView(tb.chain, tb.accounts.agent)).toMatchObject({
      status: "frozen",
      freezeReason: "guardian",
    });
    expect(done[0]).toMatchObject({ kind: "guardian_freeze", agent: tb.accounts.agent });
    expect(done[0]?.title).toMatch(/^Sentinel froze /);
  });

  it("never sends a transaction with autofreeze off, or without the keypair", async () => {
    const { actions, alerts } = burst();
    for (const options of [{ autofreeze: false }, { signer: "none" as const }]) {
      const { g, counts } = guardian(options);
      expect(await g.act(actions, alerts)).toEqual([]);
      expect(counts.sent).toBe(0);
    }
    expect(await principal()).toMatchObject({ frozen: false });
  });

  it("never touches a principal whose guardian is someone else", async () => {
    await tb.send(tb.keys.owner, [
      await buildSetGuardian({ owner: tb.keys.owner, guardian: tb.keys.stranger.address }),
    ]);
    const { actions, alerts } = burst();
    const agentAction: SentinelAction = {
      type: "freezeAgent",
      owner: tb.keys.owner.address,
      agent: tb.accounts.agent,
      alertId: "x",
    };
    const { g, counts } = guardian();
    expect(await g.act([...actions, agentAction], alerts)).toEqual([]);
    expect(counts.sent).toBe(0);
    expect(await principal()).toMatchObject({ frozen: false });
    expect(await fetchAgentView(tb.chain, tb.accounts.agent)).toMatchObject({ status: "active" });
  });

  it("does nothing when the target is already frozen", async () => {
    await tb.send(tb.keys.owner, [
      await buildFreezePrincipal({ authority: tb.keys.owner, owner: tb.keys.owner.address }),
    ]);
    const { actions, alerts } = burst();
    const { g, counts } = guardian();
    expect(await g.act(actions, alerts)).toEqual([]);
    expect(counts.sent).toBe(0);
  });

  it("logs a failed freeze once and carries on, without throwing", async () => {
    const { chain } = spied(tb.chain);
    let attempts = 0;
    const failing = new Proxy(chain, {
      get(target, property, receiver) {
        if (property === "sendAndConfirm") {
          return async () => {
            attempts++;
            throw new Error("blockhash not found");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const g = createGuardian({
      chain: failing,
      signer: tb.keys.guardian,
      autofreeze: true,
      webUrl: WEB_URL,
      log,
    });
    const { actions, alerts } = burst();
    expect(await g.act(actions, alerts)).toEqual([]);
    expect(attempts).toBe(1);
  });

  it("skips an agent that is not under this owner", async () => {
    const { g, counts } = guardian();
    const done = await g.act(
      [
        {
          type: "freezeAgent",
          owner: tb.keys.owner.address,
          agent: tb.keys.stranger.address,
          alertId: "x",
        },
      ],
      [],
    );
    expect(done).toEqual([]);
    expect(counts.sent).toBe(0);
  });
});
