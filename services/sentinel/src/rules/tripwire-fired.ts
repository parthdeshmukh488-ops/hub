import { denialInfo, type LeashEventOf } from "@leash/contracts";
import { actionUrl, agentPageUrl } from "../links.ts";
import { duration, quoteMemo, usdc } from "../text.ts";
import { agentName, type DenialRecord, type OwnerState, payeeName } from "./state.ts";
import type { Finding, RuleContext } from "./types.ts";

/** The strike denials that tripped the wire, oldest first: the last `strikes` up to the trip. */
function strikesBehind(state: OwnerState, agent: string): DenialRecord[] {
  const strikes = state.denials.filter((d) => d.agent === agent && d.strike);
  const tripIndex = strikes.findLastIndex((d) => d.tripped);
  if (tripIndex < 0) return [];
  const trip = strikes[tripIndex];
  if (!trip) return [];
  return strikes.slice(Math.max(0, tripIndex + 1 - trip.strikes), tripIndex + 1);
}

/** `tripwire_fired`: the program froze an agent after repeated blocked payments. */
export function tripwireFired(
  state: OwnerState,
  event: LeashEventOf<"AgentFrozen">,
  context: RuleContext,
): Finding | null {
  const agent = event.agent;
  if (!agent || event.reason !== "tripwire") return null;
  const name = agentName(state, agent);
  const chain = strikesBehind(state, agent);
  const first = chain[0];
  const last = chain.at(-1);
  let story = `${name}'s tripwire froze it on-chain after repeated blocked payments.`;
  if (first && last) {
    const why = denialInfo(last.reason).ownerCopy;
    const memo = last.memo ? `, memo ${quoteMemo(last.memo)}` : "";
    story =
      `${name} tried ${chain.length} payments its policy blocks within ${duration(last.timestamp - first.timestamp)}, ` +
      "so its tripwire froze it on-chain. " +
      `The last one: ${usdc(last.amount)} to ${payeeName(state, agent, last.payee)} ` +
      `(${why.charAt(0).toLowerCase()}${why.slice(1)})${memo}.`;
  }
  const actions = [{ label: "Open agent", url: agentPageUrl(context.webUrl, agent) }];
  if (context.config.actionLinks) {
    actions.push({
      label: "Freeze all agents",
      url: actionUrl(context.webUrl, "freezeAll", { owner: state.owner }),
    });
  }
  return {
    kind: "tripwire_fired",
    agent,
    trigger: event.id,
    title: `${name} was frozen by its tripwire`,
    body: `${story} It cannot pay until you unfreeze it.`,
    actions,
    eventIds: [...chain.map((d) => d.id), event.id],
    cooldown: false,
  };
}
