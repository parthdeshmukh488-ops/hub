"use client";

import { Card } from "../components/card.tsx";
import { RequestList } from "../components/request-list.tsx";
import { ScreenState } from "../components/screen-state.tsx";
import { useOverview, useRequests } from "../data/hooks.ts";
import { getDataSource } from "../data/index.ts";
import { readOnlyReason } from "../lib/copy.ts";
import { useLive } from "../live/live-provider.tsx";

export function ApprovalsScreen() {
  const requests = useRequests();
  const overview = useOverview();
  const { now } = useLive();
  const names = overview.data?.names ?? new Map<string, string>();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-sm text-fg-muted">
          Payments above an agent's instant limit wait here. Approving lets exactly that payment
          through once.
        </p>
      </div>
      <ScreenState query={requests}>
        {() => (
          <Card id="waiting" title="Waiting for you">
            {(requests.data ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing is waiting for your approval.</p>
            ) : (
              <RequestList
                requests={requests.data ?? []}
                names={names}
                now={now}
                showAgent
                disabledReason={readOnlyReason(getDataSource().kind)}
              />
            )}
          </Card>
        )}
      </ScreenState>
    </div>
  );
}
