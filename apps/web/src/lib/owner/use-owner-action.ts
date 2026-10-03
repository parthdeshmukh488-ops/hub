"use client";

import type { LeashChain } from "@leash/sdk";
import type { TransactionSigner } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { env } from "../../env.ts";
import { queryKeys } from "../../live/apply.ts";
import { useOwnerWallet } from "../../wallet/wallet-provider.tsx";
import { browserChain } from "./chain.ts";
import { describeOwnerError } from "./errors.ts";
import type { OwnerPlan } from "./plans.ts";
import { sendOwnerPlan } from "./send.ts";

// The one flow every owner action runs: summary → wallet signs → pending (signature) →
// confirmed (explorer link) → the views refresh from the indexer stream.

export type OwnerActionState =
  | { phase: "idle" }
  /** Re-reading the accounts from RPC and building the transactions. */
  | { phase: "preparing" }
  /** The summary is on screen; nothing is signed yet. */
  | { phase: "review"; plan: OwnerPlan }
  | { phase: "signing"; plan: OwnerPlan; step: number }
  | { phase: "pending"; plan: OwnerPlan; step: number; signature: string }
  | { phase: "confirmed"; plan: OwnerPlan; signatures: string[] }
  | { phase: "failed"; plan: OwnerPlan | null; message: string };

const cluster = env.NEXT_PUBLIC_LEASH_CLUSTER;

export type PlanContext = { chain: LeashChain; signer: TransactionSigner };

export type OwnerAction = {
  state: OwnerActionState;
  /** Builds the plan (reading the chain) and shows its summary. */
  start: (prepare: (context: PlanContext) => Promise<OwnerPlan>) => void;
  /** Opens the wallet for each step of the plan under review. */
  confirm: () => void;
  /** Closes the dialog (not while the wallet or the chain is busy). */
  close: () => void;
};

export function useOwnerAction(
  options: { owner?: string; onConfirmed?: (plan: OwnerPlan, signatures: string[]) => void } = {},
): OwnerAction {
  const { signer } = useOwnerWallet();
  const client = useQueryClient();
  const [state, setStateValue] = useState<OwnerActionState>({ phase: "idle" });
  const stateRef = useRef(state);
  const setState = useCallback((next: OwnerActionState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);
  // The latest options and signer, without re-creating the callbacks.
  const latest = useRef({ options, signer });
  latest.current = { options, signer };

  const start = useCallback(
    (prepare: (context: PlanContext) => Promise<OwnerPlan>) => {
      const current = latest.current.signer;
      if (!current) {
        setState({
          phase: "failed",
          plan: null,
          message: "Connect your wallet first. Nothing was sent.",
        });
        return;
      }
      setState({ phase: "preparing" });
      prepare({ chain: browserChain(), signer: current }).then(
        (plan) => setState({ phase: "review", plan }),
        (error: unknown) =>
          setState({ phase: "failed", plan: null, message: describeOwnerError(error, cluster) }),
      );
    },
    [setState],
  );

  const confirm = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== "review") return;
    const { plan } = current;
    const wallet = latest.current.signer;
    if (!wallet) {
      setState({ phase: "failed", plan, message: "Your wallet disconnected. Nothing was sent." });
      return;
    }
    setState({ phase: "signing", plan, step: 0 });
    sendOwnerPlan(browserChain(), wallet, plan, (progress) => {
      if (progress.phase === "signing") setState({ phase: "signing", plan, step: progress.step });
      if (progress.phase === "pending") {
        setState({ phase: "pending", plan, step: progress.step, signature: progress.signature });
      }
    }).then(
      (signatures) => {
        setState({ phase: "confirmed", plan, signatures });
        const owner = latest.current.options.owner;
        // The stream updates the views; this reload covers a stream that is down or behind.
        if (owner) {
          const refresh = () => client.invalidateQueries({ queryKey: queryKeys.owner(owner) });
          void refresh();
          setTimeout(() => void refresh(), 3_000);
        }
        latest.current.options.onConfirmed?.(plan, signatures);
      },
      (error: unknown) =>
        setState({ phase: "failed", plan, message: describeOwnerError(error, cluster) }),
    );
  }, [client, setState]);

  const close = useCallback(() => {
    const { phase } = stateRef.current;
    if (phase !== "signing" && phase !== "pending") setState({ phase: "idle" });
  }, [setState]);

  return { state, start, confirm, close };
}
