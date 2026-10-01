import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORTS, resolveClusterConfig } from "@leash/contracts";
import { rpcChain } from "@leash/sdk";
import { createSolanaRpc } from "@solana/kit";
import {
  keypairPathFromRepoRoot,
  loadKeypairSigner,
  parseCliArgs,
  resolveGuardian,
} from "./args.ts";
import { parseConfig } from "./config.ts";
import { loadEnv } from "./env.ts";
import { createGuardian } from "./guardian.ts";
import { createHealthServer } from "./health.ts";
import { createIndexerClient } from "./indexer-client.ts";
import { createLogger } from "./logger.ts";
import { selectNotifiers } from "./notifiers/select.ts";
import { Sentinel } from "./sentinel.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function main(): Promise<void> {
  const env = loadEnv();
  const args = parseCliArgs(process.argv.slice(2));
  const log = createLogger(env.LOG_LEVEL, env.LEASH_CLUSTER);
  const keypairPath =
    env.SENTINEL_GUARDIAN_KEYPAIR &&
    keypairPathFromRepoRoot(env.SENTINEL_GUARDIAN_KEYPAIR, REPO_ROOT);
  const guardian = await resolveGuardian(args.guardian, keypairPath);
  const configPath = args.config ?? new URL("../sentinel.config.json", import.meta.url);
  const config = parseConfig(JSON.parse(readFileSync(configPath, "utf8")));

  if (env.SENTINEL_AUTOFREEZE && !env.SENTINEL_GUARDIAN_KEYPAIR) {
    throw new Error(
      "SENTINEL_AUTOFREEZE=true needs SENTINEL_GUARDIAN_KEYPAIR: --guardian alone is watch-only.",
    );
  }
  const signer = keypairPath ? await loadKeypairSigner(keypairPath) : null;
  const cluster = resolveClusterConfig(env.LEASH_CLUSTER, { rpcUrl: env.LEASH_RPC_URL });
  const guardianFreezes = createGuardian({
    chain: rpcChain({ rpc: createSolanaRpc(cluster.rpcUrl) }),
    signer,
    autofreeze: env.SENTINEL_AUTOFREEZE,
    webUrl: env.SENTINEL_WEB_URL,
    log,
  });
  log.info(
    { autofreeze: env.SENTINEL_AUTOFREEZE && signer !== null, rpc: cluster.rpcUrl },
    env.SENTINEL_AUTOFREEZE
      ? "autofreeze on: guardian freezes allowed"
      : "autofreeze off: alerts only",
  );
  const notifiers = selectNotifiers(env);
  log.info({ notifiers: notifiers.map((n) => n.name) }, "alerts go to");

  const sentinel = new Sentinel({
    indexer: createIndexerClient(env.SENTINEL_INDEXER_URL),
    guardian,
    notifiers,
    config,
    webUrl: env.SENTINEL_WEB_URL,
    log,
    onActions: (actions, alerts) => guardianFreezes.act(actions, alerts),
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
