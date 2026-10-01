import { denialInfo, type LeashEventOf } from "@leash/contracts";
import { actionUrl, activityPageUrl, agentPageUrl } from "../links.ts";
import { duration } from "../text.ts";
import { agentName, type OwnerState } from "./state.ts";
import type { Finding, RuleContext } from "./types.ts";

/** `burst_denials`: many blocked payments across an owner's agents in a short window. */
export function burstDenials(
  state: OwnerState,
  event: LeashEventOf<"PaymentDenied">,
  context: RuleContext,
): Finding | null {
  const { minDenials, windowSecs } = context.config.rules.burstDenials;
  const now = event.timestamp;
  const recent = state.denials.filter((d) => d.timestamp > now - windowSecs && d.timestamp <= now);
  if (recent.length < minDenials) return null;

  const agents = [...new Set(recent.map((d) => d.agent))];
  const only = agents.length === 1 ? agents[0] : undefined;
  // One agent whose tripwire fired is already frozen and alerted by `tripwire_fired`. Two or more
  // agents may be one attack heading for the rest, so they still alert (and freeze the principal).
  if (only && state.agents.get(only)?.tripped) return null;

  const names = agents.slice(0, 3).map((agent) => agentName(state, agent));
  const more = agents.length > 3 ? ` and ${agents.length - 3} more` : "";
  const who = only
    ? `by ${names[0]}`
    : `across ${agents.length} agents (${names.join(", ")}${more})`;
  const why = denialInfo(event.reason).ownerCopy;
  const actions = [
    only
      ? { label: "Open agent", url: agentPageUrl(context.webUrl, only) }
      : { label: "Open activity", url: activityPageUrl(context.webUrl) },
  ];
  if (context.config.actionLinks) {
    actions.push({
      label: "Freeze all agents",
      url: actionUrl(context.webUrl, "freezeAll", { owner: state.owner }),
    });
  }
  return {
    kind: "burst_denials",
    agent: only ?? null,
    trigger: event.id,
    title: `${recent.length} blocked payments within ${duration(windowSecs)}`,
    body:
      `${recent.length} payments were blocked ${who}. The latest: ${why}. ` +
      "An agent may have been manipulated: check what it is doing.",
    actions,
    eventIds: recent.map((d) => d.id),
    cooldown: true,
    freeze: state.principalFrozen ? undefined : { type: "freezePrincipal" },
  };
}
