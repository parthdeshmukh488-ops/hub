import { buildRejectRequest } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { ActionHttpError } from "./http.ts";
import { isOwnerOrGuardian } from "./reads.ts";
import { loadRequestContext } from "./request.ts";
import type { ActionDefinition } from "./route-handlers.ts";
import { walletSigner } from "./transaction.ts";

/** `reject?request=`: `reject_request`, signed by the owner or the guardian (02 §10, 01 §6.1). */
export const rejectAction: ActionDefinition<"reject"> = {
  name: "reject",
  page: () => "/app/approvals",
  async describe({ request }, { chain }) {
    const context = await loadRequestContext(chain, request, "reject");
    return {
      title: `Reject ${context.what}`,
      label: "Reject",
      description: context.approved
        ? `${context.story} It is approved but not paid yet: rejecting withdraws the approval. The owner or the guardian can reject it.`
        : `${context.story} The owner or the guardian can reject it.`,
    };
  },
  async build({ request }, account, { chain }) {
    const context = await loadRequestContext(chain, request, "reject");
    if (!isOwnerOrGuardian(context.principal, account)) {
      throw new ActionHttpError(
        403,
        "Only the owner or the guardian can reject a payment request.",
      );
    }
    return {
      instructions: [
        await buildRejectRequest({
          authority: walletSigner(account),
          owner: context.principal.owner as Address,
          agent: context.agent.address as Address,
          request: context.request.address as Address,
          // The rent goes back to whoever paid for the request (the agent key).
          rentReceiver: context.request.rentPayer as Address,
        }),
      ],
      message: context.approved
        ? `Withdraws the approval of ${context.what}. The agent can no longer make this payment.`
        : `Rejects ${context.what}. The agent is told no.`,
    };
  },
};
