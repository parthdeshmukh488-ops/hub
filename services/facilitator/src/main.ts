import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { resolveClusterConfig } from "@leash/contracts";
import { createLeashFacilitator } from "@leash/x402/facilitator";
import { createKeyPairSignerFromBytes, createSolanaRpc, devnet } from "@solana/kit";
import type { Network } from "@x402/core/types";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { createLogger } from "./logger.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { facilitatorSigner } from "./signer.ts";

// The facilitator service: the official ExactSvmScheme with Leash on the smart-wallet allowlist
// (ADR-0003, 02-contracts §9). Its fee payer pays SOL network fees only.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Below this the fee payer may not afford settlements: warn (03-security T8). */
const LOW_BALANCE_LAMPORTS = 50_000_000n;
const BALANCE_CHECK_INTERVAL_MS = 5 * 60_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL, env.LEASH_CLUSTER);
  const config = resolveClusterConfig(env.LEASH_CLUSTER, {
    rpcUrl: env.LEASH_RPC_URL,
    leashProgramId: env.LEASH_PROGRAM_ID,
  });
  const keyPath = isAbsolute(env.FACILITATOR_FEE_PAYER_KEYPAIR)
    ? env.FACILITATOR_FEE_PAYER_KEYPAIR
    : resolve(REPO_ROOT, env.FACILITATOR_FEE_PAYER_KEYPAIR);
  const keypair = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")) as number[]),
  );
  // One RPC for every network. The devnet brand only types it; localnet speaks the same API.
  const rpc = createSolanaRpc(devnet(config.rpcUrl));
  const facilitator = createLeashFacilitator({
    signer: facilitatorSigner(keypair, rpc, config.x402Network),
    networks: config.x402Network as Network,
    leashProgramId: config.programIds.leash,
  });

  const checkBalance = async () => {
    try {
      const { value } = await rpc.getBalance(keypair.address).send();
      if (value < LOW_BALANCE_LAMPORTS) {
        log.warn({ feePayer: keypair.address, lamports: value.toString() }, "fee payer low on SOL");
      }
    } catch (err) {
      log.warn({ err }, "balance check failed");
    }
  };
  await checkBalance();
  const timer = setInterval(checkBalance, BALANCE_CHECK_INTERVAL_MS);
  timer.unref();

  const app = createApp({
    facilitator,
    log,
    cluster: env.LEASH_CLUSTER,
    feePayer: keypair.address,
    webOrigin: env.WEB_ORIGIN,
    // Above what one agent at the 30-per-minute velocity limit needs (60: verify + settle), with room.
    rateLimiter: createRateLimiter({ limit: 120, windowMs: 60_000 }),
  });
  serve({ fetch: app.fetch, port: env.FACILITATOR_PORT });
  log.info(
    {
      port: env.FACILITATOR_PORT,
      network: config.x402Network,
      feePayer: keypair.address,
      leash: config.programIds.leash,
    },
    "facilitator listening",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
