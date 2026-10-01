import type { LeashEventOf } from "@leash/contracts";
import { actionUrl, agentPageUrl } from "../links.ts";
import { duration, usdc } from "../text.ts";
import { agentName, type OwnerState, payeeKey, payeeName } from "./state.ts";
import type { Finding, RuleContext } from "./types.ts";

/**
 * `new_payee_spend`: a large payment to a payee added minutes ago, the pattern of a payee the
 * owner was tricked into adding. The cap is the entry's per-payment limit, else the agent's;
 * with neither the rule is off. Payments of approved requests are not counted.
 */
export function newPayeeSpend(
  state: OwnerState,
  event: LeashEventOf<"PaymentExecuted">,
  context: RuleContext,
): Finding | null {
  const agent = event.agent;
  if (!agent || event.requestNonce !== null) return null;
  const { windowSecs, capPercent } = context.config.rules.newPayeeSpend;
  const entry = state.payees.get(payeeKey(agent, event.payee));
  if (!entry) return null;
  const age = event.timestamp - entry.addedAt;
  if (age < 0 || age > windowSecs) return null;
  const cap =
    entry.maxPerPayment > 0n ? entry.maxPerPayment : (state.agents.get(agent)?.maxPerPayment ?? 0n);
  if (cap === 0n) return null;
  const amount = BigInt(event.amount);
  if (amount * 100n < BigInt(capPercent) * cap) return null;

  const name = agentName(state, agent);
  const actions = [{ label: "Open agent", url: agentPageUrl(context.webUrl, agent) }];
  if (context.config.actionLinks) {
    actions.push({ label: "Freeze agent", url: actionUrl(context.webUrl, "freeze", { agent }) });
  }
  return {
    kind: "new_payee_spend",
    agent,
    trigger: event.id,
    title: `${name} paid a new payee ${usdc(amount)}`,
    body:
      `${name} paid ${usdc(amount)} to ${payeeName(state, agent, event.payee)}, ` +
      `${(amount * 100n) / cap}% of its per-payment cap, ${duration(age)} after the payee was added. ` +
      "Check that you added this payee yourself.",
    actions,
    eventIds: [event.id],
    cooldown: true,
  };
}
