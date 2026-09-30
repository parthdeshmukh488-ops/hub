import { AgentDetailResponseSchema, DemoStorylineSchema } from "@leash/contracts";
import agentDetailJson from "@leash/contracts/fixtures/agent-detail.json";
import storylineJson from "@leash/contracts/fixtures/demo-storyline.json";
import { describe, expect, it } from "vitest";
import { createFixtureSource } from "../src/data/fixtures.ts";
import { DEMO_OWNER } from "../src/data/owner.ts";
import { payeeRowFromView, payeeRowsFromEvents } from "../src/lib/payees.ts";

const source = createFixtureSource();
const storyline = DemoStorylineSchema.parse(storylineJson);
const detail = AgentDetailResponseSchema.parse(agentDetailJson);
const {
  researchAgent = "",
  marketAgent = "",
  attacker = "",
} = storyline.keys as Record<string, string>;

describe("fixture data source", () => {
  it("serves the demo owner's overview with blocked attempts newest first", async () => {
    const overview = await source.overview(DEMO_OWNER);
    expect(overview.agents.map((agent) => agent.label)).toEqual([
      "Research Assistant",
      "Market Watcher",
    ]);
    expect(overview.recentBlocked).toHaveLength(3);
    const times = overview.recentBlocked.map((event) => event.timestamp);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect((await source.overview(attacker)).principal).toBeNull();
  });

  it("uses the snapshot time of the fixtures as its clock", () => {
    expect(source.now()).toBe(1_790_935_620);
  });

  it("serves every agent, and nothing for an unknown address", async () => {
    const research = await source.agent(DEMO_OWNER, researchAgent);
    const market = await source.agent(DEMO_OWNER, marketAgent);
    expect(research?.payees).toEqual(detail.payees.map(payeeRowFromView));
    expect(research?.events.every((event) => event.agent === researchAgent)).toBe(true);
    expect(market?.requests).toHaveLength(1);
    expect(market?.payees).toMatchObject([
      { label: "Research API", paymentsCount: 2, spentInPeriod: 40_000n },
    ]);
    expect(await source.agent(DEMO_OWNER, "11111111111111111111111111111111")).toBeNull();
  });

  it("pages events like the indexer, and backfills after an id", async () => {
    const first = await source.events(DEMO_OWNER, { limit: 5 });
    expect(first.items).toHaveLength(5);
    const second = await source.events(DEMO_OWNER, { limit: 50, before: first.nextBefore ?? "" });
    expect([...first.items, ...second.items]).toEqual([...storyline.events].reverse());
    expect(second.nextBefore).toBeNull();
    const denied = await source.events(DEMO_OWNER, { types: ["PaymentDenied"] });
    expect(denied.items.every((event) => event.type === "PaymentDenied")).toBe(true);
    const after = await source.eventsAfter(DEMO_OWNER, storyline.events[15]?.id ?? "");
    expect(after).toEqual(storyline.events.slice(16));
    expect(await source.eventsAfter(DEMO_OWNER, "unknown")).toBeNull();
  });
});

describe("payeeRowsFromEvents", () => {
  it("rebuilds the research agent's allowlist exactly as the detail fixture has it", () => {
    expect(payeeRowsFromEvents(researchAgent, storyline.events, source.now())).toEqual(
      detail.payees.map(payeeRowFromView),
    );
  });
});
