import type { DenialReason } from "@leash/contracts";
import type { SentinelConfig } from "../config.ts";
import { shortAddress, untrusted } from "../text.ts";
import type { RuleInput } from "./types.ts";

// What Sentinel remembers per owner. Everything time-based uses event time, so a catch-up after
// a reconnect produces the same alerts as following live.

export interface AgentInfo {
  /** `null` until an `AgentCreated` or a view tells us. */
  label: string | null;
  /** The policy's per-payment cap, `0n` = off. */
  maxPerPayment: bigint;
  frozen: boolean;
  /** Its tripwire fired and it has not been unfrozen since. */
  tripped: boolean;
}

export interface PayeeInfo {
  label: string;
  /** The entry's per-payment cap, `0n` = off. */
  maxPerPayment: bigint;
  /** When the entry was added (its `PayeeAdded`, or the view's `createdAt`). */
  addedAt: number;
}

/** A payment that counts as the agent's own spending: approved requests are left out. */
export interface PaymentRecord {
  id: string;
  agent: string;
  amount: bigint;
  timestamp: number;
}

export interface DenialRecord {
  id: string;
  agent: string;
  payee: string;
  amount: bigint;
  reason: DenialReason;
  strike: boolean;
  strikes: number;
  tripped: boolean;
  memo: string;
  timestamp: number;
}

export interface OwnerState {
  owner: string;
  principalFrozen: boolean;
  agents: Map<string, AgentInfo>;
  /** Keyed by `payeeKey(agent, payee)`. */
  payees: Map<string, PayeeInfo>;
  /** Recent payments, oldest first, pruned by `retentionSecs`. */
  payments: PaymentRecord[];
  /** Recent denials, oldest first, pruned by `retentionSecs`. */
  denials: DenialRecord[];
  /** Event ids already handled (the stream is at-least-once), newest last, bounded. */
  seen: Set<string>;
  /** `${kind}/${agent or owner}` → event time until which that alert is muted. */
  cooldownUntil: Map<string, number>;
  /** `allowance_low` triggers already alerted (one per period or per fixed delegation). */
  allowanceAlerted: Set<string>;
  /** Fixed delegations: the highest `amountRemaining` seen, the stand-in for the original. */
  allowanceBaseline: Map<string, bigint>;
}

/** How many handled event ids are remembered for deduplication. */
export const SEEN_LIMIT = 2000;

export function emptyOwnerState(owner: string): OwnerState {
  return {
    owner,
    principalFrozen: false,
    agents: new Map(),
    payees: new Map(),
    payments: [],
    denials: [],
    seen: new Set(),
    cooldownUntil: new Map(),
    allowanceAlerted: new Set(),
    allowanceBaseline: new Map(),
  };
}

export function payeeKey(agent: string, payee: string): string {
  return `${agent}/${payee}`;
}

/** How long payments and denials are kept: the longest window any rule looks at. */
export function retentionSecs(config: SentinelConfig): number {
  const { burstDenials, spendSpike } = config.rules;
  return Math.max(burstDenials.windowSecs, spendSpike.windowSecs + spendSpike.baselineSecs, 3600);
}

/** The agent's label made safe for an alert, or its short address. */
export function agentName(state: OwnerState, agent: string): string {
  const label = state.agents.get(agent)?.label;
  return label ? untrusted(label) || shortAddress(agent) : shortAddress(agent);
}

/** The payee's allowlist label made safe for an alert, or its short address. */
export function payeeName(state: OwnerState, agent: string, payee: string): string {
  const label = state.payees.get(payeeKey(agent, payee))?.label;
  return label ? untrusted(label) || shortAddress(payee) : shortAddress(payee);
}

function agentInfo(state: OwnerState, agent: string): AgentInfo {
  let info = state.agents.get(agent);
  if (!info) {
    info = { label: null, maxPerPayment: 0n, frozen: false, tripped: false };
    state.agents.set(agent, info);
  }
  return info;
}

/**
 * Applies an input's facts to `state` (which the caller owns: the engine passes a copy). Runs
 * before the rules, so they see the state including this input.
 */
