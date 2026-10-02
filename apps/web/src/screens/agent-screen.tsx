"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Address } from "../components/address.tsx";
import { AllowanceGauge } from "../components/allowance-gauge.tsx";
import { Card } from "../components/card.tsx";
import { cn } from "../components/cn.ts";
import { EventRow } from "../components/event-row.tsx";
import { FreezeSwitch } from "../components/freeze-switch.tsx";
import { OwnerActionDialog } from "../components/owner-action-dialog.tsx";
import { PayeeList } from "../components/payee-list.tsx";
import { RelativeTime } from "../components/relative-time.tsx";
import { RequestList } from "../components/request-list.tsx";
import { ScreenState } from "../components/screen-state.tsx";
import { StrikeMeter } from "../components/strike-meter.tsx";
import { StatusBadge } from "../components/tone.tsx";
import { WhatIfCard } from "../components/what-if-card.tsx";
import { useAgentDetail } from "../data/hooks.ts";
import { getDataSource } from "../data/index.ts";
import { useViewerOwner, useWriteBlocker } from "../data/viewer.ts";
import { explorerLink } from "../lib/explorer.ts";
import {
  planApprove,
  planFreezeAgent,
  planReject,
  planResetStrikes,
  planUnfreezeAgent,
} from "../lib/owner/plans.ts";
import { useOwnerAction } from "../lib/owner/use-owner-action.ts";
import { policyLines } from "../lib/policy.ts";
import { agentStatus } from "../lib/status.ts";
import { useLive } from "../live/live-provider.tsx";

export function AgentScreen({ address }: { address: string }) {
  const query = useAgentDetail(address);
  const { now } = useLive();
  const source = getDataSource().kind;
  const action = useOwnerAction({ owner: useViewerOwner() });
  const disabledReason = useWriteBlocker();

  return (
    <>
      <OwnerActionDialog action={action} />
      <ScreenState query={query}>
        {() => {
          const detail = query.data;
          if (!detail) {
            return (
              <div className="space-y-3 rounded-2xl border border-line bg-surface p-6">
                <h1 className="text-lg font-semibold">No agent at this address</h1>
                <p className="text-sm text-fg-muted">
                  It may have been closed, or the link is wrong.
                </p>
                <Link href="/app" className="text-sm text-brand underline">
                  Back to the overview
                </Link>
              </div>
            );
          }
          const { agent, payees, requests, events, names } = detail;
          const status = agentStatus(agent, detail.principalFrozen);
          return (
            <div className="space-y-6">
              <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
                <Link href="/app" className="hover:text-fg">
                  Overview
                </Link>{" "}
                / <span className="text-fg">{agent.label}</span>
              </nav>

              <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate text-xl font-semibold">{agent.label}</h1>
                    <StatusBadge tone={status.tone} label={status.label} />
                  </div>
                  {status.detail !== null && (
                    <p
                      className={cn(
                        "text-sm",
                        status.tone === "frozen" ? "text-frozen" : "text-fg-muted",
                      )}
                    >
                      {status.detail}
                      {agent.frozenAt !== null && (
                        <>
                          {" "}
                          · <RelativeTime timestamp={agent.frozenAt} now={now} />
                        </>
                      )}
                    </p>
                  )}
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                    <span>
                      Agent account <Address address={agent.address} />
                    </span>
                    <span>
                      Agent key <Address address={agent.agentKey} />
                    </span>
                  </p>
                </div>
                <FreezeSwitch
                  frozen={agent.status === "frozen"}
                  label="Freeze this agent"
                  disabledReason={disabledReason}
                  onChange={(freeze) =>
                    action.start(({ chain, signer }) =>
                      freeze
                        ? planFreezeAgent(chain, { signer, agent: agent.address })
                        : planUnfreezeAgent(chain, { signer, agent: agent.address }),
                    )
                  }
                  size="lg"
                />
              </section>

              <div className="grid gap-6 md:grid-cols-5">
                <Card id="allowance" title="Allowance" className="md:col-span-3">
                  <AllowanceGauge allowance={agent.allowance} now={now} />
                </Card>
                <Card id="tripwire" title="Tripwire" className="md:col-span-2">
                  <StrikeMeter
                    strikes={agent.stats.strikes}
                    max={agent.policy.tripwireMaxStrikes}
                    windowSecs={agent.policy.tripwireWindowSecs}
                  />
                  {agent.status === "active" && agent.stats.strikes > 0 && (
                    <button
                      type="button"
                      disabled={disabledReason !== null}
                      title={disabledReason ?? undefined}
                      onClick={() =>
                        action.start(({ chain, signer }) =>
                          planResetStrikes(chain, { signer, agent: agent.address }),
                        )
                      }
                      className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear strikes
                    </button>
                  )}
                </Card>
              </div>

              {requests.length > 0 && (
                <Card id="requests" title="Waiting for your approval">
                  <RequestList
                    requests={requests}
                    names={names}
                    now={now}
                    actions={{
                      disabledReason,
                      onApprove: (request) =>
                        action.start(({ chain, signer }) =>
                          planApprove(chain, { signer, request: request.address }),
                        ),
                      onReject: (request) =>
                        action.start(({ chain, signer }) =>
                          planReject(chain, { signer, request: request.address }),
                        ),
                    }}
                  />
                </Card>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                <Card id="rules" title="Spending rules">
                  <ul className="space-y-2 text-sm">
                    {policyLines(agent.policy, agent.payeeCount).map((line) => (
                      <li
                        key={line.text}
                        className={cn("flex gap-2", line.warning && "text-approval")}
                      >
                        {line.warning && (
                          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        )}
                        <span>{line.text}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card id="payees" title="Allowed payees">
                  <PayeeList rows={payees} />
                </Card>
              </div>

              <WhatIfCard detail={detail} now={now} />

              <Card id="activity" title="Activity">
                {events.length === 0 ? (
                  <p className="text-sm text-fg-muted">No activity yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {events.map((event) => (
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
