"use client";

import type { LeashEventType } from "@leash/contracts";
import { Download } from "lucide-react";
import { useId, useState } from "react";
import { Card } from "../components/card.tsx";
import { EventRow } from "../components/event-row.tsx";
import { ScreenState } from "../components/screen-state.tsx";
import { useActivity, useOverview } from "../data/hooks.ts";
import { getDataSource } from "../data/index.ts";
import { eventsToCsv } from "../lib/csv.ts";
import { explorerLink } from "../lib/explorer.ts";
import { useLive } from "../live/live-provider.tsx";
import type { ActivityFilter } from "../live/merge.ts";

/** Event groups the owner filters by. `null` means every type. */
const KINDS: Record<string, { label: string; types: LeashEventType[] | null }> = {
  all: { label: "Everything", types: null },
  blocked: { label: "Blocked attempts", types: ["PaymentDenied"] },
  payments: { label: "Payments", types: ["PaymentExecuted"] },
  approvals: {
    label: "Approval requests",
    types: ["PaymentRequested", "RequestApproved", "RequestRejected", "RequestExpired"],
  },
  controls: {
    label: "Freezes and rule changes",
    types: [
      "AgentFrozen",
      "AgentUnfrozen",
      "PrincipalFrozen",
      "PrincipalUnfrozen",
      "PolicyUpdated",
      "PayeeAdded",
      "PayeeUpdated",
      "PayeeRemoved",
      "GuardianChanged",
    ],
  },
};

export function ActivityScreen() {
  const ids = { agent: useId(), kind: useId() };
  const [agent, setAgent] = useState("");
  const [kind, setKind] = useState("all");
  const types = KINDS[kind]?.types ?? null;
  const filter: ActivityFilter = { ...(agent ? { agent } : {}), ...(types ? { types } : {}) };
  const activity = useActivity(filter);
  const overview = useOverview();
  const { now } = useLive();
  const source = getDataSource().kind;
  const names = overview.data?.names ?? new Map<string, string>();
  const events = activity.data?.pages.flatMap((page) => page.items) ?? [];

  const exportCsv = () => {
    const blob = new Blob([eventsToCsv(events, names)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "leash-activity.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const field = "rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Activity</h1>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.agent} className="text-xs text-fg-muted">
              Agent
            </label>
            <select
              id={ids.agent}
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className={field}
            >
              <option value="">All agents</option>
              {(overview.data?.agents ?? []).map((a) => (
                <option key={a.address} value={a.address}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.kind} className="text-xs text-fg-muted">
              Show
            </label>
            <select
              id={ids.kind}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={field}
            >
              {Object.entries(KINDS).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={events.length === 0}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface disabled:opacity-50"
          >
            <Download aria-hidden="true" className="size-4" />
            Export CSV
          </button>
        </div>
      </div>

      <ScreenState query={activity}>
        {() => (
          <Card
            id="activity-list"
            title={`${events.length} event${events.length === 1 ? "" : "s"}`}
          >
            {events.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing here yet.</p>
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
            {activity.hasNextPage && (
              <button
                type="button"
                onClick={() => void activity.fetchNextPage()}
                disabled={activity.isFetchingNextPage}
                className="mt-4 w-full rounded-lg border border-line py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {activity.isFetchingNextPage ? "Loading…" : "Load older events"}
              </button>
            )}
          </Card>
        )}
      </ScreenState>
    </div>
  );
}
