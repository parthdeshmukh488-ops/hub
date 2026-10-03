import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROGRAM_IDS } from "@leash/contracts";
import { startTestIndexer } from "@leash/indexer/testing";
import { LeashAgent } from "@leash/sdk";
import { createTestbed, USDC } from "@leash/sdk/testing";
import { startLiteSvmRpc } from "./litesvm-rpc.ts";
import { LIVE_PORTS } from "./ports.ts";

// The whole owner side on one machine, without a validator: the LiteSVM testbed (the real
// leash.so and subscriptions.so) behind a JSON-RPC endpoint, the real indexer in chain mode on it,
// and the web app in live mode pointed at both. Playwright starts this as its web server.
//
//   pnpm --filter @leash/web exec tsx e2e/live-stack.ts
//
// The testbed's owner is the deterministic test key "owner"; the fake wallet signs with it.

const now = BigInt(Math.floor(Date.now() / 1000));
const bed = await createTestbed({ now });

// One request waiting for the owner: 2 USDC, above the agent's 1 USDC instant limit.
await new LeashAgent({
  chain: bed.chain,
  signer: bed.keys.agentKey,
  owner: bed.keys.owner.address,
  logger: { warn: () => undefined },
}).requestApproval({
  to: bed.keys.merchant.address,
  amount: 2n * USDC,
  purpose: "premium e-bike comparison report",
});

const appOrigin = `http://localhost:${LIVE_PORTS.app}`;
const indexer = await startTestIndexer({
  source: { kind: "chain", chain: bed.chain, programId: PROGRAM_IDS.leash },
  now: () => Number(bed.now()),
  webOrigin: appOrigin,
});
const rpc = await startLiteSvmRpc(bed.chain, {
  port: LIVE_PORTS.rpc,
  onConfirmed: async () => {
    await indexer.sync();
  },
});

const webDir = fileURLToPath(new URL("..", import.meta.url));
const next = spawn("pnpm", ["exec", "next", "dev", "--port", String(LIVE_PORTS.app)], {
  cwd: webDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_DATA_SOURCE: "indexer",
    NEXT_PUBLIC_LEASH_CLUSTER: "localnet",
    NEXT_PUBLIC_RPC_URL: rpc.url,
    NEXT_PUBLIC_INDEXER_URL: indexer.url,
    NEXT_PUBLIC_INDEXER_WS_URL: indexer.streamUrl,
    NEXT_PUBLIC_APP_URL: appOrigin,
  },
});
console.log(
  `live stack: owner ${bed.keys.owner.address}, agent ${bed.accounts.agent}, rpc ${rpc.url}, indexer ${indexer.url}`,
);

const stop = async () => {
  next.kill("SIGTERM");
  await rpc.close();
  await indexer.close();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
next.once("exit", (code) => process.exit(code ?? 1));
