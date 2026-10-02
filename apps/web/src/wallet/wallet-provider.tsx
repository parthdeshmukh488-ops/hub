"use client";

import type { TransactionSigner } from "@solana/kit";
import {
  SelectedWalletAccountContextProvider,
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import { getUiWalletAccountStorageKey, getWalletFeature } from "@wallet-standard/react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { env } from "../env.ts";

// The owner's wallet, through Wallet Standard and Kit's own React hooks (`@solana/react`): any
// wallet that registers itself (Phantom, Solflare, Backpack, a test wallet) and can sign Solana
// transactions. The wallet only signs; the app sends through its own RPC (`lib/owner/send.ts`).

/** The Wallet Standard chain of the app's cluster: "solana:devnet" or "solana:localnet". */
export const APP_CHAIN = `solana:${env.NEXT_PUBLIC_LEASH_CLUSTER}` as const;

const SIGN_TRANSACTION = "solana:signTransaction";
const STORAGE_KEY = "leash:wallet";

/** Wallets that can sign Solana transactions. */
export const canSign = (wallet: UiWallet) => wallet.features.includes(SIGN_TRANSACTION);

// Remembers the chosen account across visits. Storage can be unavailable (SSR, private mode).
const stateSync = {
  getSelectedWallet: () => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  storeSelectedWallet: (key: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {}
  },
  deleteSelectedWallet: () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  },
};

export type OwnerWallet = {
  account: UiWalletAccount | undefined;
  /** Signs with the wallet; null while no account is connected. */
  signer: TransactionSigner | null;
  /** False when the wallet does not list the app's cluster (it may simulate on another one). */
  onAppChain: boolean;
  select: (account: UiWalletAccount | undefined) => void;
  wallets: readonly UiWallet[];
};

const SignerContext = createContext<TransactionSigner | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <SelectedWalletAccountContextProvider filterWallets={canSign} stateSync={stateSync}>
      <SilentReconnect />
      <SignerBridge>{children}</SignerBridge>
    </SelectedWalletAccountContextProvider>
  );
}

type StandardConnect = { connect: (input?: { silent?: boolean }) => Promise<unknown> };

/**
 * After a reload, asks the remembered wallet once to reconnect without a prompt (Wallet Standard's
 * `silent` connect). A wallet that no longer trusts the app simply shares nothing.
 */
function SilentReconnect() {
  const [account, , wallets] = useSelectedWalletAccount();
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || account) return;
    const saved = stateSync.getSelectedWallet();
    const name = saved?.split(":")[0];
    const wallet = wallets.find((w) => w.name === name);
    if (!wallet) return;
    tried.current = true;
    if (wallet.accounts.length > 0 || !wallet.features.includes("standard:connect")) return;
    const feature = getWalletFeature(wallet, "standard:connect") as StandardConnect;
    feature.connect({ silent: true }).catch(() => undefined);
  }, [account, wallets]);
  return null;
}

/**
 * Kit's signer hook needs an account, so a child computes the signer and lifts it up: the app
 * itself never remounts when a wallet connects.
 */
function SignerBridge({ children }: { children: ReactNode }) {
  const [account] = useSelectedWalletAccount();
  const [signer, setSigner] = useState<TransactionSigner | null>(null);
  const chain = account ? signingChain(account) : null;
  return (
    <SignerContext.Provider value={account && chain ? signer : null}>
      {account && chain && (
        <SignerProbe
          key={`${getUiWalletAccountStorageKey(account)}|${chain}`}
          account={account}
          chain={chain}
          onSigner={setSigner}
        />
      )}
      {children}
    </SignerContext.Provider>
  );
}

function SignerProbe({
  account,
  chain,
  onSigner,
}: {
  account: UiWalletAccount;
  chain: `solana:${string}`;
  onSigner: (signer: TransactionSigner | null) => void;
}) {
  const signer = useWalletAccountTransactionSigner(account, chain);
  useEffect(() => {
    onSigner(signer);
    return () => onSigner(null);
  }, [signer, onSigner]);
  return null;
}

/**
 * The chain the wallet is told it signs for. Wallets use it only to simulate and display; the app
 * sends to its own cluster. Few wallets list `solana:localnet`, so a wallet without the app's
 * chain signs as for another Solana chain it has, and the header warns.
 */
export function signingChain(account: UiWalletAccount): `solana:${string}` | null {
  if (account.chains.includes(APP_CHAIN)) return APP_CHAIN;
  const solana = account.chains.find((chain) => chain.startsWith("solana:"));
  return (solana as `solana:${string}` | undefined) ?? null;
}

export function useOwnerWallet(): OwnerWallet {
  const [account, select, wallets] = useSelectedWalletAccount();
  const signer = useContext(SignerContext);
  return {
    account,
    signer,
    onAppChain: account ? account.chains.includes(APP_CHAIN) : true,
    select,
    wallets,
  };
}
