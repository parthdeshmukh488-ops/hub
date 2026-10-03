import { type ClusterConfig, explorerTxUrl, resolveClusterConfig } from "@leash/contracts";
import { type LeashChain, rpcChain } from "@leash/sdk";
import { createSolanaRpc } from "@solana/kit";
import { env } from "../../env.ts";

// The browser's way to the chain, for the owner's writes: the cluster's RPC through the SDK. Reads
// for the screens come from the indexer; reads a signature depends on come from here (T13).

let chain: LeashChain | null = null;

export function clusterConfig(): ClusterConfig {
  return resolveClusterConfig(env.NEXT_PUBLIC_LEASH_CLUSTER, { rpcUrl: env.NEXT_PUBLIC_RPC_URL });
}

export function browserChain(): LeashChain {
  chain ??= rpcChain({ rpc: createSolanaRpc(clusterConfig().rpcUrl) });
  return chain;
}

/** Solana Explorer for a transaction the owner just signed (localnet: a custom-RPC link). */
export function signatureUrl(signature: string): string {
  return explorerTxUrl(clusterConfig(), signature);
}
