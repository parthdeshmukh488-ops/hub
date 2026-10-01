/**
 * The owner unfreezes the demo agent (and the principal, if it is paused), until the web app (WS6)
 * can: after a take of the demo storyline, which ends with the tripwire. Unfreezing also clears
 * the strikes. An active agent with leftover strikes (from `x402:smoke`, say) is frozen and
 * unfrozen in one transaction, because `unfreeze_agent` leaves an active agent's strikes alone
 * (01 §6). Signed with the owner-demo key.
 *
 *   pnpm owner:unfreeze [--cluster devnet|localnet] [--rpc <url>]
 *
 * Reads flags and .keys/ only, never the environment. Devnet and localnet only.
 */
import {
  buildFreezeAgent,
  buildUnfreezeAgent,
  buildUnfreezePrincipal,
  fetchAgentView,
  fetchPrincipalView,
  findAgentPda,
  findPrincipalPda,
  sendInstructions,
} from "../src/index.ts";
import { scriptContext, short } from "./lib.ts";

const USAGE = `pnpm owner:unfreeze [--cluster devnet|localnet] [--rpc <url>]

Unfreezes the demo agent (.keys/agent.json) and, if paused, all agents of the owner
(.keys/owner-demo.json), which signs.`;

const ctx = await scriptContext(USAGE);
const owner = ctx.keys.owner;
const agent = await findAgentPda(await findPrincipalPda(owner.address), ctx.keys.agent.address);
const principal = await fetchPrincipalView(ctx.chain, owner.address);
const view = await fetchAgentView(ctx.chain, agent);
if (!principal || !view) {
  console.error(`The demo agent ${short(agent)} is not paired. Run \`pnpm devnet:setup\` first.`);
  process.exit(2);
}
const frozen = view.status === "frozen";
const leftoverStrikes = !frozen && view.stats.strikes > 0;
const instructions = [
  ...(principal.frozen ? [await buildUnfreezePrincipal({ owner })] : []),
  ...(leftoverStrikes
    ? [await buildFreezeAgent({ authority: owner, owner: owner.address, agent })]
    : []),
  ...(frozen || leftoverStrikes ? [await buildUnfreezeAgent({ owner, agent })] : []),
];
const done = [
  principal.frozen ? "unfroze the principal" : "",
  frozen ? `unfroze agent ${short(agent)} (${view.freezeReason})` : "",
  leftoverStrikes
    ? `cleared ${view.stats.strikes} leftover strike(s) of agent ${short(agent)}`
    : "",
].filter(Boolean);
if (instructions.length === 0) {
  console.log(`Agent ${short(agent)} is active with no strikes; nothing to do.`);
} else {
  const record = await sendInstructions(ctx.chain, { feePayer: owner, instructions });
  console.log(`The owner ${done.join(", ")}.\n  ${ctx.explorer(record.signature)}`);
}
