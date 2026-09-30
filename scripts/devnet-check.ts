/**
 * Checks what the devnet demo depends on (WS0 step 4), read-only:
 *
 * 1. the Solana Foundation Subscriptions program is deployed and executable at its canonical ID;
 * 2. the devnet USDC mint exists (SPL Token, 6 decimals);
 * 3. whether the Leash program is deployed yet (informational);
 * 4. the SOL and USDC balances of the demo keys in .keys/, with faucet steps for what is missing.
 *
 *   pnpm devnet:check [--rpc <url>]
 *
 * Exits 1 when a dependency (1 or 2) is missing; low balances only print what to fund.
 */
import { existsSync } from "node:fs";
import { formatUsdc, PROGRAM_IDS, resolveClusterConfig } from "@leash/contracts";
import { DEMO_KEYS, keyPath, readKeypairAddress } from "./lib/keypairs.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm devnet:check [--rpc <url>]

Read-only checks against devnet: the Subscriptions program, the USDC mint, the Leash program,
and the SOL and USDC balances of the demo keys in .keys/ (create them with \`pnpm keys\`).
--rpc overrides the RPC URL (default https://api.devnet.solana.com).`);
  process.exit(0);
}
const rpcIndex = args.indexOf("--rpc");
const rpcOverride = rpcIndex >= 0 ? args[rpcIndex + 1] : undefined;
if (rpcIndex >= 0 && !rpcOverride) {
  console.error("--rpc needs a URL");
  process.exit(2);
}
const config = resolveClusterConfig("devnet", { rpcUrl: rpcOverride });
const usdcMint = config.usdcMint;
if (!usdcMint) throw new Error("the devnet config has no USDC mint");

const LAMPORTS_PER_SOL = 1_000_000_000n;
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

type ParsedAccount = {
  lamports: number;
  owner: string;
  executable: boolean;
  data: { parsed?: { type?: string; info?: Record<string, unknown> } } | [string, string];
};

let requestId = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function account(address: string): Promise<ParsedAccount | null> {
  const result = await rpc<{ value: ParsedAccount | null }>("getAccountInfo", [
    address,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  return result.value;
}

function parsedInfo(value: ParsedAccount | null): Record<string, unknown> | undefined {
  return value && !Array.isArray(value.data) ? value.data.parsed?.info : undefined;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-5)}`;
const sol = (lamports: bigint) =>
  `${lamports / LAMPORTS_PER_SOL}.${(lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, 3)}`;

let missingDependency = false;
const ok = (line: string) => console.log(`  ok    ${line}`);
const bad = (line: string) => {
  missingDependency = true;
  console.log(`  FAIL  ${line}`);
};

/** An upgradeable program: whether it is deployed, and its last deployment slot. */
async function program(label: string, address: string, required: boolean) {
  const value = await account(address);
  if (!value) {
    if (required) bad(`${label} ${address}: not deployed on devnet`);
    else console.log(`  --    ${label} ${address}: not deployed yet`);
    return;
  }
  if (!value.executable) {
    bad(`${label} ${address}: the account exists but is not executable`);
    return;
  }
  const programData = parsedInfo(value)?.programData;
  const slot =
    value.owner === UPGRADEABLE_LOADER && typeof programData === "string"
      ? parsedInfo(await account(programData))?.slot
      : undefined;
  ok(
    `${label} ${address}: executable${slot === undefined ? "" : `, last deployed in slot ${slot}`}`,
  );
}

console.log(`Leash devnet check (${config.rpcUrl})\n\nPrograms`);
await program("Subscriptions", PROGRAM_IDS.subscriptions, true);
await program("Leash        ", config.programIds.leash, false);

console.log("\nMint");
const mint = await account(usdcMint);
const mintInfo = parsedInfo(mint);
if (!mint) bad(`USDC ${usdcMint}: not found`);
else if (mint.owner !== PROGRAM_IDS.splToken) bad(`USDC ${usdcMint}: not an SPL Token mint`);
else if (mintInfo?.decimals !== 6)
  bad(`USDC ${usdcMint}: ${String(mintInfo?.decimals)} decimals, expected 6`);
else ok(`USDC ${usdcMint}: SPL Token, 6 decimals`);

console.log("\nDemo keys (.keys/)");
const needs: { name: string; address: string; what: string }[] = [];
const NEEDS_SOL = new Set(["owner-demo", "agent", "guardian", "facilitator"]);
for (const key of DEMO_KEYS) {
  const path = keyPath(key.name);
  if (!existsSync(path)) {
    console.log(`  --    ${key.name.padEnd(12)} missing: run \`pnpm keys\``);
    continue;
  }
  const address = readKeypairAddress(path);
  const lamports = BigInt(
    (await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }])).value,
  );
  const tokens = await rpc<{
    value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
  }>("getTokenAccountsByOwner", [
    address,
    { mint: usdcMint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const usdc = tokens.value.reduce(
    (sum, t) => sum + BigInt(t.account.data.parsed.info.tokenAmount.amount),
    0n,
  );
  const usdcText = tokens.value.length === 0 ? "no USDC account" : `${formatUsdc(usdc)} USDC`;
  console.log(
    `  ${key.name.padEnd(12)} ${short(address)}  ${sol(lamports).padStart(10)} SOL  ${usdcText}`,
  );
  if (NEEDS_SOL.has(key.name) && lamports < LAMPORTS_PER_SOL / 2n) {
    needs.push({ name: key.name, address, what: "SOL" });
  }
  if (key.name === "owner-demo" && usdc === 0n) {
    needs.push({ name: key.name, address, what: "USDC" });
  }
}

if (needs.length > 0) {
  console.log("\nTo fund (devnet only, free):");
  for (const need of needs) {
    if (need.what === "SOL") {
      console.log(
        `  ${need.name}: solana airdrop 1 ${need.address} --url devnet   (or https://faucet.solana.com)`,
      );
    } else {
      console.log(`  ${need.name}: https://faucet.circle.com → Solana Devnet → ${need.address}`);
    }
  }
}
console.log(
  missingDependency ? "\nA devnet dependency is missing." : "\nDevnet dependencies are in place.",
);
process.exit(missingDependency ? 1 : 0);
