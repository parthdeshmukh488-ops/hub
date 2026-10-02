import { buildFreezeAgent } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { ActionHttpError } from "./http.ts";
import { isOwnerOrGuardian, loadAgent, loadPrincipal } from "./reads.ts";
import type { ActionContext, ActionDefinition } from "./route-handlers.ts";
import { nameOf } from "./text.ts";
import { walletSigner } from "./transaction.ts";

async function load(agentAddress: string, { chain }: ActionContext) {
  const agent = await loadAgent(chain, agentAddress);
  const principal = await loadPrincipal(chain, agent.owner);
  return { agent, principal, name: nameOf(agent.label, agent.address) };
}

/** `freeze?agent=`: `freeze_agent`, signed by the owner or the guardian (02 §10). */
export const freezeAction: ActionDefinition<"freeze"> = {
  name: "freeze",
  page: ({ agent }) => `/app/agents/${agent}`,
  async describe({ agent: address }, context) {
    const { agent, name } = await load(address, context);
    const frozen = agent.status === "frozen";
    return {
      title: `Freeze ${name}`,
      label: "Freeze agent",
      description: frozen
        ? `${name} is already frozen. Only its owner can unfreeze it.`
        : `${name} stops paying anyone until its owner unfreezes it. The owner or the guardian signs.`,
      ...(frozen ? { disabled: true } : {}),
    };
  },
  async build({ agent: address }, account, context) {
    const { agent, principal, name } = await load(address, context);
    if (!isOwnerOrGuardian(principal, account)) {
      throw new ActionHttpError(403, "Only the owner or the guardian of this agent may freeze it.");
    }
    if (agent.status === "frozen") throw new ActionHttpError(409, `${name} is already frozen.`);
    return {
      instructions: [
        await buildFreezeAgent({
          authority: walletSigner(account),
          owner: principal.owner as Address,
          agent: agent.address as Address,
        }),
      ],
      message: `Freezes ${name}. Only the owner can unfreeze it.`,
    };
  },
};
