import type { AgentView } from "@leash/contracts";
import Link from "next/link";
import { agentStatus } from "../lib/status.ts";
import { AllowanceGauge } from "./allowance-gauge.tsx";
import { RelativeTime } from "./relative-time.tsx";
import { StatusBadge } from "./tone.tsx";

/** An agent at a glance: status, budget, last activity, blocked attempts, strikes. */
export function AgentCard({
  agent,
  principalFrozen,
  now,
}: {
  agent: AgentView;
  principalFrozen: boolean;
  now: number;
}) {
  const status = agentStatus(agent, principalFrozen);
  const { stats, policy } = agent;
  return (
    <Link
      href={`/app/agents/${agent.address}`}
      className="block space-y-4 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{agent.label}</h3>
          <p className="text-xs text-fg-muted">
            {status.detail ??
              `${agent.payeeCount} allowed payee${agent.payeeCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <StatusBadge tone={status.tone} label={status.label} />
      </div>
      <AllowanceGauge allowance={agent.allowance} now={now} compact />
      <dl className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-fg-muted">Last payment</dt>
          <dd className="font-medium">
            {stats.lastPaymentAt === null ? (
              "Never"
            ) : (
              <RelativeTime timestamp={stats.lastPaymentAt} now={now} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Blocked</dt>
          <dd className={stats.deniedCount > 0 ? "font-medium text-blocked" : "font-medium"}>
            {stats.deniedCount}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Strikes</dt>
          <dd className="font-medium">
            {policy.tripwireMaxStrikes === 0
              ? "Off"
              : `${stats.strikes} of ${policy.tripwireMaxStrikes}`}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
