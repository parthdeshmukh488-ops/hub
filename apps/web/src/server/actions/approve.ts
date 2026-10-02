import { buildApproveRequest } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { ActionHttpError } from "./http.ts";
import { loadRequestContext } from "./request.ts";
import type { ActionDefinition } from "./route-handlers.ts";
import { walletSigner } from "./transaction.ts";

/** `approve?request=`: `approve_request`, signed by the owner only (02 §10, 01 §6.1). */
export const approveAction: ActionDefinition<"approve"> = {
  name: "approve",
  page: () => "/app/approvals",
  async describe({ request }, { chain }) {
    const context = await loadRequestContext(chain, request, { checkExpiry: true });
    return {
      title: `Approve ${context.what}`,
      label: "Approve",
      description:
        context.blocked ?? `${context.story} Only the owner can approve; the agent then pays once.`,
      ...(context.blocked ? { disabled: true } : {}),
    };
  },
  async build({ request }, account, { chain }) {
    const context = await loadRequestContext(chain, request, { checkExpiry: true });
    if (account !== context.principal.owner) {
      throw new ActionHttpError(403, "Only the owner can approve a payment request.");
    }
    if (context.blocked) throw new ActionHttpError(409, context.blocked);
    return {
      instructions: [
        await buildApproveRequest({
          owner: walletSigner(account),
          agent: context.agent.address as Address,
          request: context.request.address as Address,
        }),
      ],
      message: `Approves ${context.what}. The agent can then make this one payment.`,
    };
  },
};
