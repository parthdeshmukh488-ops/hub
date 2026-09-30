/**
 * x402 end to end on a real chain (laptop queue item 4), before WS8's merchant takes payments:
 * an in-process merchant (the official @x402/hono middleware via `leashMerchant`) points at the
 * running facilitator service, and the demo agent pays it with `createLeashFetch`.
 *
 *   pnpm --filter @leash/facilitator start          # first, in another terminal
 *   pnpm --filter @leash/x402 x402:smoke [--cluster devnet|localnet] [--rpc <url>] [--facilitator <url>]
 *
 * Checks: a paid request settles through Leash (receipt + explorer link), and a request whose
 * payee is the attacker is blocked and recorded. Needs `pnpm devnet:setup` done on the cluster.
 * Reads flags and .keys/ only, never the environment.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ClusterConfig, explorerTxUrl, resolveClusterConfig } from "@leash/contracts";
import { LeashAgent, PaymentDeniedError, rpcChain } from "@leash/sdk";
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import type { Network } from "@x402/core/types";
import { Hono } from "hono";
import { createLeashFetch } from "../src/index.ts";
import { leashMerchant } from "../src/merchant/index.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
function fail(message: string): never {
  console.error(`
${message}`);
  process.exit(1);
}

const clusterName = flag("--cluster") ?? "devnet";
if (clusterName !== "devnet" && clusterName !== "localnet") fail("--cluster is devnet or localnet");
let cluster: ClusterConfig;
if (clusterName === "localnet") {
  const file = `${ROOT}.localnet.json`;
  if (!existsSync(file)) fail("No .localnet.json: start `pnpm localnet` first.");
  const local = JSON.parse(readFileSync(file, "utf8")) as { rpcUrl: string; usdcMint: string };
  cluster = resolveClusterConfig("localnet", {
    rpcUrl: flag("--rpc") ?? local.rpcUrl,
    usdcMint: local.usdcMint,
  });
} else {
  cluster = resolveClusterConfig("devnet", { rpcUrl: flag("--rpc") });
}
const facilitatorUrl = flag("--facilitator") ?? "http://localhost:4200";
const key = async (name: string) => {
  const path = `${ROOT}.keys/${name}.json`;
  if (!existsSync(path)) fail(`Missing ${path}: run \`pnpm keys\`.`);
  return createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]),
  );
};
const owner = await key("owner-demo");
const agentKey = await key("agent");
const merchant = await key("merchant");
const attacker = await key("attacker");
const usdcMint = cluster.usdcMint ?? fail(`No USDC mint configured for ${cluster.cluster}.`);

const health = await fetch(`${facilitatorUrl}/health`).then(
  (r) => r.json() as Promise<{ ok: boolean; feePayer: string }>,
  () => fail(`The facilitator at ${facilitatorUrl} is not reachable. Start it first.`),
);
console.log(
  `x402 smoke test on ${cluster.cluster}; facilitator ${facilitatorUrl} (fee payer ${health.feePayer})`,
);

const network = cluster.x402Network as Network;
const chain = rpcChain({ rpc: createSolanaRpc(cluster.rpcUrl) });
const agent = new LeashAgent({ chain, signer: agentKey, owner: owner.address });
const merchantFor = (payTo: string) => {
  const app = new Hono();
  app.use(
    leashMerchant({
      payTo,
      facilitator: facilitatorUrl,
      network,
      asset: usdcMint,
      routes: { "GET /api/research": { price: "0.01", description: "Leash x402 smoke test" } },
    }),
  );
  app.get("/api/research", (c) => c.json({ report: "Solana agents with spending limits" }));
  return createLeashFetch({
    agent,
    chain,
    network,
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
};
const get = (leashFetch: ReturnType<typeof merchantFor>) =>
  leashFetch({
    url: "http://merchant.local/api/research",
    method: "GET",
    headers: {},
    body: undefined,
    purpose: "x402 smoke test",
  });

let failures = 0;
const check = (ok: boolean, line: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${line}`);
  if (!ok) failures += 1;
};

const paid = await get(merchantFor(merchant.address));
check(
  paid.status === 200 && paid.payment?.amount === 10_000n,
  `paid 0.01 USDC over x402: ${paid.payment ? explorerTxUrl(cluster, paid.payment.signature) : "no payment"}`,
);

const blocked = await get(merchantFor(attacker.address)).then(
  () => null,
  (error: unknown) => error,
);
check(
  blocked instanceof PaymentDeniedError && blocked.reason === "payeeNotAllowed" && blocked.recorded,
  "a merchant whose payTo is the attacker: blocked and recorded (strike)",
);

if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("\nx402 smoke test passed.");
