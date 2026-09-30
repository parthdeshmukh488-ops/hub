import { DemoStorylineSchema } from "@leash/contracts";
import agentDetailJson from "@leash/contracts/fixtures/agent-detail.json";
import storylineJson from "@leash/contracts/fixtures/demo-storyline.json";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import requestsJson from "@leash/contracts/fixtures/requests.json";
import { describe, expect, it } from "vitest";
import { createIndexerSource, IndexerError } from "../src/data/indexer.ts";
import { DEMO_OWNER } from "../src/data/owner.ts";

// The indexer's responses equal the fixtures (its parity test proves it), so a fetch that serves
// the fixtures stands in for it here.

const storyline = DemoStorylineSchema.parse(storylineJson);
const research = storyline.keys.researchAgent ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () =>
  json({ error: { code: "NOT_FOUND", message: "No agent at this address" } }, 404);

function fakeIndexer(): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === `/v1/owners/${DEMO_OWNER}`) return json(overviewJson);
    if (path === `/v1/owners/${DEMO_OWNER}/requests`) return json(requestsJson);
    if (path === `/v1/agents/${research}`) return json(agentDetailJson);
    if (path.startsWith("/v1/agents/")) return notFound();
    if (path === `/v1/owners/${DEMO_OWNER}/events`) {
      const types = url.searchParams.get("types")?.split(",");
      const agent = url.searchParams.get("agent");
      const after = url.searchParams.get("after");
      let items = [...storyline.events].reverse();
      if (after) {
        const index = storyline.events.findIndex((e) => e.id === after);
        if (index < 0) return notFound();
        items = storyline.events.slice(index + 1);
      }
      items = items.filter(
        (e) => (!types || types.includes(e.type)) && (!agent || e.agent === agent),
      );
      return json({ items, nextBefore: null });
    }
    return notFound();
  };
}

describe("indexer data source", () => {
  const source = createIndexerSource("http://indexer:4100/", fakeIndexer());

  it("builds the overview, with labels for agents and payees", async () => {
    const overview = await source.overview(DEMO_OWNER);
    expect(overview.agents).toHaveLength(2);
    expect(overview.recentBlocked).toHaveLength(3);
    expect(overview.names.get(storyline.keys.merchant ?? "")).toBe("Research API");
    expect(overview.names.get(research)).toBe("Research Assistant");
  });

  it("builds an agent's detail, and null for an unknown agent", async () => {
    const detail = await source.agent(DEMO_OWNER, research);
    expect(detail?.agent.label).toBe("Research Assistant");
    expect(detail?.payees[0]?.spentInPeriod).toBe(1_540_000n);
    expect(detail?.events.every((e) => e.agent === research)).toBe(true);
    expect(await source.agent(DEMO_OWNER, storyline.keys.attacker ?? "")).toBeNull();
  });

  it("backfills after an id, and reports a reset history as null", async () => {
    expect(await source.eventsAfter(DEMO_OWNER, storyline.events[16]?.id ?? "")).toEqual(
      storyline.events.slice(17),
    );
    expect(await source.eventsAfter(DEMO_OWNER, `${"1".repeat(64)}:0`)).toBeNull();
    expect(await source.requests(DEMO_OWNER)).toHaveLength(1);
  });

  it("refuses responses that break the contract, and explains failures", async () => {
    const broken = createIndexerSource("http://indexer", async () => json({ principal: "nope" }));
    await expect(broken.overview(DEMO_OWNER)).rejects.toThrow(/Unexpected response/);
    const down = createIndexerSource("http://indexer", async () =>
      Promise.reject(new TypeError("fetch failed")),
    );
    await expect(down.requests(DEMO_OWNER)).rejects.toThrow(
      /Can't reach the indexer at http:\/\/indexer/,
    );
    const failing = createIndexerSource("http://indexer", async () =>
      json({ error: { code: "INTERNAL", message: "Internal error" } }, 500),
    );
    await expect(failing.requests(DEMO_OWNER)).rejects.toBeInstanceOf(IndexerError);
  });
});
