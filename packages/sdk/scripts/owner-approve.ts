/**
 * The owner's phone, until the web app (WS6) and Telegram (WS5) can approve: approves every pending
 * payment request of the demo agent, signed with the owner-demo key, or rejects them with
 * `--reject`. The demo agent's approval scene waits for exactly this.
 *
 *   pnpm owner:approve [--cluster devnet|localnet] [--rpc <url>] [--reject]
 *
 * Reads flags and .keys/ only, never the environment. Devnet and localnet only.
 */
import { formatUsdc } from "@leash/contracts";
import { address } from "@solana/kit";
import {
  buildApproveRequest,
  buildRejectRequest,
  fetchOpenRequests,
  findAgentPda,
  findPrincipalPda,
  sendInstructions,
} from "../src/index.ts";
import { scriptContext, short } from "./lib.ts";

const USAGE = `pnpm owner:approve [--cluster devnet|localnet] [--rpc <url>] [--reject]

Approves (or with --reject, rejects) every pending payment request of the demo agent
(.keys/agent.json), signed by the owner (.keys/owner-demo.json).`;

const ctx = await scriptContext(USAGE);
const reject = ctx.flags.has("--reject");
const owner = ctx.keys.owner;
const agent = await findAgentPda(await findPrincipalPda(owner.address), ctx.keys.agent.address);
const pending = (await fetchOpenRequests(ctx.chain, agent)).filter(
  (request) => request.status === "pending",
);
if (pending.length === 0) console.log(`No pending payment requests for agent ${short(agent)}.`);
for (const request of pending) {
  const instruction = reject
    ? await buildRejectRequest({
        authority: owner,
        owner: owner.address,
        agent,
        request: address(request.address),
        rentReceiver: address(request.rentPayer),
      })
    : await buildApproveRequest({ owner, agent, request: address(request.address) });
  const record = await sendInstructions(ctx.chain, {
    feePayer: owner,
    instructions: [instruction],
  });
  console.log(
    `${reject ? "Rejected" : "Approved"} ${formatUsdc(BigInt(request.amount))} USDC to ${short(request.payee)} ` +
      `(request ${short(request.address)}, memo "${request.memo.replace(/[^\x20-\x7e]/g, "?")}")\n  ${ctx.explorer(record.signature)}`,
  );
}
