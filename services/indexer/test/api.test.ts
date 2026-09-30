import {
  ApiErrorResponseSchema,
  EventsPageResponseSchema,
  GuardianOwnersResponseSchema,
  HealthResponseSchema,
  OwnerOverviewResponseSchema,
  RequestsResponseSchema,
} from "@leash/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, replayedApp, storyline } from "./helpers.ts";

let api: Awaited<ReturnType<typeof replayedApp>>;
beforeAll(async () => {
  api = await replayedApp();
});
afterAll(() => api.close());

const owner = key("owner");
const events = (query: string) => api.get(`/v1/owners/${owner}/events?${query}`);
const page = async (query: string) => EventsPageResponseSchema.parse((await events(query)).body);

async function expectError(path: string, status: number, code: string) {
  const response = await api.get(path);
  expect(response.status).toBe(status);
  expect(ApiErrorResponseSchema.parse(response.body).error.code).toBe(code);
}

describe("events paging (02-contracts §7.1)", () => {
  const newestFirst = [...storyline.events].reverse();

  it("pages backwards with before, and says when there is more", async () => {
    const first = await page("limit=5");
    expect(first.items.map((e) => e.id)).toEqual(newestFirst.slice(0, 5).map((e) => e.id));
    expect(first.nextBefore).toBe(first.items.at(-1)?.id);
    const second = await page(`limit=5&before=${first.nextBefore}`);
    expect(second.items.map((e) => e.id)).toEqual(newestFirst.slice(5, 10).map((e) => e.id));
    const last = await page(`limit=200&before=${newestFirst[9]?.id}`);
    expect(last.items).toHaveLength(storyline.events.length - 10);
    expect(last.nextBefore).toBeNull();
  });

  it("fills a gap with after, oldest first", async () => {
    const cursor = storyline.events[14]?.id;
    const gap = await page(`after=${cursor}`);
    expect(gap.items).toEqual(storyline.events.slice(15));
    expect(gap.nextBefore).toBeNull();
  });

  it("filters by type and agent", async () => {
    const denied = await page("types=PaymentDenied,AgentFrozen");
    expect(denied.items.map((e) => e.type)).toEqual([
      "AgentFrozen",
      "PaymentDenied",
      "PaymentDenied",
      "PaymentDenied",
    ]);
    const market = key("marketAgent");
    const byAgent = EventsPageResponseSchema.parse(
      (await api.get(`/v1/agents/${market}/events`)).body,
    );
    expect(byAgent.items.length).toBeGreaterThan(0);
    expect(byAgent.items.every((e) => e.agent === market)).toBe(true);
    const viaOwner = await page(`agent=${market}`);
    expect(viaOwner.items).toEqual(byAgent.items);
  });

  it("rejects bad queries and unknown cursors", async () => {
    const id = storyline.events[0]?.id;
    await expectError(`/v1/owners/${owner}/events?before=${id}&after=${id}`, 400, "BAD_REQUEST");
    await expectError(`/v1/owners/${owner}/events?types=PaymentStolen`, 400, "BAD_REQUEST");
    await expectError(`/v1/owners/${owner}/events?limit=500`, 400, "BAD_REQUEST");
    const unknown = `${"1".repeat(64)}:0`;
    await expectError(`/v1/owners/${owner}/events?after=${unknown}`, 404, "NOT_FOUND");
  });
});

describe("other routes", () => {
  it("serves an empty overview for an owner without a principal", async () => {
    const { status, body } = await api.get(`/v1/owners/${key("attacker")}`);
    expect(status).toBe(200);
    expect(OwnerOverviewResponseSchema.parse(body)).toEqual({ principal: null, agents: [] });
  });

  it("filters requests by status", async () => {
    const pending = RequestsResponseSchema.parse(
      (await api.get(`/v1/owners/${owner}/requests?status=pending`)).body,
    );
    expect(pending.items).toHaveLength(1);
    const approved = RequestsResponseSchema.parse(
      (await api.get(`/v1/owners/${owner}/requests?status=approved`)).body,
    );
    expect(approved.items).toEqual([]);
  });

  it("lists the owners a guardian protects", async () => {
    const { body } = await api.get(`/v1/guardians/${key("guardian")}/owners`);
    expect(GuardianOwnersResponseSchema.parse(body)).toEqual({ owners: [owner] });
  });

  it("reports health honestly", async () => {
    const { status, body } = await api.get("/v1/health");
    expect(status).toBe(200);
    const last = storyline.events.at(-1);
    expect(HealthResponseSchema.parse(body)).toEqual({
      ok: true,
      cluster: "devnet",
      programId: "5ZDkdhcRtUrWLpK4vMx3C3r1w8iZyVaXvXzC5kvtQpM5",
      lastProcessedSlot: last?.slot,
      lastEventAt: last?.timestamp,
      lagSeconds: 0,
    });
  });

  it("answers errors in the contract's shape", async () => {
    await expectError(`/v1/agents/${key("attacker")}`, 404, "NOT_FOUND");
    await expectError("/v1/agents/not-an-address", 400, "BAD_REQUEST");
    await expectError(`/v1/owners/${owner}/stats?window=1y`, 400, "BAD_REQUEST");
    await expectError("/v1/nothing-here", 404, "NOT_FOUND");
  });

  it("allows the web origin (CORS) and nothing that writes", async () => {
    const response = await api.app.request("/v1/health", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const post = await api.app.request(`/v1/owners/${owner}`, { method: "POST" });
    expect(post.status).toBe(404);
  });
});
