import { ACTION_ROUTES, type LeashEvent } from "@leash/contracts";
import { describe, expect, it } from "vitest";
import { evaluate, evaluateAll } from "../src/rules/evaluate.ts";
import {
  context,
  events,
  expectValid,
  freshState,
  key,
  MARKET,
  ownerOverview,
  RESEARCH,
  storyline,
} from "./helpers.ts";

// The pitch demo (02 §14): normal payments, one approval, a manipulated agent's three blocked
// payments, the tripwire, and a second agent waiting for approval.

const replay = (list: LeashEvent[] = storyline.events, ctx = context()) =>
  evaluateAll(freshState(), events(list), ctx);

describe("the demo storyline", () => {
  it("yields exactly the expected alerts", () => {
    const { alerts, actions } = replay();
    expectValid(alerts);
    expect(alerts.map((a) => [a.kind, a.agent])).toEqual([
      ["approval_requested", RESEARCH],
      ["tripwire_fired", RESEARCH],
      ["approval_requested", MARKET],
    ]);
    // The burst rule stays quiet (one agent, and its tripwire fired), so nothing asks to freeze.
    expect(actions).toEqual([]);
    expect(alerts).toMatchSnapshot();
  });

  it("tells the tripwire story from the three blocked payments", () => {
    const tripwire = replay().alerts.find((a) => a.kind === "tripwire_fired");
    const denials = storyline.events.filter((e) => e.type === "PaymentDenied").map((e) => e.id);
    const frozen = storyline.events.find((e) => e.type === "AgentFrozen");
    expect(tripwire?.eventIds).toEqual([...denials, frozen?.id]);
    expect(tripwire?.severity).toBe("critical");
    expect(tripwire?.body).toContain("tried 3 payments its policy blocks within 20 seconds");
  });

  it("does not count the owner's approved 1.50 USDC as a spike or a new-payee payment", () => {
    // The same storyline with the approved payment turned into one the agent made on its own.
    const unapproved = storyline.events.map((e) =>
      e.type === "PaymentExecuted" && e.requestNonce !== null ? { ...e, requestNonce: null } : e,
    );
    const kinds = replay(unapproved).alerts.map((a) => a.kind);
    expect(kinds).toContain("spend_spike");
    expect(kinds).toContain("new_payee_spend");
  });

  it("repeats nothing when the stream delivers every event twice", () => {
    const doubled = storyline.events.flatMap((e) => [e, e]);
    expect(replay(doubled).alerts).toEqual(replay().alerts);
  });

  it("gives the same alerts on a late catch-up as live: windows run on event time", () => {
    const late = 1_900_000_000;
    let state = freshState();
    const caughtUp = [];
    for (const event of storyline.events) {
      const result = evaluate(state, { kind: "event", event }, late, context());
      state = result.state;
      caughtUp.push(...result.alerts);
    }
    const live = replay().alerts;
    expect(caughtUp.map((a) => ({ ...a, createdAt: 0 }))).toEqual(
      live.map((a) => ({ ...a, createdAt: 0 })),
    );
  });

  it("sees no low allowance in the fixture's agent views", () => {
    const { state } = replay();
    const views = ownerOverview.agents.map((agent) => ({ kind: "agent" as const, agent }));
    expect(evaluateAll(state, views, context()).alerts).toEqual([]);
  });

  it("adds Approve and Reject Action links by default, and leaves them out when off", () => {
    const off = replay(storyline.events, context({ actionLinks: false })).alerts[0];
    expect(off?.actions.map((a) => a.label)).toEqual(["Review request"]);

    const on = replay().alerts[0];
    expect(on?.actions).toEqual([
      { label: "Review request", url: "http://localhost:3000/app/approvals" },
      {
        label: "Approve",
        url: `http://localhost:3000${ACTION_ROUTES.approve}?request=${key("researchRequest0")}`,
      },
      {
        label: "Reject",
        url: `http://localhost:3000${ACTION_ROUTES.reject}?request=${key("researchRequest0")}`,
      },
    ]);
  });
});
