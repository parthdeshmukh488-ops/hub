import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { evaluate, evaluateAll } from "../src/rules/evaluate.ts";
import type { RuleInput } from "../src/rules/types.ts";
import {
  ATTACKER,
  agentView,
  context,
  ev,
  events,
  expectValid,
  freshState,
  MARKET,
  MERCHANT,
  OWNER,
  RESEARCH,
  SPARE,
  T0,
  USDC,
} from "./helpers.ts";

const run = (inputs: RuleInput[], ctx = context()) => {
  const result = evaluateAll(freshState(), inputs, ctx);
  expectValid(result.alerts);
  return result;
};

/** Labels for the agents used below. */
const setup = [
  ev.agentCreated(T0 - 7200, RESEARCH, "Research"),
  ev.agentCreated(T0 - 7200, MARKET, "Market"),
  ev.agentCreated(T0 - 7200, SPARE, "Spare"),
];

describe("the engine", () => {
  it("never modifies the state it is given", () => {
    const state = evaluateAll(freshState(), events(setup), context()).state;
    const before = structuredClone(state);
    evaluate(state, { kind: "event", event: ev.denied(T0, RESEARCH) }, T0, context());
    expect(state).toEqual(before);
  });

  it("ignores an event it has already seen", () => {
    const request = ev.requested(T0, RESEARCH, 2n * USDC);
    const first = evaluate(freshState(), { kind: "event", event: request }, T0, context());
    expect(first.alerts).toHaveLength(1);
    const again = evaluate(first.state, { kind: "event", event: request }, T0, context());
    expect(again.alerts).toEqual([]);
    expect(again.state).toBe(first.state);
  });

  it("switches a rule off with enabled: false", () => {
    const rules = {
      ...DEFAULT_CONFIG.rules,
      approvalRequested: { enabled: false },
    };
    expect(run(events([ev.requested(T0, RESEARCH, USDC)]), context({ rules })).alerts).toEqual([]);
  });
});

describe("approval_requested", () => {
  it("alerts on every request, without a cooldown", () => {
    const { alerts } = run(
      events([
        ...setup,
        ev.payeeAdded(T0 - 3600, RESEARCH, MERCHANT, "Research API"),
        ev.requested(T0, RESEARCH, 1_500_000n),
        ev.requested(T0 + 1, RESEARCH, 2n * USDC, ""),
      ]),
    );
    expect(alerts.map((a) => a.title)).toEqual([
      "Research asks you to approve 1.50 USDC",
      "Research asks you to approve 2.00 USDC",
    ]);
    expect(alerts[0]?.body).toBe(
      "Research wants to pay 1.50 USDC to Research API for “premium report”. " +
        "It cannot pay until you approve; the request expires in 10 minutes.",
    );
    expect(alerts[1]?.body).toMatch(/^Research wants to pay 2.00 USDC to Research API\. /);
  });

  it("names an unknown agent and payee by their short address", () => {
    const { alerts } = run(events([ev.requested(T0, RESEARCH, USDC)]));
    expect(alerts[0]?.title).toBe("EGj9…M7ch asks you to approve 1.00 USDC");
    expect(alerts[0]?.body).toContain("to 4gMn…VUT9");
  });
});

