/**
 * Proves the SDK against the real chain (laptop queue item 2), after `pnpm devnet:setup`:
 *
 * 1. an allowed payment to the merchant goes through, and its receipt comes from `PaymentExecuted`;
 * 2. a payment above the instant limit needs approval and is not recorded;
 * 3. a payment to the attacker is blocked and recorded on-chain as a strike (skipped when one more
 *    strike would freeze the agent, unless --allow-freeze).
 *
 *   pnpm devnet:smoke [--cluster devnet|localnet] [--rpc <url>] [--allow-freeze]
 *
 * Exits 1 if anything behaves differently.
 */
import { formatUsdc } from "@leash/contracts";
import { LeashAgent, PaymentDeniedError } from "../src/index.ts";
import { fail, scriptContext } from "./lib.ts";

const ctx =
  await scriptContext(`Usage: pnpm devnet:smoke [--cluster devnet|localnet] [--rpc <url>] [--allow-freeze]

Runs LeashAgent against the program: one allowed payment (0.01 USDC to the merchant), one that
needs approval (2 USDC), one blocked (0.01 USDC to the attacker, a strike). Signed by .keys/agent.json.`);
const { keys } = ctx;

const agent = new LeashAgent({ chain: ctx.chain, signer: keys.agent, owner: keys.owner.address });
const before = await agent.status();
const { allowance, stats, policy } = before.agent;
console.log(
  `Leash smoke test on ${ctx.cluster.cluster}: ${before.agent.label} (${before.agent.status})`,
);
console.log(
  `  allowance left ${formatUsdc(BigInt(allowance?.remaining ?? "0"))} USDC, strikes ${stats.strikes}/${policy.tripwireMaxStrikes}`,
);
if (before.agent.status === "frozen" || before.principal.frozen) {
  fail(
    `The agent is frozen (${before.agent.freezeReason}). The owner unfreezes it in the web app, then run this again.`,
  );
}

let failures = 0;
const check = (ok: boolean, line: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${line}`);
  if (!ok) failures += 1;
};

// 1. Allowed.
const receipt = await agent.pay({
  to: keys.merchant.address,
  amount: 10_000n,
  purpose: "Leash smoke test",
});
check(
  receipt.amount === 10_000n && receipt.payee === keys.merchant.address,
  `paid 0.01 USDC to the merchant: ${ctx.explorer(receipt.signature)}`,
);

// 2. Above the instant limit: approval required, never recorded.
const approval = await agent
  .pay({ to: keys.merchant.address, amount: 2_000_000n, purpose: "Leash smoke test: large" })
  .then(
    () => null,
    (error: unknown) => error,
  );
check(
  approval instanceof PaymentDeniedError &&
    approval.reason === "approvalRequired" &&
    !approval.recorded,
  "2 USDC needs the owner's approval (not recorded)",
);

// 3. Blocked and recorded.
const strikesLeft = policy.tripwireMaxStrikes - stats.strikes;
if (strikesLeft <= 1 && !ctx.flags.has("--allow-freeze")) {
  console.log(
    `  skip  the blocked payment: one more strike would freeze the agent (--allow-freeze to run it)`,
  );
} else {
  const blocked = await agent
    .pay({ to: keys.attacker.address, amount: 10_000n, purpose: "Leash smoke test: blocked" })
    .then(
      () => null,
      (error: unknown) => error,
    );
  check(
    blocked instanceof PaymentDeniedError &&
      blocked.reason === "payeeNotAllowed" &&
      blocked.recorded,
    `0.01 USDC to the attacker blocked and recorded (strike ${blocked instanceof PaymentDeniedError ? blocked.strikes : "?"})`,
  );
}

const after = await agent.status();
console.log(
  `  allowance left ${formatUsdc(BigInt(after.agent.allowance?.remaining ?? "0"))} USDC, payments ${after.agent.stats.paymentsCount}, denied ${after.agent.stats.deniedCount}`,
);
if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("\nSmoke test passed.");
