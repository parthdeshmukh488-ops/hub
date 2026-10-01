import { readFileSync } from "node:fs";
import { DEFAULT_PORTS } from "@leash/contracts";
import { parseCliArgs, resolveGuardian } from "./args.ts";
import { parseConfig } from "./config.ts";
import { loadEnv } from "./env.ts";
import { createHealthServer } from "./health.ts";
import { createIndexerClient } from "./indexer-client.ts";
import { createLogger } from "./logger.ts";
import { selectNotifiers } from "./notifiers/select.ts";
import { Sentinel } from "./sentinel.ts";

async function main(): Promise<void> {
  const env = loadEnv();
  const args = parseCliArgs(process.argv.slice(2));
  const log = createLogger(env.LOG_LEVEL, env.LEASH_CLUSTER);
  const guardian = await resolveGuardian(args.guardian, env.SENTINEL_GUARDIAN_KEYPAIR);
  const configPath = args.config ?? new URL("../sentinel.config.json", import.meta.url);
  const config = parseConfig(JSON.parse(readFileSync(configPath, "utf8")));

  if (env.SENTINEL_AUTOFREEZE) {
    log.warn("SENTINEL_AUTOFREEZE=true, but guardian freezes are not built yet: alerts only");
  }
  const notifiers = selectNotifiers(env);
  log.info({ notifiers: notifiers.map((n) => n.name) }, "alerts go to");

  const sentinel = new Sentinel({
    indexer: createIndexerClient(env.SENTINEL_INDEXER_URL),
    guardian,
    notifiers,
    config,
    webUrl: env.SENTINEL_WEB_URL,
    log,
  });
  const health = createHealthServer(() => sentinel.status());
  health.listen(DEFAULT_PORTS.sentinel, () =>
    log.info(
      { port: DEFAULT_PORTS.sentinel, guardian, indexer: env.SENTINEL_INDEXER_URL },
      "sentinel up",
    ),
  );
  await sentinel.start();

  const shutdown = async () => {
    log.info("sentinel stopping");
    health.close();
    await sentinel.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  // A readable message, no stack: these are configuration errors the operator can fix.
  process.stderr.write(`sentinel: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
