/**
 * The preflight before each take of the demo: funds, the demo world (frozen? leftover strikes?
 * allowance and payee budget left? old requests?) and the services the take needs. Read-only:
 * it sends nothing. Every problem comes with the command that fixes it.
 *
 *   pnpm demo:check [--cluster devnet|localnet] [--rpc <url>] [--no-services]
 *
 * Reads flags and .keys/ only, never the environment. Devnet and localnet only.
 */
import { existsSync } from "node:fs";
import type { Address } from "@solana/kit";
import { type Check, checkReadiness, LOCAL_SERVICES } from "./demo-readiness.ts";
import { ROOT, readKey, scriptContext } from "./lib.ts";

const USAGE = `pnpm demo:check [--cluster devnet|localnet] [--rpc <url>] [--no-services]

Checks everything a take of the demo storyline needs: SOL and USDC on the demo keys, the
demo agent (not frozen, no strikes that still count, allowance and payee budget left, no
old requests), and the facilitator, merchant, indexer, Sentinel and web app on their
default local ports (--no-services skips those). Sends nothing.`;

const ctx = await scriptContext(USAGE);
const { keys } = ctx;
const feePayers: { name: string; address: Address; minLamports: bigint }[] = [
  { name: "owner-demo", address: keys.owner.address, minLamports: 10_000_000n },
  { name: "agent", address: keys.agent.address, minLamports: 20_000_000n },
  { name: "guardian", address: keys.guardian.address, minLamports: 1_000_000n },
];
if (existsSync(`${ROOT}.keys/facilitator.json`)) {
  const facilitator = await readKey("facilitator");
  feePayers.push({ name: "facilitator", address: facilitator.address, minLamports: 10_000_000n });
}

const checks = await checkReadiness({
  chain: ctx.chain,
  cluster: ctx.cluster.cluster === "devnet" ? "devnet" : "localnet",
  owner: keys.owner.address,
  agentKey: keys.agent.address,
  merchant: keys.merchant.address,
  mint: ctx.mint,
  feePayers,
  services: ctx.flags.has("--no-services") ? null : { fetch, urls: LOCAL_SERVICES },
});

const tty = process.stdout.isTTY;
const paint = (code: number, text: string) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const MARK: Record<Check["level"], string> = {
  ok: paint(32, "✓"),
  warn: paint(33, "⚠"),
  fail: paint(31, "✗"),
};
console.log(`Demo preflight on ${ctx.cluster.cluster}\n`);
for (const check of checks) {
  console.log(`  ${MARK[check.level]} ${check.name}: ${check.detail}`);
  if (check.level !== "ok" && check.fix) console.log(`      → ${check.fix}`);
}
const failed = checks.filter((c) => c.level === "fail").length;
const warned = checks.filter((c) => c.level === "warn").length;
console.log(
  failed > 0
    ? `\n${paint(31, `${failed} problem(s)`)}: fix them before the take.`
    : `\n${paint(32, "Ready for a take.")}${warned > 0 ? ` (${warned} warning(s) above)` : ""}`,
);
process.exit(failed > 0 ? 1 : 0);
