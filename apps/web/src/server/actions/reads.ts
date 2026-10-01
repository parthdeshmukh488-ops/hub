import type { AgentView, PrincipalView } from "@leash/contracts";
import { fetchAgentView, fetchPrincipalView, type LeashChain } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { ActionHttpError } from "./http.ts";

// Chain reads through @leash/sdk, with the 404s an Action answers when an account is missing.

export async function loadAgent(chain: LeashChain, agent: string): Promise<AgentView> {
  const view = await fetchAgentView(chain, agent as Address);
  if (!view) throw new ActionHttpError(404, "No Leash agent at this address.");
  return view;
}

export async function loadPrincipal(chain: LeashChain, owner: string): Promise<PrincipalView> {
  const view = await fetchPrincipalView(chain, owner as Address);
  if (!view) throw new ActionHttpError(404, "This owner has no Leash principal.");
  return view;
}

/** The owner or the principal's guardian (01 §6.1: freeze and reject). */
export function isOwnerOrGuardian(principal: PrincipalView, account: string): boolean {
  return (
    account === principal.owner || (principal.guardian !== null && account === principal.guardian)
  );
}
