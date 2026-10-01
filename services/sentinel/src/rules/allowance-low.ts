import type { AgentView } from "@leash/contracts";
import { agentPageUrl } from "../links.ts";
import { usdc } from "../text.ts";
import { agentName, type OwnerState } from "./state.ts";
import type { Finding, RuleContext } from "./types.ts";

/**
 * `allowance_low`: less than `remainingPercent` of the allowance is left. A recurring allowance
 * is measured against its amount per period and alerts once per period. A fixed delegation
 * stores only what remains (01 §8.3), so its baseline is the highest remainder Sentinel has seen,
 * and it alerts once per delegation. A restart resets that baseline.
 */
export function allowanceLow(
  state: OwnerState,
  view: AgentView,
  context: RuleContext,
): Finding | null {
  const allowance = view.allowance;
  if (!allowance) return null;
  const remaining = BigInt(allowance.remaining);
  let total: bigint;
  let trigger: string;
  if (allowance.kind === "recurring") {
    total = BigInt(allowance.amountPerPeriod ?? "0");
    trigger = `${allowance.delegation}:${allowance.currentPeriodStart ?? 0}`;
  } else {
    total = state.allowanceBaseline.get(allowance.delegation) ?? 0n;
    trigger = `${allowance.delegation}:fixed`;
  }
  if (total === 0n || state.allowanceAlerted.has(trigger)) return null;
  if (remaining * 100n >= BigInt(context.config.rules.allowanceLow.remainingPercent) * total) {
    return null;
  }

  const name = agentName(state, view.address);
  return {
    kind: "allowance_low",
    agent: view.address,
    trigger,
    title: `${name}'s allowance is almost used up`,
    body:
      allowance.kind === "recurring"
        ? `${name} has ${usdc(remaining)} of its ${usdc(total)} allowance left for this period.`
        : `${name} has ${usdc(remaining)} of its allowance left, out of ${usdc(total)}.`,
    actions: [{ label: "Open agent", url: agentPageUrl(context.webUrl, view.address) }],
    eventIds: [],
    cooldown: false,
  };
}
