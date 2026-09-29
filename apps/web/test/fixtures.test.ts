import { AgentDetailResponseSchema, DemoStorylineSchema } from "@leash/contracts";
import agentDetailJson from "@leash/contracts/fixtures/agent-detail.json";
import storylineJson from "@leash/contracts/fixtures/demo-storyline.json";
import { describe, expect, it } from "vitest";
import { createFixtureSource } from "../src/data/fixtures.ts";
import { payeeRowFromView, payeeRowsFromEvents } from "../src/lib/payees.ts";

const source = createFixtureSource();
const storyline = DemoStorylineSchema.parse(storylineJson);
const detail = AgentDetailResponseSchema.parse(agentDetailJson);
const { researchAgent, marketAgent } = storyline.keys as Record<string, string>;

describe("fixture data source", () => {
  it("serves the overview with blocked attempts newest first", async () => {
    const overview = await source.overview();
    expect(overview.agents.map((agent) => agent.label)).toEqual([
      "Research Assistant",
      "Market Watcher",
    ]);
    expect(overview.recentBlocked).toHaveLength(3);
    const times = overview.recentBlocked.map((event) => event.timestamp);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("uses the snapshot time of the fixtures as its clock", () => {
    expect(source.now()).toBe(1_790_935_620);
  });

  it("serves every agent, and nothing for an unknown address", async () => {
    const research = await source.agent(researchAgent ?? "");
    const market = await source.agent(marketAgent ?? "");
    expect(research?.payees).toEqual(detail.payees.map(payeeRowFromView));
    expect(research?.events.every((event) => event.agent === researchAgent)).toBe(true);
    expect(market?.requests).toHaveLength(1);
    expect(market?.payees).toMatchObject([
      { label: "Research API", paymentsCount: 2, spentInPeriod: 40_000n },
    ]);
    expect(await source.agent("11111111111111111111111111111111")).toBeNull();
  });
});

describe("payeeRowsFromEvents", () => {
  it("rebuilds the research agent's allowlist exactly as the detail fixture has it", () => {
    const rebuilt = payeeRowsFromEvents(researchAgent ?? "", storyline.events, source.now());
    expect(rebuilt).toEqual(detail.payees.map(payeeRowFromView));
  });

  it("empties a payee period that has ended, and drops removed payees", () => {
    const later = source.now() + 86_400 * 2;
    expect(
      payeeRowsFromEvents(researchAgent ?? "", storyline.events, later)[0]?.spentInPeriod,
    ).toBe(0n);
    const removed = [
      ...storyline.events,
      {
        ...storyline.events[0],
        type: "PayeeRemoved" as const,
        agent: researchAgent ?? null,
        payee: detail.payees[0]?.payee ?? "",
        timestamp: source.now(),
      },
    ];
    expect(payeeRowsFromEvents(researchAgent ?? "", removed as never, source.now())).toEqual([]);
  });
});
