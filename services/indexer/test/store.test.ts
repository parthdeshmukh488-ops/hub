import { describe, expect, it } from "vitest";
import { createPipeline } from "../src/pipeline.ts";
import { createFixtureSource } from "../src/sources/fixtures.ts";
import { AS_OF, key, log, storyline, testStore } from "./helpers.ts";

describe("store", () => {
  it("inserts each event once, however often it is delivered", async () => {
    const { store, close } = await testStore();
    await store.claim("fixtures");
    const first = await store.ingest(storyline.events);
    const again = await store.ingest(storyline.events);
    expect(first.inserted).toHaveLength(storyline.events.length);
    expect(again).toEqual({ inserted: [], changedAgents: [] });
    close();
  });

  it("gives fixture mode a fresh database and refuses one holding chain data", async () => {
    const { store, close } = await testStore();
    await store.claim("fixtures");
    const source = createFixtureSource(storyline, { speed: 0, loop: false, originalTimes: true });
    await source.start(createPipeline(store, null, () => AS_OF, log));
    expect((await store.ownerOverview(key("owner"), AS_OF)).agents).toHaveLength(2);
    await store.claim("fixtures");
    expect(await store.ownerOverview(key("owner"), AS_OF)).toEqual({ principal: null, agents: [] });
    await expect(store.claim("chain")).rejects.toThrow(/holds fixtures data/);
    close();
  });

  it("starts a loop from empty projections but keeps the history", async () => {
    const { store, close } = await testStore();
    await store.claim("fixtures");
    await store.ingest(storyline.events);
    await store.resetProjections();
    expect((await store.ownerOverview(key("owner"), AS_OF)).principal).toBeNull();
    expect((await store.progress()).lastEventAt).toBe(storyline.events.at(-1)?.timestamp);
    close();
  });
});
