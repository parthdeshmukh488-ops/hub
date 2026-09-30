import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { resolveClusterConfig } from "@leash/contracts";
import { openDatabase } from "./db/client.ts";
import { loadEnv } from "./env.ts";
import { createLogger } from "./logger.ts";
import { createPipeline } from "./pipeline.ts";
import { createApp } from "./server.ts";
import { createFixtureSource } from "./sources/fixtures.ts";
import { Store } from "./store.ts";
import { loadStoryline } from "./storyline.ts";
import { StreamHub } from "./stream.ts";

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL, env.LEASH_CLUSTER);
  if (env.INDEXER_SOURCE === "chain") {
    throw new Error("Chain mode arrives in WS4 build step 2. Set INDEXER_SOURCE=fixtures for now.");
  }
  const config = resolveClusterConfig(env.LEASH_CLUSTER, { leashProgramId: env.LEASH_PROGRAM_ID });
  const database = await openDatabase(env.INDEXER_DB_URL);
  const store = new Store(database.db, log);
  await store.claim("fixtures");

  const now = () => Math.floor(Date.now() / 1000);
  const hub = new StreamHub({ cluster: env.LEASH_CLUSTER, now, log, webOrigin: env.WEB_ORIGIN });
  const source = createFixtureSource(loadStoryline(), {
    speed: env.INDEXER_REPLAY_SPEED,
    loop: env.INDEXER_REPLAY_LOOP,
    onError: (err) => {
      log.fatal({ err }, "fixture replay failed");
      void shutdown(1);
    },
  });
  const app = createApp({
    store,
    source,
    cluster: env.LEASH_CLUSTER,
    programId: config.programIds.leash,
    webOrigin: env.WEB_ORIGIN,
    now,
    log,
  });
  const server = createServer(getRequestListener(app.fetch));
  hub.attach(server);
  await new Promise<void>((resolve) => server.listen(env.INDEXER_PORT, resolve));
  log.info(
    {
      port: env.INDEXER_PORT,
      source: "fixtures",
      speed: env.INDEXER_REPLAY_SPEED,
      loop: env.INDEXER_REPLAY_LOOP,
    },
    "indexer listening",
  );

  let stopping = false;
  async function shutdown(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    log.info("shutting down");
    await source.stop();
    await hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    process.exit(code);
  }
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  await source.start(createPipeline(store, hub, now, log));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
