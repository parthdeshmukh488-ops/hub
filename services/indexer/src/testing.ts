import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { type Cluster, resolveClusterConfig } from "@leash/contracts";
import type { LeashChain } from "@leash/sdk";
import { pino } from "pino";
import { openDatabase } from "./db/client.ts";
import { createPipeline } from "./pipeline.ts";
import { createApp } from "./server.ts";
import { type ChainSource, createChainSource } from "./sources/chain.ts";
import { createFixtureSource } from "./sources/fixtures.ts";
import type { EventSource } from "./sources/source.ts";
import { Store } from "./store.ts";
import { loadStoryline } from "./storyline.ts";
import { StreamHub } from "./stream.ts";

// `@leash/indexer/testing`: the real indexer in process for other packages' tests (Sentinel, the
// e2e suite). The same store, REST API and `/v1/stream` as the service, on a random local port,
// fed by the demo storyline or by a chain such as the LiteSVM testbed's. Production wiring lives
// in main.ts; this file never reads the environment.

export type TestIndexerSource =
  /** The demo storyline (fixture mode). `speed` 0 (the default) delivers it at once. */
  | { kind: "storyline"; speed?: number; originalTimes?: boolean }
  /** Chain mode over `chain`, polled only when the test calls `sync()`: no timers. */
  | { kind: "chain"; chain: LeashChain; programId: string };

export interface TestIndexerOptions {
  /** Default: the storyline at speed 0. */
  source?: TestIndexerSource;
  /** Start delivering now (default) or later with `start()`, e.g. after a client subscribed. */
  startNow?: boolean;
  /** Unix seconds for views and the stream. Over the testbed, pass `() => Number(bed.now())`. */
  now?: () => number;
  /** Default `localnet`. */
  cluster?: Cluster;
  /** The web origin allowed by CORS and the stream (default `http://localhost:3000`). */
  webOrigin?: string;
}

export interface TestIndexer {
  /** `http://127.0.0.1:<port>`: the REST API of 02 §7.1. */
  url: string;
  /** `ws://127.0.0.1:<port>/v1/stream`: the stream of 02 §7.2. */
  streamUrl: string;
  /** The indexer's store, for assertions the API does not cover. */
  store: Store;
  /** Starts delivering (only needed with `startNow: false`). Chain mode: the first poll. */
  start(): Promise<void>;
  /**
   * Chain mode: reads the chain's new transactions now and resolves once their events are
   * stored and streamed. Storyline mode: nothing to do.
   */
  sync(): Promise<{ processed: number }>;
  /**
   * Chain mode: overwrites the projections with every account on-chain, as a start does after its
   * first poll ("accounts give truth"), then polls until nothing new arrived. Storyline mode:
   * nothing to do.
   */
  snapshot(): Promise<void>;
  /** Stops the source, the stream and the server, and deletes the database. */
  close(): Promise<void>;
}

export async function startTestIndexer(options: TestIndexerOptions = {}): Promise<TestIndexer> {
  const source = options.source ?? { kind: "storyline" };
  const cluster = options.cluster ?? "localnet";
  const webOrigin = options.webOrigin ?? "http://localhost:3000";
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const log = pino({ level: "silent" });
  const chainMode = source.kind === "chain";

  const dir = mkdtempSync(join(tmpdir(), "leash-test-indexer-"));
  const database = await openDatabase(`file:${join(dir, "indexer.db")}`);
  const store = new Store(database.db, log, { delegationsFromEvents: !chainMode });
  await store.claim(chainMode ? "chain" : "fixtures");

  const hub = new StreamHub({ cluster, now, log, webOrigin });
  const sink = createPipeline(store, hub, now, log);
  let failure: unknown = null;
  const events: EventSource | ChainSource =
    source.kind === "chain"
      ? createChainSource({
          chain: source.chain,
          programId: source.programId,
          cursor: { load: () => store.cursor("chain"), save: (c) => store.saveCursor("chain", c) },
          knownAgents: () => store.knownAgents(),
          pollIntervalMs: 60_000,
          backfillLimit: 1_000,
          now,
        })
      : createFixtureSource(loadStoryline(), {
          speed: source.speed ?? 0,
          loop: false,
          ...(source.originalTimes !== undefined ? { originalTimes: source.originalTimes } : {}),
          onError: (error) => {
            failure = error;
          },
        });
  const programId =
    source.kind === "chain" ? source.programId : resolveClusterConfig(cluster).programIds.leash;
  const app = createApp({ store, source: events, cluster, programId, webOrigin, now, log });
  const server = createServer(getRequestListener(app.fetch));
  hub.attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  // Polls run one at a time, in the order the test asks for them.
  let polls: Promise<unknown> = Promise.resolve();
  const sync = (): Promise<{ processed: number }> => {
    if (failure) return Promise.reject(failure);
    if (!("pollOnce" in events)) return Promise.resolve({ processed: 0 });
    const poll = polls.then(async () => {
      const result = await events.pollOnce(sink);
      // The first poll of a start (or a start-over) is followed by the account snapshot.
      if (events.needsSnapshot()) await events.snapshot(sink);
      return result;
    });
    polls = poll.catch(() => {});
    return poll;
  };

  let started = false;
  const start = async (): Promise<void> => {
    if (started) return;
    started = true;
    // Chain mode never starts the source's timer loop: the test decides when to read the chain.
    if (chainMode) await sync();
    else await events.start(sink);
  };
  if (options.startNow ?? true) await start();

  return {
    url: `http://127.0.0.1:${port}`,
    streamUrl: `ws://127.0.0.1:${port}/v1/stream`,
    store,
    start,
    sync,
    snapshot() {
      if (!("snapshot" in events)) return Promise.resolve();
      const run = polls.then(() => events.snapshot(sink));
      polls = run.catch(() => {});
      return run;
    },
    async close() {
      await polls;
      if (!chainMode) await events.stop();
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
