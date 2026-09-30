import { explorerTxUrl, resolveClusterConfig } from "@leash/contracts";
import { env } from "../env.ts";

/**
 * Explorer link for a transaction, only where one exists: live data on devnet. Fixtures and the
 * indexer's replay use made-up signatures, and a localnet link only works on your own machine.
 */
export function explorerLink(
  signature: string,
  source: "fixtures" | "indexer",
): string | undefined {
  if (source !== "indexer" || env.NEXT_PUBLIC_LEASH_CLUSTER !== "devnet") return undefined;
  return explorerTxUrl(
    resolveClusterConfig("devnet", { rpcUrl: env.NEXT_PUBLIC_RPC_URL }),
    signature,
  );
}
