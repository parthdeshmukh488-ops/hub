import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { resolveClusterConfig } from "@leash/contracts";
import { rpcChain } from "@leash/sdk";
import { createSolanaRpc } from "@solana/kit";
import { openDatabase } from "./db/client.ts";
import { loadEnv } from "./env.ts";
import { createLogger } from "./logger.ts";
import { createPipeline } from "./pipeline.ts";
import { createApp } from "./server.ts";
import { createChainSource } from "./sources/chain.ts";
import { createFixtureSource } from "./sources/fixtures.ts";
import type { EventSource } from "./sources/source.ts";
import { Store } from "./store.ts";
import { loadStoryline } from "./storyline.ts";
import { StreamHub } from "./stream.ts";

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL, env.LEASH_CLUSTER);
  const config = resolveClusterConfig(env.LEASH_CLUSTER, {
    rpcUrl: env.LEASH_RPC_URL,
    leashProgramId: env.LEASH_PROGRAM_ID,
  });
  const database = await openDatabase(env.INDEXER_DB_URL);
  const chainMode = env.INDEXER_SOURCE === "chain";
  const store = new Store(database.db, log, { delegationsFromEvents: !chainMode });
  await store.claim(env.INDEXER_SOURCE);

  const now = () => Math.floor(Date.now() / 1000);
  const hub = new StreamHub({ cluster: env.LEASH_CLUSTER, now, log, webOrigin: env.WEB_ORIGIN });
  const source: EventSource = chainMode
    ? createChainSource({
        chain: rpcChain({ rpc: createSolanaRpc(config.rpcUrl) }),
        programId: config.programIds.leash,
        cursor: {
          load: () => store.cursor("chain"),
          save: (cursor) => store.saveCursor("chain", cursor),
        },
        knownAgents: () => store.knownAgents(),
        pollIntervalMs: env.INDEXER_POLL_INTERVAL_MS,
        backfillLimit: env.INDEXER_BACKFILL_LIMIT,
        now,
        onError: (err) => log.warn({ err }, "chain poll failed; retrying at the next interval"),
        onGap: (before) => log.warn({ before }, "more new transactions than one poll reads"),
        onSnapshot: (counts) =>
          log.info(counts, "account snapshot: the projections equal the chain"),
        onForeignCursor: async (cursor) => {
          log.warn(
            { cursor: cursor.signature, slot: cursor.slot },
            "the RPC has not known the last transaction this database stored for three polls in a row: it belongs to another chain (a restarted localnet?). Starting over from an empty database.",
          );
          await store.startOver("chain");
        },
      })
    : createFixtureSource(loadStoryline(), {
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
    chainMode
      ? {
          port: env.INDEXER_PORT,
          source: "chain",
          cluster: env.LEASH_CLUSTER,
          program: config.programIds.leash,
          pollIntervalMs: env.INDEXER_POLL_INTERVAL_MS,
        }
      : {
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
