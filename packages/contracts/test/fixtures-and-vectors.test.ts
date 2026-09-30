import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentDetailResponseSchema,
  DENIAL_REASON_NAMES,
  DemoStorylineSchema,
  OwnerOverviewResponseSchema,
  PolicyTestVectorsSchema,
  RequestsResponseSchema,
  StatsResponseSchema,
} from "../src/index.ts";
import { evaluate } from "./reference-evaluator.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("fixtures", () => {
  const storyline = DemoStorylineSchema.parse(load("fixtures/demo-storyline.json"));
  const overview = OwnerOverviewResponseSchema.parse(load("fixtures/owner-overview.json"));
  const detail = AgentDetailResponseSchema.parse(load("fixtures/agent-detail.json"));
  const requests = RequestsResponseSchema.parse(load("fixtures/requests.json"));
  const stats = StatsResponseSchema.parse(load("fixtures/stats-24h.json"));

  it("storyline events are unique and in slot order", () => {
    const ids = storyline.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const slots = storyline.events.map((e) => e.slot);
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
  });

  it("storyline tells the demo: payments, an approval, three strikes, the tripwire", () => {
    const types = storyline.events.map((e) => e.type);
    expect(types.filter((t) => t === "PaymentExecuted")).toHaveLength(6);
    expect(types).toContain("RequestApproved");
    const denials = storyline.events.filter((e) => e.type === "PaymentDenied");
    expect(denials.map((e) => (e.type === "PaymentDenied" ? e.strikes : -1))).toEqual([1, 2, 3]);
    const frozen = storyline.events.find((e) => e.type === "AgentFrozen");
    expect(frozen?.type === "AgentFrozen" && frozen.reason).toBe("tripwire");
  });

  it("storyline accounts cover every agent and allowlist entry the events mention", () => {
    const accounts = storyline.accounts;
    expect(accounts).toBeDefined();
    const created = storyline.events.flatMap((e) =>
      e.type === "AgentCreated" && e.agent ? [e.agent] : [],
    );
    expect(accounts?.delegations.map((d) => d.agent).sort()).toEqual([...created].sort());
    const added = storyline.events.flatMap((e) =>
      e.type === "PayeeAdded" && e.agent ? [`${e.agent}/${e.payee}`] : [],
    );
    expect(accounts?.payeeEntries.map((p) => `${p.agent}/${p.payee}`).sort()).toEqual(added.sort());
    for (const agent of overview.agents) {
      const delegation = accounts?.delegations.find((d) => d.agent === agent.address);
      expect(delegation?.address).toBe(agent.allowance?.delegation);
      expect(delegation?.kind === "recurring" && delegation.expiresAt).toBe(
        agent.allowance?.expiresAt,
      );
    }
    expect(accounts?.payeeEntries).toContainEqual({
      address: detail.payees[0]?.address,
      agent: detail.agent.address,
      payee: detail.payees[0]?.payee,
    });
  });

  it("final state agrees with the storyline", () => {
    const executed = storyline.events.filter((e) => e.type === "PaymentExecuted");
    const total = executed.reduce(
      (sum, e) => sum + BigInt(e.type === "PaymentExecuted" ? e.amount : "0"),
      0n,
    );
    expect(stats.totals.paid).toBe(total.toString());
    expect(stats.totals.payments).toBe(executed.length);
    const research = overview.agents.find((a) => a.label === "Research Assistant");
    expect(research).toEqual(detail.agent);
    expect(research?.status).toBe("frozen");
    const paidByResearch = executed
      .filter((e) => e.agent === research?.address)
      .reduce((sum, e) => sum + BigInt(e.type === "PaymentExecuted" ? e.amount : "0"), 0n);
    expect(research?.stats.totalPaid).toBe(paidByResearch.toString());
    expect(research?.allowance?.pulledInPeriod).toBe(paidByResearch.toString());
    expect(requests.items.every((r) => r.status === "pending")).toBe(true);
  });
});

describe("policy test vectors", () => {
  const vectors = PolicyTestVectorsSchema.parse(load("test-vectors/policy.json"));

  it("cover every denial reason", () => {
    const covered = new Set(
      vectors.cases.flatMap((c) => (c.expect.outcome === "denied" ? [c.expect.reason] : [])),
    );
    for (const reason of DENIAL_REASON_NAMES) expect(covered).toContain(reason);
  });

  it.each(vectors.cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const result = evaluate(testCase);
    const { expect: expected } = testCase;
    if (expected.outcome === "allowed") {
      expect(result.expect.outcome).toBe("allowed");
      if (expected.effects) expect(result.effects).toMatchObject(expected.effects);
    } else {
      expect(result.expect).toEqual(expected);
    }
  });
});
