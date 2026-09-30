import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DemoStoryline } from "@leash/contracts";
import { pino } from "pino";
import { openDatabase } from "../src/db/client.ts";
import { createPipeline } from "../src/pipeline.ts";
import { createApp } from "../src/server.ts";
import { createFixtureSource } from "../src/sources/fixtures.ts";
import { Store } from "../src/store.ts";
import { loadStoryline } from "../src/storyline.ts";
import type { StreamHub } from "../src/stream.ts";

export const log = pino({ level: "silent" });
export const storyline: DemoStoryline = loadStoryline();
/** The fixtures' snapshot time (`asOf` of every allowance view). */
export const AS_OF = 1_790_935_620;
export const keys = storyline.keys as Record<string, string>;

export function key(name: string): string {
  const value = keys[name];
  if (!value) throw new Error(`no storyline key ${name}`);
  return value;
}

/** A fresh database in a temporary file. */
export async function testStore() {
  const dir = mkdtempSync(join(tmpdir(), "leash-indexer-"));
  const database = await openDatabase(`file:${join(dir, "test.db")}`);
  return { store: new Store(database.db, log), close: database.close };
}

/** A store holding the whole storyline with its original times, and the API on top of it. */
export async function replayedApp(now = AS_OF, hub: StreamHub | null = null) {
  const { store, close } = await testStore();
  await store.claim("fixtures");
  const source = createFixtureSource(storyline, { speed: 0, loop: false, originalTimes: true });
  await source.start(createPipeline(store, hub, () => now, log));
  const app = createApp({
    store,
    source,
    cluster: "devnet",
    programId: "5ZDkdhcRtUrWLpK4vMx3C3r1w8iZyVaXvXzC5kvtQpM5",
    webOrigin: "http://localhost:3000",
    now: () => now,
    log,
  });
  const get = async (path: string) => {
    const response = await app.request(path);
    return {
      status: response.status,
      body: (await response.json()) as unknown,
      headers: response.headers,
    };
  };
  return { store, app, get, close };
}