describe("tripwire_fired", () => {
  it("tells which blocked payments tripped it", () => {
    const strikes = [
      ev.denied(T0, RESEARCH, { strikes: 1 }),
      ev.denied(T0 + 30, RESEARCH, { strikes: 2 }),
      ev.denied(T0 + 60, RESEARCH, { strikes: 3, tripped: true }),
    ];
    const frozen = ev.frozen(T0 + 60, RESEARCH);
    const { alerts } = run(events([...setup, ...strikes, frozen]));
    expect(alerts.map((a) => a.kind)).toEqual(["tripwire_fired"]);
    expect(alerts[0]?.eventIds).toEqual([...strikes.map((e) => e.id), frozen.id]);
    expect(alerts[0]?.body).toContain("tried 3 payments its policy blocks within 1 minute");
  });

  it("counts only the strikes of the current window", () => {
    const old = ev.denied(T0, RESEARCH, { strikes: 1 });
    const strikes = [
      ev.denied(T0 + 900, RESEARCH, { strikes: 1 }),
      ev.denied(T0 + 910, RESEARCH, { reason: "velocityExceeded" }),
      ev.denied(T0 + 920, RESEARCH, { strikes: 2, tripped: true }),
    ];
    const { alerts } = run(
      events([...setup, old, ...strikes, ev.frozen(T0 + 920, RESEARCH)]),
      context({
        rules: {
          ...DEFAULT_CONFIG.rules,
          burstDenials: { ...DEFAULT_CONFIG.rules.burstDenials, enabled: false },
        },
      }),
    );
    expect(alerts[0]?.eventIds.slice(0, 2)).toEqual([strikes[0]?.id, strikes[2]?.id]);
  });

  it("still alerts when Sentinel missed the denials", () => {
    const { alerts } = run(events([...setup, ev.frozen(T0, RESEARCH)]));
    expect(alerts[0]?.body).toBe(
      "Research's tripwire froze it on-chain after repeated blocked payments. " +
        "It cannot pay until you unfreeze it.",
    );
  });

  it("is quiet when the owner or the guardian froze the agent", () => {
    const { alerts } = run(
      events([...setup, ev.frozen(T0, RESEARCH, "owner"), ev.frozen(T0, MARKET, "guardian")]),
    );
    expect(alerts).toEqual([]);
  });
});

