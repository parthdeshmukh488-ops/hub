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
  /** Approved but not paid yet (reject then withdraws the approval). */
  approved: boolean;
}

export async function loadRequestContext(
  chain: LeashChain,
  address: string,
  /**
   * approve: pending and not expired (01 §6.1). reject: any open request, approved ones
   * included (rejecting withdraws the approval before the agent pays).
   */
  action: "approve" | "reject",
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

  const approved = request.status === "approved";
  let blocked: string | null = null;
  if (action === "approve") {
    if (approved) {
      blocked = "This request is already approved: the agent can now make the payment.";
    } else if ((await readChainTime(chain)) >= BigInt(request.expiresAt)) {
      // The program's is_expired is `now >= expires_at`: at that second it refuses approval.
      blocked = "This request has expired. The agent has to ask again.";
    }
  }
  return { request, agent, principal, what, story, blocked, approved };
}
