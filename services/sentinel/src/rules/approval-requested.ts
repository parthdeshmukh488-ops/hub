import type { LeashEventOf } from "@leash/contracts";
import { actionUrl, approvalsPageUrl } from "../links.ts";
import { duration, quoteMemo, usdc } from "../text.ts";
import { agentName, type OwnerState, payeeName } from "./state.ts";
import type { Finding, RuleContext } from "./types.ts";

/** `approval_requested`: an agent asks the owner to approve a payment above its limit. */
export function approvalRequested(
  state: OwnerState,
  event: LeashEventOf<"PaymentRequested">,
  context: RuleContext,
): Finding | null {
  const agent = event.agent;
  if (!agent) return null;
  const name = agentName(state, agent);
  const amount = usdc(BigInt(event.amount));
  const purpose = event.memo ? ` for ${quoteMemo(event.memo)}` : "";
  const actions = [{ label: "Review request", url: approvalsPageUrl(context.webUrl) }];
  if (context.config.actionLinks) {
    actions.push(
      { label: "Approve", url: actionUrl(context.webUrl, "approve", { request: event.request }) },
      { label: "Reject", url: actionUrl(context.webUrl, "reject", { request: event.request }) },
    );
  }
  return {
    kind: "approval_requested",
    agent,
    trigger: event.id,
    title: `${name} asks you to approve ${amount}`,
    body:
      `${name} wants to pay ${amount} to ${payeeName(state, agent, event.payee)}${purpose}. ` +
      `It cannot pay until you approve; the request expires in ${duration(event.expiresAt - event.timestamp)}.`,
    actions,
    eventIds: [event.id],
    cooldown: false,
  };
}
