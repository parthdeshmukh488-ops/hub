import { resolveClusterConfig } from "@leash/contracts";
import { type LeashChain, rpcChain } from "@leash/sdk";
import { createSolanaRpc } from "@solana/kit";
import { env } from "../../env.ts";
import type { ActionDeps } from "./route-handlers.ts";

// Production dependencies of the Action routes: the cluster's RPC through the SDK. Tests pass
// their own (the LiteSVM testbed's chain) to `actionHandlers` instead.

let chain: LeashChain | null = null;

export function productionDeps(): ActionDeps {
  chain ??= rpcChain({
    rpc: createSolanaRpc(
      resolveClusterConfig(env.NEXT_PUBLIC_LEASH_CLUSTER, { rpcUrl: env.NEXT_PUBLIC_RPC_URL })
        .rpcUrl,
    ),
  });
  return { chain, appUrl: env.NEXT_PUBLIC_APP_URL };
}
