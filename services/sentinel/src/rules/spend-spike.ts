import type { LeashEventOf } from "@leash/contracts";
import { actionUrl, agentPageUrl } from "../links.ts";
import { duration, usdc } from "../text.ts";
import { agentName, type OwnerState } from "./state.ts";
import type { Finding, RuleContext } from "./types.ts";

/**
 * `spend_spike`: an agent's spend in the recent window is above `multiplier` times its rate in
 * the window before, and at least `minAmount`. Payments of approved requests are not counted:
 * the owner chose them. No warm-up: the floor alone guards a new agent's first hour.
 */
export function spendSpike(
  state: OwnerState,
  event: LeashEventOf<"PaymentExecuted">,
  context: RuleContext,
): Finding | null {
  const agent = event.agent;
  if (!agent || event.requestNonce !== null) return null;
  const { windowSecs, baselineSecs, multiplier, minAmount } = context.config.rules.spendSpike;
  const now = event.timestamp;
  const windowStart = now - windowSecs;
  const baselineStart = windowStart - baselineSecs;
  let recent = 0n;
  let baseline = 0n;
  for (const payment of state.payments) {
    if (payment.agent !== agent || payment.timestamp > now) continue;
    if (payment.timestamp > windowStart) recent += payment.amount;
    else if (payment.timestamp > baselineStart) baseline += payment.amount;
  }
  if (recent < BigInt(minAmount)) return null;
  // recent / windowSecs > multiplier × baseline / baselineSecs, in integers.
  if (recent * BigInt(baselineSecs) <= BigInt(multiplier) * baseline * BigInt(windowSecs)) {
    return null;
  }

  const name = agentName(state, agent);
  const actions = [{ label: "Open agent", url: agentPageUrl(context.webUrl, agent) }];
  if (context.config.actionLinks) {
    actions.push({ label: "Freeze agent", url: actionUrl(context.webUrl, "freeze", { agent }) });
  }
  const frozen = state.principalFrozen || state.agents.get(agent)?.frozen === true;
  return {
    kind: "spend_spike",
    agent,
    trigger: event.id,
    title: `Unusual spending by ${name}`,
    body:
      `${name} spent ${usdc(recent)} in the last ${duration(windowSecs)}, more than ${multiplier}× ` +
      `its rate before (${usdc(baseline)} in the ${duration(baselineSecs)} before that).`,
    actions,
    eventIds: state.payments
      .filter((p) => p.agent === agent && p.timestamp > windowStart && p.timestamp <= now)
      .map((p) => p.id),
    cooldown: true,
    freeze: frozen ? undefined : { type: "freezeAgent", agent },
  };
}
