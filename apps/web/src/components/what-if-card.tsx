"use client";

import { AddressSchema, parseUsdc } from "@leash/contracts";
import { useId, useState } from "react";
import type { AgentDetail } from "../data/source.ts";
import { whatIf } from "../lib/what-if.ts";
import { Card } from "./card.tsx";
import { cn } from "./cn.ts";
import { StatusBadge, toneClasses } from "./tone.tsx";

const OTHER = "other";

/** "What if the agent paid…?", answered by the SDK's copy of the program's rules. */
export function WhatIfCard({ detail, now }: { detail: AgentDetail; now: number }) {
  const ids = { payee: useId(), address: useId(), amount: useId() };
  const [choice, setChoice] = useState(detail.payees[0]?.payee ?? OTHER);
  const [address, setAddress] = useState("");
  const [amountText, setAmountText] = useState("0.50");

  const destination = choice === OTHER ? address.trim() : choice;
  const addressOk = AddressSchema.safeParse(destination).success;
  let amount: bigint | null = null;
  try {
    amount = parseUsdc(amountText.trim());
  } catch {
    amount = null;
  }
  const payee = detail.payees.find((row) => row.payee === destination) ?? null;
  const outcome =
    addressOk && amount !== null && amount > 0n
      ? whatIf({
          agent: detail.agent,
          principalFrozen: detail.principalFrozen,
          payee,
          destination,
          amount,
          now,
        })
      : null;

  const field = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm";
  return (
    <Card id="what-if" title="What would happen if…">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-1">
          <label htmlFor={ids.payee} className="text-xs text-fg-muted">
            The agent pays
          </label>
          <select
            id={ids.payee}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className={field}
          >
            {detail.payees.map((row) => (
              <option key={row.payee} value={row.payee}>
                {row.label}
              </option>
            ))}
            <option value={OTHER}>Someone else (paste an address)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.amount} className="text-xs text-fg-muted">
            Amount (USDC)
          </label>
          <input
            id={ids.amount}
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className={cn(field, "font-mono")}
          />
        </div>
        {choice === OTHER && (
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={ids.address} className="text-xs text-fg-muted">
              Wallet address
            </label>
            <input
              id={ids.address}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Base58 address"
              className={cn(field, "font-mono")}
            />
          </div>
        )}
      </div>
      <div aria-live="polite" className="mt-4">
        {outcome === null ? (
          <p className="text-sm text-fg-muted">
            {amount === null || amount === 0n
              ? "Enter an amount like 1.50."
              : "Enter a valid wallet address."}
          </p>
        ) : (
          <div className={cn("space-y-1 rounded-xl p-3", toneClasses(outcome.tone).soft)}>
            <StatusBadge tone={outcome.tone} label={outcome.title} />
            <p className="text-sm">{outcome.detail}</p>
          </div>
        )}
        <p className="mt-2 text-xs text-fg-muted">
          Checked with the same rules the Leash program enforces, on the agent's current state.
          Assumes your wallet holds enough USDC.
        </p>
      </div>
    </Card>
  );
}
