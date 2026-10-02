"use client";

import Link from "next/link";
import { AgentCard } from "../components/agent-card.tsx";
import { Card } from "../components/card.tsx";
import { EventRow } from "../components/event-row.tsx";
import { FreezeSwitch } from "../components/freeze-switch.tsx";
import { OwnerActionDialog } from "../components/owner-action-dialog.tsx";
import { ScreenState } from "../components/screen-state.tsx";
import { useOverview } from "../data/hooks.ts";
import { getDataSource } from "../data/index.ts";
import { useViewerOwner, useWriteBlocker } from "../data/viewer.ts";
import { explorerLink } from "../lib/explorer.ts";
import { planFreezeAll, planUnfreezeAll } from "../lib/owner/plans.ts";
import { useOwnerAction } from "../lib/owner/use-owner-action.ts";
import { useLive } from "../live/live-provider.tsx";

export function OverviewScreen() {
  const query = useOverview();
  const { now } = useLive();
  const source = getDataSource().kind;
  const owner = useViewerOwner();
  const action = useOwnerAction({ owner });
  const disabledReason = useWriteBlocker();

  return (
    <>
      <OwnerActionDialog action={action} />
      <ScreenState query={query}>
        {() => {
          const overview = query.data;
          if (!overview || overview.principal === null) {
            return (
              <Card id="empty" title="No Leash account yet">
                <div className="space-y-3 text-sm text-fg-muted">
                  <p>
                    {source === "indexer"
                      ? "This wallet has no agents on a leash yet. Connect the wallet that owns them, or pair your first agent."
                      : "Pair your first agent to set its budget and rules."}
                  </p>
                  <Link href="/app/agents/new" className="inline-block text-brand underline">
                    Pair an agent
                  </Link>
                </div>
              </Card>
            );
          }
          const { principal, agents, recentBlocked, names } = overview;
          const running = agents.filter(
            (agent) => agent.status === "active" && !principal.frozen,
          ).length;
          const blocked = agents.reduce((sum, agent) => sum + agent.stats.deniedCount, 0);
          const waiting = agents.reduce((sum, agent) => sum + agent.openRequests, 0);
          return (
            <div className="space-y-6">
              <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h1 className="text-xl font-semibold">Your agents</h1>
                  <p className="text-sm text-fg-muted">
                    {running} of {agents.length} running ·{" "}
                    <span className={blocked > 0 ? "text-blocked" : ""}>{blocked} blocked</span> ·{" "}
                    <span className={waiting > 0 ? "text-approval" : ""}>
                      {waiting} waiting for you
                    </span>
                  </p>
                </div>
                <FreezeSwitch
                  frozen={principal.frozen}
                  label="Freeze all agents"
                  disabledReason={disabledReason}
                  onChange={(freeze) =>
                    action.start(({ chain, signer }) =>
                      freeze
                        ? planFreezeAll(chain, { signer, owner: principal.owner })
                        : planUnfreezeAll(chain, { signer }),
                    )
                  }
                  size="lg"
                />
              </section>

              <section aria-labelledby="agents-heading">
                <h2 id="agents-heading" className="sr-only">
                  Agents
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {agents.map((agent) => (
                    <AgentCard
                      key={agent.address}
                      agent={agent}
                      principalFrozen={principal.frozen}
                      now={now}
                    />
                  ))}
                </div>
              </section>

              <Card id="blocked-heading" title="Recent blocked attempts">
                {recentBlocked.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nothing blocked yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {recentBlocked.slice(0, 5).map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        names={names}
                        now={now}
                        explorerUrl={explorerLink(event.signature, source)}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </ScreenState>
    </>
  );
}