export function applyInput(state: OwnerState, input: RuleInput, config: SentinelConfig): void {
  if (input.kind === "agent") {
    const view = input.agent;
    const info = agentInfo(state, view.address);
    info.label = view.label;
    info.maxPerPayment = BigInt(view.policy.maxPerPayment);
    info.frozen = view.status === "frozen";
    info.tripped = info.frozen && view.freezeReason === "tripwire";
    const allowance = view.allowance;
    if (allowance?.kind === "fixed") {
      const remaining = BigInt(allowance.amountRemaining ?? allowance.remaining);
      const baseline = state.allowanceBaseline.get(allowance.delegation) ?? 0n;
      if (remaining > baseline) state.allowanceBaseline.set(allowance.delegation, remaining);
    }
    return;
  }
  if (input.kind === "payees") {
    for (const entry of input.payees) {
      state.payees.set(payeeKey(input.agent, entry.payee), {
        label: entry.label,
        maxPerPayment: BigInt(entry.maxPerPayment),
        addedAt: entry.createdAt,
      });
    }
    return;
  }

  const event = input.event;
  state.seen.add(event.id);
  if (state.seen.size > SEEN_LIMIT) {
    const oldest = state.seen.values().next();
    if (!oldest.done) state.seen.delete(oldest.value);
  }
  const agent = event.agent;
  switch (event.type) {
    case "PrincipalFrozen":
      state.principalFrozen = true;
      break;
    case "PrincipalUnfrozen":
      state.principalFrozen = false;
      break;
    case "AgentCreated":
    case "PolicyUpdated":
      if (agent) {
        const info = agentInfo(state, agent);
        if (event.type === "AgentCreated") info.label = event.label;
        info.maxPerPayment = BigInt(event.policy.maxPerPayment);
      }
      break;
    case "AgentFrozen":
      if (agent) {
        const info = agentInfo(state, agent);
        info.frozen = true;
        if (event.reason === "tripwire") info.tripped = true;
      }
      break;
    case "AgentUnfrozen":
      if (agent) {
        const info = agentInfo(state, agent);
        info.frozen = false;
        info.tripped = false;
      }
      break;
    case "AgentClosed":
      if (agent) state.agents.delete(agent);
      break;
    case "PayeeAdded":
    case "PayeeUpdated":
      if (agent) {
        const key = payeeKey(agent, event.payee);
        const previous = state.payees.get(key);
        state.payees.set(key, {
          label: event.label,
          maxPerPayment: BigInt(event.maxPerPayment),
          // An update changes the limits, not how new the payee is.
          addedAt: event.type === "PayeeUpdated" && previous ? previous.addedAt : event.timestamp,
        });
      }
      break;
    case "PayeeRemoved":
      if (agent) state.payees.delete(payeeKey(agent, event.payee));
      break;
    case "PaymentExecuted":
      if (agent && event.requestNonce === null) {
        state.payments.push({
          id: event.id,
          agent,
          amount: BigInt(event.amount),
          timestamp: event.timestamp,
        });
      }
      break;
    case "PaymentDenied":
      if (agent) {
        state.denials.push({
          id: event.id,
          agent,
          payee: event.payee,
          amount: BigInt(event.amount),
          reason: event.reason,
          strike: event.strike,
          strikes: event.strikes,
          tripped: event.tripped,
          memo: event.memo,
          timestamp: event.timestamp,
        });
        if (event.tripped) {
          // The report that trips the wire also freezes the agent (01 §6.2, report_denied_attempt).
          const info = agentInfo(state, agent);
          info.tripped = true;
          info.frozen = true;
        }
      }
      break;
    default:
      break;
  }

  const horizon = event.timestamp - retentionSecs(config);
  state.payments = state.payments.filter((p) => p.timestamp > horizon);
  state.denials = state.denials.filter((d) => d.timestamp > horizon);
  for (const [key, until] of state.cooldownUntil) {
    if (until <= event.timestamp) state.cooldownUntil.delete(key);
  }
}
