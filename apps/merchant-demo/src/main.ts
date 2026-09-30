import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { getRequestListener } from "@hono/node-server";
import { DemoStorylineSchema, resolveClusterConfig } from "@leash/contracts";
import { pino } from "pino";
import { loadContent } from "./content.ts";
import { loadEnv } from "./env.ts";
import { type AppConfig, createApp } from "./server.ts";

/** The storyline's merchant and attacker, so an unconfigured merchant matches the fixtures. */
function demoWallets(): { merchant: string; attacker: string } {
  const path = createRequire(import.meta.url).resolve(
    "@leash/contracts/fixtures/demo-storyline.json",
  );
  const { keys } = DemoStorylineSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const { merchant, attacker } = keys;
  if (!merchant || !attacker)
    throw new Error("The demo storyline lacks the merchant or attacker key");
  return { merchant, attacker };
}

function main(): void {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: "merchant-demo", cluster: env.LEASH_CLUSTER },
  });
  const demo = demoWallets();
  const wallets = {
    merchant: env.MERCHANT_PAY_TO ?? demo.merchant,
    attacker: env.LAB_ATTACKER_WALLET ?? demo.attacker,
  };
  if (!env.MERCHANT_PAY_TO || !env.LAB_ATTACKER_WALLET) {
    log.warn(
      wallets,
      "MERCHANT_PAY_TO or LAB_ATTACKER_WALLET unset: using the demo storyline's addresses",
    );
  }
  const cluster = resolveClusterConfig(env.LEASH_CLUSTER, { usdcMint: env.LEASH_USDC_MINT });
  let x402: AppConfig["x402"];
  if (env.MERCHANT_PAYMENTS === "on") {
    if (!cluster.usdcMint) {
      throw new Error(
        "MERCHANT_PAYMENTS=on on localnet needs LEASH_USDC_MINT (the usdcMint of .localnet.json)",
      );
    }
    x402 = {
      facilitator: env.MERCHANT_FACILITATOR_URL,
      network: cluster.x402Network as NonNullable<AppConfig["x402"]>["network"],
      asset: cluster.usdcMint,
    };
    log.info({ facilitator: env.MERCHANT_FACILITATOR_URL, asset: cluster.usdcMint }, "payments on");
  }
  const app = createApp(
    { wallets, payments: env.MERCHANT_PAYMENTS, ...(x402 ? { x402 } : {}) },
    loadContent(),
  );
  const server = createServer(getRequestListener(app.fetch));
  server.listen(env.MERCHANT_PORT, () => {
    log.info({ port: env.MERCHANT_PORT, payments: env.MERCHANT_PAYMENTS }, "merchant listening");
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