describe("burst_denials", () => {
  const nonStrike = { reason: "exceedsPayeePeriodLimit" as const };

  it("needs minDenials within the window", () => {
    expect(
      run(
        events([
          ...setup,
          ev.denied(T0, RESEARCH, nonStrike),
          ev.denied(T0 + 10, MARKET, nonStrike),
        ]),
      ).alerts,
    ).toEqual([]);
    const spread = [
      ev.denied(T0, RESEARCH, nonStrike),
      ev.denied(T0 + 200, MARKET, nonStrike),
      ev.denied(T0 + 300, SPARE, nonStrike),
    ];
    expect(run(events([...setup, ...spread])).alerts).toEqual([]);
  });

  it("alerts on denials across agents and asks to freeze the principal", () => {
    const denials = [
      ev.denied(T0, RESEARCH, nonStrike),
      ev.denied(T0 + 100, MARKET, nonStrike),
      ev.denied(T0 + 299, SPARE, nonStrike),
    ];
    const { alerts, actions } = run(events([...setup, ...denials]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "burst_denials",
      severity: "warning",
      agent: null,
      title: "3 blocked payments within 5 minutes",
      eventIds: denials.map((d) => d.id),
      actions: [{ label: "Open activity", url: "http://localhost:3000/app/activity" }],
    });
    expect(alerts[0]?.body).toBe(
      "3 payments were blocked across 3 agents (Research, Market, Spare). " +
        "The latest: This payee's budget is used up. An agent may have been manipulated: check what it is doing.",
    );
    expect(actions).toEqual([{ type: "freezePrincipal", owner: OWNER, alertId: alerts[0]?.id }]);
  });

  it("stays quiet, and freezes nothing, when one agent's tripwire fired", () => {
    const { alerts, actions } = run(
      events([
        ...setup,
        ev.denied(T0, RESEARCH, { strikes: 1 }),
        ev.denied(T0 + 10, RESEARCH, { strikes: 2 }),
        ev.denied(T0 + 20, RESEARCH, { strikes: 3, tripped: true }),
        // Even before AgentFrozen arrives, and after it.
        ev.frozen(T0 + 20, RESEARCH),
        ev.denied(T0 + 80, RESEARCH, { reason: "agentFrozen" }),
      ]),
    );
    expect(alerts.map((a) => a.kind)).toEqual(["tripwire_fired"]);
    expect(actions).toEqual([]);
  });

  it("alerts when the denials span the tripped agent and another one", () => {
    const { alerts, actions } = run(
      events([
        ...setup,
        ev.denied(T0, RESEARCH, { strikes: 1 }),
        ev.denied(T0 + 10, RESEARCH, { strikes: 2, tripped: true }),
        ev.denied(T0 + 20, MARKET, { strikes: 1 }),
      ]),
    );
    expect(alerts.map((a) => a.kind)).toEqual(["burst_denials"]);
    expect(actions.map((a) => a.type)).toEqual(["freezePrincipal"]);
  });

  it("alerts for one agent whose tripwire did not fire, naming it", () => {
    const { alerts } = run(
      events([
        ...setup,
        ev.denied(T0, RESEARCH, nonStrike),
        ev.denied(T0 + 10, RESEARCH, nonStrike),
        ev.denied(T0 + 20, RESEARCH, nonStrike),
      ]),
    );
    expect(alerts[0]?.agent).toBe(RESEARCH);
    expect(alerts[0]?.body).toMatch(/^3 payments were blocked by Research\. /);
  });

  it("alerts again for an agent after it was unfrozen", () => {
    const { alerts } = run(
      events([
        ...setup,
        ev.denied(T0, RESEARCH, { strikes: 1, tripped: true }),
        ev.unfrozen(T0 + 30, RESEARCH),
        ev.denied(T0 + 40, RESEARCH, nonStrike),
        ev.denied(T0 + 50, RESEARCH, nonStrike),
      ]),
    );
    expect(alerts.map((a) => a.kind)).toEqual(["burst_denials"]);
  });

  it("keeps quiet for the cooldown, then alerts again", () => {
    const burst = (t: number) => [
      ev.denied(t, RESEARCH, nonStrike),
      ev.denied(t + 1, MARKET, nonStrike),
      ev.denied(t + 2, SPARE, nonStrike),
    ];
    const { alerts } = run(
      events([...setup, ...burst(T0), ...burst(T0 + 300), ...burst(T0 + 602)]),
    );
    expect(alerts.map((a) => a.createdAt)).toEqual([T0 + 2, T0 + 604]);
  });

  it("asks for no freeze when the principal is already frozen", () => {
    const { alerts, actions } = run(
      events([
        ...setup,
        ev.principalFrozen(T0),
        ev.denied(T0 + 1, RESEARCH, { reason: "principalFrozen" }),
        ev.denied(T0 + 2, MARKET, { reason: "principalFrozen" }),
        ev.denied(T0 + 3, SPARE, { reason: "principalFrozen" }),
      ]),
    );
    expect(alerts).toHaveLength(1);
    expect(actions).toEqual([]);
  });
});

describe("spend_spike", () => {
  it("alerts above the 1 USDC floor with no history, and asks to freeze the agent", () => {
    const { alerts, actions } = run(
      events([...setup, ev.paid(T0, RESEARCH, 600_000n), ev.paid(T0 + 60, RESEARCH, 600_000n)]),
    );
    expect(alerts.map((a) => a.kind)).toEqual(["spend_spike"]);
    expect(alerts[0]?.body).toBe(
      "Research spent 1.20 USDC in the last 10 minutes, more than 3× its rate before " +
        "(0.00 USDC in the 1 hour before that).",
    );
    expect(alerts[0]?.eventIds).toHaveLength(2);
    expect(actions).toEqual([
      { type: "freezeAgent", owner: OWNER, agent: RESEARCH, alertId: alerts[0]?.id },
    ]);
  });

  it("stays below the floor", () => {
    expect(run(events([...setup, ev.paid(T0, RESEARCH, 999_999n)])).alerts).toEqual([]);
  });

  it("compares with the hour before: exactly 3× is not a spike, above it is", () => {
    // 3 USDC in the previous hour is 0.50 USDC per 10 minutes; 3× that is 1.50 USDC.
    const history = [
      ev.paid(T0 - 3000, RESEARCH, 1_500_000n),
      ev.paid(T0 - 900, RESEARCH, 1_500_000n),
    ];
    const kindsFor = (amount: bigint) => {
      const last = ev.paid(T0, RESEARCH, amount);
      return run(events([...setup, ...history, last]))
        .alerts.filter((a) => a.eventIds.includes(last.id))
        .map((a) => a.kind);
    };
    expect(kindsFor(1_500_000n)).toEqual([]);
    expect(kindsFor(1_500_001n)).toEqual(["spend_spike"]);
  });

  it("forgets payments older than the baseline window", () => {
    const old = ev.paid(T0 - 4300, RESEARCH, 900_000n);
    // 0.9 USDC 71+ minutes ago is outside both windows; 1.0 USDC now is a spike.
    expect(run(events([...setup, old, ev.paid(T0, RESEARCH, USDC)])).alerts).toHaveLength(1);
  });

  it("does not count approved payments", () => {
    const { alerts } = run(
      events([...setup, ev.paid(T0, RESEARCH, 5n * USDC, { requestNonce: "0" })]),
    );
    expect(alerts).toEqual([]);
  });

  it("measures each agent on its own", () => {
    const { alerts } = run(
      events([...setup, ev.paid(T0, RESEARCH, 600_000n), ev.paid(T0, MARKET, 600_000n)]),
    );
    expect(alerts).toEqual([]);
  });
});

