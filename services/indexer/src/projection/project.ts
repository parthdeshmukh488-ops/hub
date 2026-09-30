import type { LeashEvent, PayeeView, PrincipalView, RequestView } from "@leash/contracts";
import { rollRecurringPeriod, rollWindow } from "@leash/sdk";
import { delegationState } from "./allowance.ts";
import type { AgentRecord, DelegationRecord } from "./records.ts";

// Event-sourced projections: how each event changes the accounts it describes, following the
// program's effects (01-onchain-program §6, §7.2). Pure: the store loads the context and writes
// the changes in one batch with the event.

/** The current state of everything one event can touch. */
export type ProjectionContext = {
  principal: PrincipalView | null;
  agent: AgentRecord | null;
  /** This agent's allowlist entry for the event's payee. */
  payee: PayeeView | null;
  /** The request the event names (by address, or by nonce for a consumed request). */
  request: RequestView | null;
  /** The delegation a `PaymentExecuted` pulled from. */
  delegation: DelegationRecord | null;
  /** For `PayeeAdded`: the entry's address, reported by the source. */
  payeeEntryAddress: string | null;
};

/** Rows to write. `null` deletes the row the context held. */
export type ProjectionChanges = {
  principal?: PrincipalView;
  agent?: AgentRecord | null;
  payee?: PayeeView | null;
  request?: RequestView | null;
  delegation?: DelegationRecord;
};

/** The event does not fit the projections (for example an agent that was never created). */
export class ProjectionError extends Error {
  override readonly name = "ProjectionError";
}

type Window = { start: number | null; counter: bigint };

/** Leash windows (§7.2) on view fields, where "never started" is `null`. */
function rolled(start: number | null, secs: number, counter: bigint, now: number): Window {
  const window = rollWindow(BigInt(start ?? 0), secs, counter, BigInt(now));
  return { start: Number(window.start), counter: window.counter };
}

const add = (a: string, b: bigint): string => (BigInt(a) + b).toString();

function need<T>(value: T | null, what: string, event: LeashEvent): T {
  if (value === null) throw new ProjectionError(`${event.type} ${event.id}: unknown ${what}`);
  return value;
}

/** Subscriptions' pull: roll the period forward, then count the amount (01 §7.3). */
export function pullFromDelegation(
  delegation: DelegationRecord,
  amount: bigint,
  now: number,
): DelegationRecord {
  if (delegation.kind === "fixed") {
    const remaining = BigInt(delegation.amountRemaining) - amount;
    if (remaining < 0n) throw new ProjectionError(`delegation ${delegation.address} overdrawn`);
    return { ...delegation, amountRemaining: remaining.toString() };
  }
  const state = delegationState(delegation);
  if (state.kind !== "recurring") throw new ProjectionError("delegation kind changed");
  const period = rollRecurringPeriod(state, BigInt(now));
  if (typeof period === "string") {
    throw new ProjectionError(`delegation ${delegation.address} cannot pay at ${now} (${period})`);
  }
  return {
    ...delegation,
    currentPeriodStart: Number(period.currentPeriodStart),
    pulledInPeriod: (period.pulledInPeriod + amount).toString(),
  };
}

