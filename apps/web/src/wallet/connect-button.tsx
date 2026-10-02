"use client";

import {
  type UiWallet,
  type UiWalletAccount,
  useConnect,
  useDisconnect,
} from "@wallet-standard/react";
import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Address } from "../components/address.tsx";
import { env } from "../env.ts";
import { useOwnerWallet } from "./wallet-provider.tsx";

/** The header's wallet control: Connect (with a wallet picker), or the address, copy, disconnect. */
export function ConnectButton() {
  const { account, wallets, select, onAppChain } = useOwnerWallet();
  if (account) {
    const wallet = wallets.find((w) => w.accounts.some((a) => a.address === account.address));
    return (
      <div className="flex items-center gap-1.5">
        {!onAppChain && <ClusterWarning account={account} />}
        <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
          {wallet && (
            // biome-ignore lint/performance/noImgElement: a wallet's own data: URI icon
            <img src={wallet.icon} alt="" className="size-4 rounded" />
          )}
          <span className="sr-only">Connected wallet</span>
          <Address address={account.address} />
        </span>
        {wallet && <DisconnectButton wallet={wallet} onDone={() => select(undefined)} />}
      </div>
    );
  }
  return <WalletPicker wallets={wallets} onConnected={select} />;
}

function ClusterWarning({ account }: { account: UiWalletAccount }) {
  const cluster = env.NEXT_PUBLIC_LEASH_CLUSTER;
  const listed = account.chains.filter((c) => c.startsWith("solana:")).map((c) => c.slice(7));
  return (
    <span
      role="status"
      title={`This app runs on ${cluster}. Your wallet lists ${listed.join(", ") || "no Solana cluster"}: switch it to ${cluster} so what it shows matches. The app sends every transaction to ${cluster} itself.`}
      className="flex items-center gap-1 rounded-full bg-approval-soft px-2 py-1 text-xs font-medium text-approval"
    >
      <AlertTriangle aria-hidden="true" className="size-3.5" />
      Wallet not on {cluster}
    </span>
  );
}

function DisconnectButton({ wallet, onDone }: { wallet: UiWallet; onDone: () => void }) {
  const [busy, disconnect] = useDisconnect(wallet);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        try {
          await disconnect();
        } finally {
          onDone();
        }
      }}
      aria-label="Disconnect wallet"
      title="Disconnect wallet"
      className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg"
    >
      <LogOut aria-hidden="true" className="size-4" />
    </button>
  );
}

function WalletPicker({
  wallets,
  onConnected,
}: {
  wallets: readonly UiWallet[];
  onConnected: (account: UiWalletAccount) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-canvas hover:opacity-90"
      >
        <Wallet aria-hidden="true" className="size-4" />
        Connect wallet
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-xl border border-line bg-canvas p-3 shadow-lg">
          <p className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
            Choose your wallet
          </p>
          {wallets.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No Solana wallet found in this browser. Install one such as Phantom, Solflare or
              Backpack, then reload.
            </p>
          ) : (
            <ul className="space-y-1">
              {wallets.map((wallet) => (
                <li key={wallet.name}>
                  <WalletOption
                    wallet={wallet}
                    onConnected={(account) => {
                      setOpen(false);
                      onConnected(account);
                    }}
                    onError={setError}
                  />
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-sm text-blocked">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WalletOption({
  wallet,
  onConnected,
  onError,
}: {
  wallet: UiWallet;
  onConnected: (account: UiWalletAccount) => void;
  onError: (message: string) => void;
}) {
  const [connecting, connect] = useConnect(wallet);
  return (
    <button
      type="button"
      disabled={connecting}
      onClick={async () => {
        try {
          const accounts = await connect();
          const [first] = accounts.length > 0 ? accounts : wallet.accounts;
          if (first) onConnected(first);
          else onError(`${wallet.name} shared no account.`);
        } catch {
          onError(`${wallet.name} did not connect. Nothing was shared.`);
        }
      }}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface disabled:opacity-60"
    >
      {/* biome-ignore lint/performance/noImgElement: a wallet's own data: URI icon */}
      <img src={wallet.icon} alt="" className="size-5 rounded" />
      <span className="font-medium">{wallet.name}</span>
      {connecting && <span className="ml-auto text-xs text-fg-muted">Connecting…</span>}
    </button>
  );
}
