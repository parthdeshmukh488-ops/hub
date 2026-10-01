import { buildFreezePrincipal } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { ActionHttpError } from "./http.ts";
import { isOwnerOrGuardian, loadPrincipal } from "./reads.ts";
import type { ActionDefinition } from "./route-handlers.ts";
import { walletSigner } from "./transaction.ts";

const agents = (count: number) => (count === 1 ? "its 1 agent" : `all ${count} agents`);

/** `freeze-all?owner=`: `freeze_principal`, signed by the owner or the guardian (02 §10). */
export const freezeAllAction: ActionDefinition<"freezeAll"> = {
  name: "freezeAll",
  page: () => "/app",
  async describe({ owner }, { chain }) {
    const principal = await loadPrincipal(chain, owner);
    return {
      title: "Freeze all agents",
      label: "Freeze all",
      description: principal.frozen
        ? "All agents of this owner are already paused. Only the owner can unfreeze them."
        : `Pauses ${agents(principal.agentCount)} of this owner at once, until the owner unfreezes. The owner or the guardian signs.`,
      ...(principal.frozen ? { disabled: true } : {}),
    };
  },
  async build({ owner }, account, { chain }) {
    const principal = await loadPrincipal(chain, owner);
    if (!isOwnerOrGuardian(principal, account)) {
      throw new ActionHttpError(403, "Only the owner or the guardian may freeze all agents.");
    }
    if (principal.frozen) throw new ActionHttpError(409, "All agents are already paused.");
    return {
      instructions: [
        await buildFreezePrincipal({
          authority: walletSigner(account),
          owner: principal.owner as Address,
        }),
      ],
      message: `Pauses ${agents(principal.agentCount)}. Only the owner can unfreeze them.`,
    };
  },
};