describe("new_payee_spend", () => {
  const added = ev.payeeAdded(T0, RESEARCH, ATTACKER, "New API", "2000000");
  // The spike rule would also see these payments; keep it out of the way.
  const noSpike = context({
    rules: {
      ...DEFAULT_CONFIG.rules,
      spendSpike: { ...DEFAULT_CONFIG.rules.spendSpike, enabled: false },
    },
  });

  it("alerts on half the payee's cap within 10 minutes of PayeeAdded", () => {
    const { alerts, actions } = run(
      events([...setup, added, ev.paid(T0 + 60, RESEARCH, USDC, { payee: ATTACKER })]),
      noSpike,
    );
    expect(alerts.map((a) => a.kind)).toEqual(["new_payee_spend"]);
    expect(alerts[0]?.body).toBe(
      "Research paid 1.00 USDC to New API, 50% of its per-payment cap, 1 minute after the payee " +
        "was added. Check that you added this payee yourself.",
    );
    expect(actions).toEqual([]);
  });

  it("stays quiet below half the cap, after the window, or for approved payments", () => {
    const quiet = [
      ev.paid(T0 + 60, RESEARCH, 999_999n, { payee: ATTACKER }),
      ev.paid(T0 + 601, RESEARCH, 2n * USDC, { payee: ATTACKER }),
    ];
    expect(run(events([...setup, added, ...quiet]), noSpike).alerts).toEqual([]);
    expect(
      run(
        events([
          ...setup,
          added,
          ev.paid(T0 + 60, RESEARCH, 2n * USDC, { payee: ATTACKER, requestNonce: "1" }),
        ]),
      ).alerts,
    ).toEqual([]);
  });

  it("falls back to the agent's cap, and is off when neither has one", () => {
    const uncapped = ev.payeeAdded(T0, RESEARCH, ATTACKER, "New API", "0");
    const pay = ev.paid(T0 + 60, RESEARCH, 500_000n, { payee: ATTACKER });
    expect(run(events([...setup, uncapped, pay]), noSpike).alerts.map((a) => a.kind)).toEqual([
      "new_payee_spend",
    ]);
    const noCaps = [ev.agentCreated(T0 - 7200, RESEARCH, "Research", "0"), uncapped, pay];
    expect(run(events(noCaps), noSpike).alerts).toEqual([]);
  });

  it("keeps the time of PayeeAdded when the entry is updated", () => {
    const updated = ev.payeeAdded(
      T0 + 500,
      RESEARCH,
      ATTACKER,
      "New API",
      "2000000",
      "PayeeUpdated",
    );
    const pay = ev.paid(T0 + 700, RESEARCH, 2n * USDC, { payee: ATTACKER });
    expect(run(events([...setup, added, updated, pay]), noSpike).alerts).toEqual([]);
  });

  it("knows payees from an allowlist snapshot after a restart", () => {
    const { alerts } = run(
      [
        ...events(setup),
        {
          kind: "payees",
          agent: RESEARCH,
          payees: [
            {
              address: SPARE,
              agent: RESEARCH,
              payee: ATTACKER,
              label: "Snapshot API",
              maxPerPayment: "2000000",
              periodLimit: "0",
              periodSecs: 0,
              periodStart: null,
              spentInPeriod: "0",
              totalPaid: "0",
              paymentsCount: 0,
              createdAt: T0,
            },
          ],
        },
        ...events([ev.paid(T0 + 30, RESEARCH, USDC, { payee: ATTACKER })]),
      ],
      noSpike,
    );
    expect(alerts[0]?.body).toContain("to Snapshot API, 50%");
  });
});

