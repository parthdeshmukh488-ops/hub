/**
 * Onboards the demo owner and agent (laptop queue item 2): the owner signs everything once, with
 * the `research-assistant` preset (02-contracts §11). Resumable: it skips what already exists.
 *
 *   pnpm devnet:setup [--cluster devnet|localnet] [--rpc <url>]
 *
 * Needs .keys/ (`pnpm keys`) and, on devnet, SOL for owner-demo and agent plus devnet USDC for
 * owner-demo (`pnpm devnet:check` prints the faucet steps).
 */
import { formatUsdc, POLICY_PRESETS } from "@leash/contracts";
import type { Address, Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTokenDecoder,
} from "@solana-program/token";
import {
  buildOnboarding,
  fetchAgentView,
  payeeLimitsFromView,
  policyStateFromView,
  readChainTime,
  sendInstructions,
  sendPlan,
} from "../src/index.ts";
import { fail, scriptContext, short, sol } from "./lib.ts";

const ctx = await scriptContext(`Usage: pnpm devnet:setup [--cluster devnet|localnet] [--rpc <url>]

Onboards the demo agent with the research-assistant preset: principal (guardian = .keys/guardian),
agent, a recurring allowance of 5 USDC a day for 30 days, and the merchant on the allowlist. It
also creates USDC accounts for the merchant and the attacker, so blocked payments can be recorded.
Everything is signed by .keys/owner-demo.json and skipped if it already exists.`);
const { chain, keys, mint } = ctx;

const preset = POLICY_PRESETS["research-assistant"];
if (!preset.policy || !preset.allowance) fail("the research-assistant preset is incomplete");

console.log(`Leash setup on ${ctx.cluster.cluster} (${ctx.cluster.rpcUrl})`);
console.log(`  owner  ${keys.owner.address}\n  agent  ${keys.agent.address}\n  mint   ${mint}`);

// 1. Balances: rent for five accounts and fees for the owner; fees and reports for the agent.
const [mintAccount, ownerAccount, agentAccount] = await chain.getAccounts([
  mint,
  keys.owner.address,
  keys.agent.address,
]);
if (!mintAccount?.exists) fail(`The USDC mint ${mint} does not exist on ${ctx.cluster.cluster}.`);
const tokenProgram = mintAccount.programAddress;
const lamportsOf = (account: typeof ownerAccount) => (account?.exists ? account.lamports : 0n);
const missing: string[] = [];
if (lamportsOf(ownerAccount) < 50_000_000n)
  missing.push(`owner-demo needs ≥ 0.05 SOL (has ${sol(lamportsOf(ownerAccount))})`);
if (lamportsOf(agentAccount) < 20_000_000n)
  missing.push(`agent needs ≥ 0.02 SOL (has ${sol(lamportsOf(agentAccount))})`);
if (missing.length > 0) {
  fail(
    `Fund the demo keys first (faucet.solana.com), then run this again:\n  - ${missing.join("\n  - ")}`,
  );
}
const [ownerTokenAccount] = await findAssociatedTokenPda({
  owner: keys.owner.address,
  mint,
  tokenProgram,
});
const [ownerUsdc] = await chain.getAccounts([ownerTokenAccount]);
const usdc = ownerUsdc?.exists ? getTokenDecoder().decode(ownerUsdc.data).amount : 0n;
console.log(`  owner holds ${formatUsdc(usdc)} USDC`);
if (usdc === 0n) {
  console.log("  (no USDC yet: payments will be denied as insufficientFunds; faucet.circle.com)");
}

// 2. USDC accounts for the merchant and the attacker, so payments and blocked attempts land.
const tokenAccounts: Instruction[] = [];
for (const wallet of [keys.merchant.address, keys.attacker.address] as Address[]) {
  const [ata] = await findAssociatedTokenPda({ owner: wallet, mint, tokenProgram });
  const [account] = await chain.getAccounts([ata]);
  if (!account?.exists) {
    tokenAccounts.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: keys.owner,
        owner: wallet,
        mint,
        ata,
        tokenProgram,
      }),
    );
  }
}
if (tokenAccounts.length > 0) {
  const record = await sendInstructions(chain, {
    feePayer: keys.owner,
    instructions: tokenAccounts,
  });
  console.log(`\n✓ USDC accounts for merchant and attacker\n  ${ctx.explorer(record.signature)}`);
}

// 3. Onboarding.
const now = await readChainTime(chain);
const [payee] = preset.payees;
const plan = await buildOnboarding(chain, {
  owner: keys.owner,
  agentKey: keys.agent.address,
  mint,
  label: "Research agent",
  policy: policyStateFromView(preset.policy),
  allowance: {
    kind: "recurring",
    amountPerPeriod: BigInt(preset.allowance.amountPerPeriod),
    periodLengthSecs: BigInt(preset.allowance.periodLengthSecs),
    expiryTs: now + BigInt(preset.allowance.durationSecs),
  },
  payees: payee
    ? [
        {
          payee: keys.merchant.address,
          label: payee.label,
          limits: payeeLimitsFromView(payee.limits),
        },
      ]
    : [],
  guardian: keys.guardian.address,
});
if (plan.transactions.length === 0) {
  console.log("\nAlready onboarded: nothing to send.");
} else {
  const records = await sendPlan(chain, { feePayer: keys.owner, transactions: plan.transactions });
  plan.transactions.forEach((transaction, i) => {
    console.log(`\n✓ ${transaction.purpose}\n  ${ctx.explorer(records[i]?.signature ?? "")}`);
  });
}

// 4. What the program now holds.
const view = await fetchAgentView(chain, plan.agent);
if (!view) fail("The agent account is missing after onboarding.");
console.log(`
Agent ${view.label} (${view.status})
  principal     ${plan.principal}
  agent PDA     ${plan.agent}
  delegation    ${plan.delegation}
  allowance     ${formatUsdc(BigInt(view.allowance?.remaining ?? "0"))} USDC left of ${formatUsdc(BigInt(view.allowance?.amountPerPeriod ?? "0"))} per day${view.allowance?.expiresAt ? `, until ${new Date(view.allowance.expiresAt * 1000).toISOString()}` : ""}
  per payment   ${formatUsdc(BigInt(view.policy.maxPerPayment))} USDC (approval up to ${formatUsdc(BigInt(view.policy.maxPerRequest))})
  allowlist     ${view.payeeCount} payee(s): merchant ${short(keys.merchant.address)}

Next: pnpm devnet:smoke${ctx.cluster.cluster === "localnet" ? " --cluster localnet" : ""}`);
