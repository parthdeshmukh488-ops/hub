import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Address } from "../../../../components/address.tsx";
import { AllowanceGauge } from "../../../../components/allowance-gauge.tsx";
import { AmountText } from "../../../../components/amount-text.tsx";
import { Card } from "../../../../components/card.tsx";
import { cn } from "../../../../components/cn.ts";
import { EventRow } from "../../../../components/event-row.tsx";
import { FreezeSwitch } from "../../../../components/freeze-switch.tsx";
import { PayeeList } from "../../../../components/payee-list.tsx";
import { RelativeTime } from "../../../../components/relative-time.tsx";
import { StrikeMeter } from "../../../../components/strike-meter.tsx";
import { StatusBadge } from "../../../../components/tone.tsx";
import { getDataSource } from "../../../../data/index.ts";
import { READ_ONLY_REASON } from "../../../../lib/copy.ts";
import { absoluteTime, relativeTime, shortAddress } from "../../../../lib/format.ts";
import { policyLines } from "../../../../lib/policy.ts";
import { agentStatus } from "../../../../lib/status.ts";

type Props = { params: Promise<{ agent: string }> };

export async function generateMetadata({ params }: Props) {
  const detail = await getDataSource().agent((await params).agent);
  return { title: detail?.agent.label ?? "Agent" };
}

export default async function AgentPage({ params }: Props) {
  const source = getDataSource();
  const detail = await source.agent((await params).agent);
  if (detail === null) notFound();
  const now = source.now();
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
              className={cn("text-sm", status.tone === "frozen" ? "text-frozen" : "text-fg-muted")}
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
          disabledReason={READ_ONLY_REASON}
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
        </Card>
      </div>

      {requests.length > 0 && (
        <Card id="requests" title="Waiting for your approval">
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li
                key={request.address}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">
                    Pay {names.get(request.payee) ?? shortAddress(request.payee)}{" "}
                    <AmountText amount={request.amount} />
                  </p>
                  {request.memo !== "" && (
                    <p className="truncate text-xs text-fg-muted">
                      <span className="font-medium">Agent note:</span> {request.memo}
                    </p>
                  )}
                </div>
                <StatusBadge
                  tone="approval"
                  label={
                    request.expiresAt > now
                      ? `Expires ${relativeTime(request.expiresAt, now)}`
                      : "Expired"
                  }
                  title={absoluteTime(request.expiresAt)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card id="rules" title="Spending rules">
          <ul className="space-y-2 text-sm">
            {policyLines(agent.policy, agent.payeeCount).map((line) => (
              <li key={line.text} className={cn("flex gap-2", line.warning && "text-approval")}>
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

      <Card id="activity" title="Activity">
        {events.length === 0 ? (
          <p className="text-sm text-fg-muted">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((event) => (
              <EventRow key={event.id} event={event} names={names} now={now} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