describe("allowance_low", () => {
  const recurring = (remaining: bigint, periodStart: number, asOf: number) =>
    ({
      kind: "agent",
      agent: agentView(
        RESEARCH,
        { remaining: remaining.toString(), currentPeriodStart: periodStart },
        asOf,
      ),
    }) as const;

  it("alerts once per period below 10% of the amount per period", () => {
    const { alerts } = run([
      recurring(600_000n, T0, T0 + 10), // 12% of 5 USDC
      recurring(500_000n, T0, T0 + 20), // exactly 10%: not below
      recurring(499_999n, T0, T0 + 30),
      recurring(100_000n, T0, T0 + 40), // same period
      recurring(5n * USDC, T0 + 86_400, T0 + 86_410), // a new period
      recurring(100_000n, T0 + 86_400, T0 + 86_420),
    ]);
    expect(alerts.map((a) => a.createdAt)).toEqual([T0 + 30, T0 + 86_420]);
    expect(alerts[0]?.body).toBe(
      "Research Assistant has 0.499999 USDC of its 5.00 USDC allowance left for this period.",
    );
    expect(alerts[0]?.eventIds).toEqual([]);
  });

  it("measures a fixed allowance against the highest remainder seen, once per delegation", () => {
    const fixed = (remaining: bigint, asOf: number) =>
      ({
        kind: "agent",
        agent: agentView(
          RESEARCH,
          {
            kind: "fixed",
            amountPerPeriod: null,
            periodLengthSecs: null,
            currentPeriodStart: null,
            pulledInPeriod: null,
            amountRemaining: remaining.toString(),
            remaining: remaining.toString(),
          },
          asOf,
        ),
      }) as const;
    const { alerts } = run([
      fixed(10n * USDC, T0),
      fixed(USDC, T0 + 10), // exactly 10%
      fixed(900_000n, T0 + 20),
      fixed(100_000n, T0 + 30),
    ]);
    expect(alerts.map((a) => a.createdAt)).toEqual([T0 + 20]);
    expect(alerts[0]?.body).toBe(
      "Research Assistant has 0.90 USDC of its allowance left, out of 10.00 USDC.",
    );
  });
});

describe("untrusted text in alerts", () => {
  it("defangs links and names, strips bidi characters, keeps markup literal", () => {
    const { alerts } = run(
      events([
        ev.agentCreated(T0, RESEARCH, "<a href=x>*bold*</a>"),
        ev.requested(T0 + 1, RESEARCH, USDC, "see https://evil.com t.me/x @admin ‮gnp.exe"),
      ]),
    );
    const alert = alerts[0];
    expect(alert?.title).toBe("<a href=x>*bold*</a> asks you to approve 1.00 USDC");
    expect(alert?.body).toContain("“see https[:]//evil[.]com t[.]me/x (at)admin gnp[.]exe”");
    expect(alert?.body).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it("clips a title that defanging made too long", () => {
    const { alerts } = run(
      events([
        ev.agentCreated(T0, RESEARCH, "a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p."),
        ev.requested(T0 + 1, RESEARCH, USDC),
      ]),
    );
    expect(alerts[0]?.title.length).toBe(80);
    expect(alerts[0]?.title.endsWith("…")).toBe(true);
  });
});
