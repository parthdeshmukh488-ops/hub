"use client";

import { useOwnerWallet } from "../wallet/wallet-provider.tsx";
import { getDataSource } from "./index.ts";
import { DEMO_OWNER } from "./owner.ts";

/**
 * Whose agents the screens show. Live: the connected wallet's, or the demo storyline's owner
 * (whom the indexer's replay serves) until a wallet connects. Sample data: always the storyline.
 */
export function useViewerOwner(): string {
  const { account } = useOwnerWallet();
  return getDataSource().kind === "indexer" && account ? account.address : DEMO_OWNER;
}

/** Why the owner cannot act right now, or null when the wallet can sign. */
export function useWriteBlocker(): string | null {
  const { account, signer } = useOwnerWallet();
  if (getDataSource().kind === "fixtures") return "Sample data is read-only";
  if (!account) return "Connect your wallet to make changes";
  if (!signer) return "This wallet cannot sign Solana transactions";
  return null;
}
