import type { AgentView, PrincipalView, RequestView } from "@leash/contracts";
import { fetchPayees, fetchRequestView, type LeashChain, readChainTime } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { ActionHttpError } from "./http.ts";
import { loadAgent, loadPrincipal } from "./reads.ts";
import { nameOf, safeText, usdc } from "./text.ts";

// What approve and reject share: the request, its agent and principal, and the words for them.

export interface RequestContext {
  request: RequestView;
  agent: AgentView;
  principal: PrincipalView;
  /** "1.50 USDC to Research API". */
  what: string;
  /** "Research Assistant asks to pay 1.50 USDC to Research API for “…”." */
  story: string;
  /** Why it cannot be acted on, or null. */
  blocked: string | null;
}

export async function loadRequestContext(
  chain: LeashChain,
  address: string,
  options: { checkExpiry: boolean },
): Promise<RequestContext> {
  const request = await fetchRequestView(chain, address as Address);
  if (!request) {
    throw new ActionHttpError(
      404,
      "No open payment request at this address: it was executed, rejected or expired.",
    );
  }
  const agent = await loadAgent(chain, request.agent);
  const principal = await loadPrincipal(chain, agent.owner);
  const payees = await fetchPayees(chain, agent.address as Address);
  const payee = nameOf(payees.find((p) => p.payee === request.payee)?.label, request.payee);
  const what = `${usdc(request.amount)} to ${payee}`;
  const memo = safeText(request.memo, 64);
  const story = `${nameOf(agent.label, agent.address)} asks to pay ${what}${memo ? ` for “${memo}”` : ""}.`;

  let blocked: string | null = null;
  if (request.status !== "pending") {
    blocked = "This request is already approved: the agent can now make the payment.";
  } else if (options.checkExpiry && (await readChainTime(chain)) > BigInt(request.expiresAt)) {
    blocked = "This request has expired. The agent has to ask again.";
  }
  return { request, agent, principal, what, story, blocked };
}
