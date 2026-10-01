import type { Alert, AlertKind, AlertSeverity } from "@leash/contracts";
import { clip } from "../text.ts";
import { allowanceLow } from "./allowance-low.ts";
import { approvalRequested } from "./approval-requested.ts";
import { burstDenials } from "./burst-denials.ts";
import { newPayeeSpend } from "./new-payee-spend.ts";
import { spendSpike } from "./spend-spike.ts";
import { applyInput, type OwnerState } from "./state.ts";
import { tripwireFired } from "./tripwire-fired.ts";
import type { Finding, RuleContext, RuleInput, RuleResult, SentinelAction } from "./types.ts";

/** Severity per kind (WS5 brief, rules table). */
export const ALERT_SEVERITY: Record<AlertKind, AlertSeverity> = {
  tripwire_fired: "critical",
  burst_denials: "warning",
  approval_requested: "info",
  spend_spike: "warning",
  new_payee_spend: "warning",
  allowance_low: "info",
  guardian_freeze: "critical",
};

const TITLE_MAX = 80;
const BODY_MAX = 500;

function findings(state: OwnerState, input: RuleInput, context: RuleContext): Finding[] {
  const rules = context.config.rules;
  const found: (Finding | null)[] = [];
  if (input.kind === "agent") {
    if (rules.allowanceLow.enabled) found.push(allowanceLow(state, input.agent, context));
  } else if (input.kind === "event") {
    const event = input.event;
    switch (event.type) {
      case "PaymentRequested":
        if (rules.approvalRequested.enabled) found.push(approvalRequested(state, event, context));
        break;
      case "AgentFrozen":
        if (rules.tripwireFired.enabled) found.push(tripwireFired(state, event, context));
        break;
      case "PaymentDenied":
        if (rules.burstDenials.enabled) found.push(burstDenials(state, event, context));
        break;
      case "PaymentExecuted":
        if (rules.spendSpike.enabled) found.push(spendSpike(state, event, context));
        if (rules.newPayeeSpend.enabled) found.push(newPayeeSpend(state, event, context));
        break;
      default:
        break;
    }
  }
  return found.filter((f): f is Finding => f !== null);
}

/** Event time of an input; views use their snapshot time. */
function inputTime(input: RuleInput): number | null {
  if (input.kind === "event") return input.event.timestamp;
  if (input.kind === "agent") return input.agent.allowance?.asOf ?? input.agent.updatedAt;
  return null;
}

/**
 * The rules engine for one owner: a pure function of the state and one input. It returns the
 * next state (the input's state is never modified), the alerts to send and the guardian freezes
 * the rules ask for. An event seen before returns the state unchanged and nothing else, so the
 * stream's at-least-once delivery and a backfill after reconnecting never repeat an alert.
 *
 * Cooldowns and windows run on event time; `now` only stamps `createdAt`.
 */
export function evaluate(
  state: OwnerState,
  input: RuleInput,
  now: number,
  context: RuleContext,
): RuleResult<OwnerState> {
  if (input.kind === "event" && state.seen.has(input.event.id)) {
    return { state, alerts: [], actions: [] };
  }
  const next = structuredClone(state);
  applyInput(next, input, context.config);

  const time = inputTime(input) ?? now;
  const alerts: Alert[] = [];
  const actions: SentinelAction[] = [];
  for (const finding of findings(next, input, context)) {
    const subject = finding.agent ?? next.owner;
    if (finding.cooldown) {
      const key = `${finding.kind}/${subject}`;
      if (time < (next.cooldownUntil.get(key) ?? 0)) continue;
      next.cooldownUntil.set(key, time + context.config.cooldownSecs);
    }
    if (finding.kind === "allowance_low") next.allowanceAlerted.add(finding.trigger);

    const id = `${finding.kind}:${subject}:${finding.trigger}`;
    alerts.push({
      id,
      severity: ALERT_SEVERITY[finding.kind],
      kind: finding.kind,
      owner: next.owner,
      agent: finding.agent,
      title: clip(finding.title, TITLE_MAX),
      body: clip(finding.body, BODY_MAX),
      actions: finding.actions,
      eventIds: finding.eventIds,
      createdAt: now,
    });
    if (finding.freeze?.type === "freezeAgent") {
      actions.push({
        type: "freezeAgent",
        owner: next.owner,
        agent: finding.freeze.agent,
        alertId: id,
      });
    } else if (finding.freeze?.type === "freezePrincipal") {
      actions.push({ type: "freezePrincipal", owner: next.owner, alertId: id });
    }
  }
  return { state: next, alerts, actions };
}

/** Runs `evaluate` over many inputs, `now` taken from each input's time. For replays and tests. */
export function evaluateAll(
  state: OwnerState,
  inputs: readonly RuleInput[],
  context: RuleContext,
): RuleResult<OwnerState> {
  let current = state;
  const alerts: Alert[] = [];
  const actions: SentinelAction[] = [];
  for (const input of inputs) {
    const result = evaluate(current, input, inputTime(input) ?? 0, context);
    current = result.state;
    alerts.push(...result.alerts);
    actions.push(...result.actions);
  }
  return { state: current, alerts, actions };
}