/** How one event changes the projections. Throws `ProjectionError` if the context is missing. */
export function project(event: LeashEvent, ctx: ProjectionContext): ProjectionChanges {
  const at = event.timestamp;
  const agent = () => need(ctx.agent, "agent", event);
  const touch = (record: AgentRecord): AgentRecord => ({ ...record, updatedAt: at });

  switch (event.type) {
    case "PrincipalInitialized":
      return {
        principal: {
          address: need(event.principal, "principal address", event),
          owner: event.owner,
          guardian: event.guardian,
          frozen: false,
          frozenAt: null,
          frozenBy: null,
          agentCount: 0,
          createdAt: at,
        },
      };
    case "GuardianChanged":
      return {
        principal: { ...need(ctx.principal, "principal", event), guardian: event.guardian },
      };
    case "PrincipalFrozen":
      return {
        principal: {
          ...need(ctx.principal, "principal", event),
          frozen: true,
          frozenAt: at,
          frozenBy: event.by,
        },
      };
    case "PrincipalUnfrozen":
      return {
        principal: {
          ...need(ctx.principal, "principal", event),
          frozen: false,
          frozenAt: null,
          frozenBy: null,
        },
      };

    case "AgentCreated": {
      const principal = need(ctx.principal, "principal", event);
      return {
        principal: { ...principal, agentCount: principal.agentCount + 1 },
        agent: {
          address: need(event.agent, "agent address", event),
          principal: principal.address,
          owner: principal.owner,
          agentKey: event.agentKey,
          mint: event.mint,
          label: event.label,
          status: "active",
          freezeReason: "none",
          frozenAt: null,
          payeeCount: 0,
          openRequests: 0,
          policy: event.policy,
          stats: {
            paymentsCount: 0,
            totalPaid: "0",
            deniedCount: 0,
            lastPaymentAt: null,
            velocityCount: 0,
            velocityWindowStart: null,
            strikes: 0,
            strikeWindowStart: null,
            requestNonce: "0",
          },
          createdAt: at,
          updatedAt: at,
        },
      };
    }
    case "PolicyUpdated":
      // Counters are kept (01 §6.1).
      return { agent: touch({ ...agent(), policy: event.policy }) };
    case "AgentFrozen":
      return {
        agent: touch({ ...agent(), status: "frozen", freezeReason: event.reason, frozenAt: at }),
      };
    case "AgentUnfrozen": {
      const current = agent();
      return {
        agent: touch({
          ...current,
          status: "active",
          freezeReason: "none",
          frozenAt: null,
          stats: { ...current.stats, strikes: 0, strikeWindowStart: null },
        }),
      };
    }
    case "AgentClosed": {
      const principal = need(ctx.principal, "principal", event);
      agent();
      return { principal: { ...principal, agentCount: principal.agentCount - 1 }, agent: null };
    }

    case "PayeeAdded": {
      const current = agent();
      return {
        agent: touch({ ...current, payeeCount: current.payeeCount + 1 }),
        payee: {
          address: need(ctx.payeeEntryAddress, "allowlist entry address", event),
          agent: current.address,
          payee: event.payee,
          label: event.label,
          maxPerPayment: event.maxPerPayment,
          periodLimit: event.periodLimit,
          periodSecs: event.periodSecs,
          periodStart: null,
          spentInPeriod: "0",
          totalPaid: "0",
          paymentsCount: 0,
          createdAt: at,
        },
      };
    }
    case "PayeeUpdated":
      // Label and limits change; period counters are kept. The Agent account is not written.
      return {
        payee: {
          ...need(ctx.payee, "allowlist entry", event),
          label: event.label,
          maxPerPayment: event.maxPerPayment,
          periodLimit: event.periodLimit,
          periodSecs: event.periodSecs,
        },
      };
    case "PayeeRemoved": {
      const current = agent();
      need(ctx.payee, "allowlist entry", event);
      return { agent: touch({ ...current, payeeCount: current.payeeCount - 1 }), payee: null };
    }

    case "PaymentExecuted": {
      const current = agent();
      const amount = BigInt(event.amount);
      const stats = {
        ...current.stats,
        paymentsCount: event.paymentsCount,
        totalPaid: add(current.stats.totalPaid, amount),
        lastPaymentAt: at,
      };
      // A switched-off limit is not tracked (ADR 20260929-ws0-disabled-limits-are-not-tracked).
      if (current.policy.velocityMaxPayments > 0) {
        const window = rolled(
          current.stats.velocityWindowStart,
          current.policy.velocityWindowSecs,
          BigInt(current.stats.velocityCount),
          at,
        );
        stats.velocityWindowStart = window.start;
        stats.velocityCount = Number(window.counter + 1n);
      }
      const changes: ProjectionChanges = {};
      let openRequests = current.openRequests;
      if (event.requestNonce !== null) {
        need(ctx.request, "approved request", event);
        changes.request = null;
        openRequests -= 1;
      }
      if (ctx.payee !== null) {
        const payee = ctx.payee;
        const period =
          BigInt(payee.periodLimit) === 0n
            ? { periodStart: payee.periodStart, spentInPeriod: payee.spentInPeriod }
            : (() => {
                const window = rolled(
                  payee.periodStart,
                  payee.periodSecs,
                  BigInt(payee.spentInPeriod),
                  at,
                );
                return {
                  periodStart: window.start,
                  spentInPeriod: (window.counter + amount).toString(),
                };
              })();
        changes.payee = {
          ...payee,
          ...period,
          totalPaid: add(payee.totalPaid, amount),
          paymentsCount: payee.paymentsCount + 1,
        };
      }
      if (ctx.delegation !== null) {
        changes.delegation = pullFromDelegation(ctx.delegation, amount, at);
      }
      changes.agent = touch({ ...current, openRequests, stats });
      return changes;
    }
    case "PaymentDenied": {
      const current = agent();
      const stats = { ...current.stats, deniedCount: current.stats.deniedCount + 1 };
      // report_denied_attempt step 4: strikes count only while the tripwire is on and the agent
      // is active. The event carries the resulting count; the window start follows §7.2.
      if (event.strike && current.policy.tripwireMaxStrikes > 0 && current.status === "active") {
        const window = rolled(
          current.stats.strikeWindowStart,
          current.policy.tripwireWindowSecs,
          BigInt(current.stats.strikes),
          at,
        );
        stats.strikeWindowStart = window.start;
        stats.strikes = event.strikes;
      }
      return { agent: touch({ ...current, stats }) };
    }

    case "PaymentRequested": {
      const current = agent();
      return {
        agent: touch({
          ...current,
          openRequests: current.openRequests + 1,
          stats: { ...current.stats, requestNonce: (BigInt(event.nonce) + 1n).toString() },
        }),
        request: {
          address: event.request,
          agent: current.address,
          nonce: event.nonce,
          payee: event.payee,
          amount: event.amount,
          reference: event.reference,
          memo: event.memo,
          status: "pending",
          createdAt: at,
          expiresAt: event.expiresAt,
          approvedAt: null,
          // The SDK has the agent key pay the rent. Chain mode reads the account instead.
          rentPayer: current.agentKey,
        },
      };
    }
    case "RequestApproved":
      // Only the request account is written.
      return {
        request: { ...need(ctx.request, "request", event), status: "approved", approvedAt: at },
      };
    case "RequestRejected":
    case "RequestExpired": {
      const current = agent();
      need(ctx.request, "request", event);
      return {
        agent: touch({ ...current, openRequests: current.openRequests - 1 }),
        request: null,
      };
    }
  }
}
