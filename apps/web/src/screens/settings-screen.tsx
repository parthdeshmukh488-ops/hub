"use client";

import { AddressSchema, PROGRAM_IDS } from "@leash/contracts";
import { useState } from "react";
import { Address } from "../components/address.tsx";
import { Card } from "../components/card.tsx";
import { OwnerActionDialog } from "../components/owner-action-dialog.tsx";
import { ScreenState } from "../components/screen-state.tsx";
import { useOverview } from "../data/hooks.ts";
import { useViewerOwner, useWriteBlocker } from "../data/viewer.ts";
import { env } from "../env.ts";
import { clusterConfig } from "../lib/owner/chain.ts";
import { planSetGuardian } from "../lib/owner/plans.ts";
import { useOwnerAction } from "../lib/owner/use-owner-action.ts";

export function SettingsScreen() {
  const overview = useOverview();
  const action = useOwnerAction({ owner: useViewerOwner() });
  const disabledReason = useWriteBlocker();
  const [guardian, setGuardian] = useState("");
  const [error, setError] = useState<string | null>(null);
  const config = clusterConfig();

  const submit = () => {
    const parsed = AddressSchema.safeParse(guardian.trim());
    if (!parsed.success) {
      setError("Enter the guardian's Solana address.");
      return;
    }
    setError(null);
    action.start(({ chain, signer }) => planSetGuardian(chain, { signer, guardian: parsed.data }));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card id="guardian-heading" title="Guardian">
        <ScreenState query={overview}>
          {() => {
            const principal = overview.data?.principal ?? null;
            if (!principal) {
              return (
                <p className="text-sm text-fg-muted">
                  Pair an agent first: the guardian belongs to your Leash account.
                </p>
              );
            }
            return (
              <div className="space-y-4 text-sm">
                <p className="text-fg-muted">
                  A guardian is a second key, usually Sentinel's, that watches your agents. It can
                  freeze them and reject requests, and nothing else: it can never unfreeze, pay or
                  change a rule.
                </p>
                <p>
                  Current guardian:{" "}
                  {principal.guardian ? (
                    <Address address={principal.guardian} />
                  ) : (
                    <span className="text-fg-muted">none</span>
                  )}
                </p>
                <div className="space-y-1">
                  <label htmlFor="guardian" className="block font-medium">
                    {principal.guardian ? "New guardian address" : "Guardian address"}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="guardian"
                      value={guardian}
                      onChange={(e) => setGuardian(e.target.value)}
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm"
                    />
                    <button
                      type="button"
                      disabled={disabledReason !== null}
                      title={disabledReason ?? undefined}
                      onClick={submit}
                      className="rounded-lg bg-brand px-3 py-2 font-medium text-canvas hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {principal.guardian ? "Change guardian" : "Set guardian"}
                    </button>
                    {principal.guardian && (
                      <button
                        type="button"
                        disabled={disabledReason !== null}
                        title={disabledReason ?? undefined}
                        onClick={() =>
                          action.start(({ chain, signer }) =>
                            planSetGuardian(chain, { signer, guardian: null }),
                          )
                        }
                        className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {error && <p className="text-blocked">{error}</p>}
                  {disabledReason && <p className="text-fg-muted">{disabledReason}.</p>}
                </div>
                <p className="text-fg-muted">
                  The demo's guardian is the <span className="font-mono">guardian</span> key:{" "}
                  <span className="font-mono">pnpm keys</span> prints its address.
                </p>
              </div>
            );
          }}
        </ScreenState>
      </Card>

      <Card id="alerts-heading" title="Telegram alerts">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
          <li>
            Create a bot with @BotFather and put its token in the repo's .env as TELEGRAM_BOT_TOKEN.
          </li>
          <li>Send /start to your bot, then set TELEGRAM_CHAT_ID from the bot's getUpdates.</li>
          <li>Start Sentinel: it alerts you on Telegram, with Freeze and Approve links.</li>
        </ol>
      </Card>

      <Card id="network-heading" title="Network">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-fg-muted">Cluster</dt>
          <dd>{env.NEXT_PUBLIC_LEASH_CLUSTER}</dd>
          <dt className="text-fg-muted">RPC</dt>
          <dd className="break-all font-mono text-xs">{config.rpcUrl}</dd>
          <dt className="text-fg-muted">Leash program</dt>
          <dd>
            <Address address={PROGRAM_IDS.leash} />
          </dd>
          <dt className="text-fg-muted">Data</dt>
          <dd>
            {env.NEXT_PUBLIC_DATA_SOURCE === "indexer"
              ? `Indexer at ${env.NEXT_PUBLIC_INDEXER_URL}`
              : "Sample data (read-only)"}
          </dd>
        </dl>
      </Card>
      <OwnerActionDialog action={action} />
    </div>
  );
}
