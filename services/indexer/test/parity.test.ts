import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  AgentDetailResponseSchema,
  EventsPageResponseSchema,
  OwnerOverviewResponseSchema,
  RequestsResponseSchema,
  StatsResponseSchema,
} from "@leash/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, replayedApp, storyline } from "./helpers.ts";

// Replaying the storyline must reproduce every view fixture exactly (ADR 20260930-ws4): the web
// app and Sentinel are built against those files, so the indexer may never drift from them.

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      createRequire(import.meta.url).resolve(`@leash/contracts/fixtures/${name}.json`),
      "utf8",
    ),
  );

let api: Awaited<ReturnType<typeof replayedApp>>;
beforeAll(async () => {
  api = await replayedApp();
});
afterAll(() => api.close());

describe("fixture replay reproduces the contract fixtures", () => {
  const owner = key("owner");

  it("GET /v1/owners/:owner = owner-overview.json", async () => {
    const { status, body } = await api.get(`/v1/owners/${owner}`);
    expect(status).toBe(200);
    expect(OwnerOverviewResponseSchema.parse(body)).toEqual(fixture("owner-overview"));
  });

  it("GET /v1/agents/:agent = agent-detail.json", async () => {
    const { body } = await api.get(`/v1/agents/${key("researchAgent")}`);
    expect(AgentDetailResponseSchema.parse(body)).toEqual(fixture("agent-detail"));
  });

  it("GET /v1/owners/:owner/requests = requests.json", async () => {
    const { body } = await api.get(`/v1/owners/${owner}/requests`);
    expect(RequestsResponseSchema.parse(body)).toEqual(fixture("requests"));
  });

  it("GET /v1/owners/:owner/stats?window=24h = stats-24h.json", async () => {
    const { body } = await api.get(`/v1/owners/${owner}/stats?window=24h`);
    expect(StatsResponseSchema.parse(body)).toEqual(fixture("stats-24h"));
  });

  it("GET /v1/owners/:owner/events returns the whole storyline, newest first", async () => {
    const { body } = await api.get(`/v1/owners/${owner}/events?limit=200`);
    const page = EventsPageResponseSchema.parse(body);
    expect(page.items).toEqual([...storyline.events].reverse());
    expect(page.nextBefore).toBeNull();
  });
});
