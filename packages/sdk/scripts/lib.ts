// Shared by devnet-setup.ts and devnet-smoke.ts: flags, cluster, demo keys and a LeashChain.
// Scripts read flags only, never the environment (04-conventions: only src/env.ts reads it).

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ClusterConfig, explorerTxUrl, resolveClusterConfig } from "@leash/contracts";
import {
  type Address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type KeyPairSigner,
} from "@solana/kit";
import { type LeashChain, rpcChain } from "../src/index.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export type DemoKeys = {
  owner: KeyPairSigner;
  agent: KeyPairSigner;
  merchant: KeyPairSigner;
  attacker: KeyPairSigner;
  guardian: KeyPairSigner;
};

export type ScriptContext = {
  cluster: ClusterConfig;
  mint: Address;
  chain: LeashChain;
  keys: DemoKeys;
  flags: Set<string>;
  explorer: (signature: string) => string;
};

export function fail(message: string, code = 1): never {
  console.error(`\n${message}`);
  process.exit(code);
}

async function readKey(name: string): Promise<KeyPairSigner> {
  const path = `${ROOT}.keys/${name}.json`;
  if (!existsSync(path)) fail(`Missing ${path}. Create the demo keys with \`pnpm keys\`.`, 2);
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

/** Parses `--cluster devnet|localnet` and `--rpc <url>`, loads the keys, connects. */
export async function scriptContext(usage: string): Promise<ScriptContext> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const next = args[i + 1];
    if (!next || next.startsWith("--")) fail(`${flag} needs a value`, 2);
    return next;
  };
  const clusterName = value("--cluster") ?? "devnet";
  if (clusterName !== "devnet" && clusterName !== "localnet") {
    fail("--cluster is devnet or localnet (never mainnet)", 2);
  }
  let cluster: ClusterConfig;
  if (clusterName === "localnet") {
    const file = `${ROOT}.localnet.json`;
    if (!existsSync(file))
      fail("No .localnet.json: start the local chain with `pnpm localnet`.", 2);
    const local = JSON.parse(readFileSync(file, "utf8")) as { rpcUrl: string; usdcMint: string };
    cluster = resolveClusterConfig("localnet", {
      rpcUrl: value("--rpc") ?? local.rpcUrl,
      usdcMint: local.usdcMint,
    });
  } else {
    cluster = resolveClusterConfig("devnet", { rpcUrl: value("--rpc") });
  }
  if (!cluster.usdcMint) fail(`No USDC mint configured for ${cluster.cluster}.`, 2);
  const keys: DemoKeys = {
    owner: await readKey("owner-demo"),
    agent: await readKey("agent"),
    merchant: await readKey("merchant"),
    attacker: await readKey("attacker"),
    guardian: await readKey("guardian"),
  };
  return {
    cluster,
    mint: cluster.usdcMint as Address,
    chain: rpcChain({ rpc: createSolanaRpc(cluster.rpcUrl) }),
    keys,
    flags: new Set(args.filter((a) => a.startsWith("--"))),
    explorer: (signature) => explorerTxUrl(cluster, signature),
  };
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export const sol = (lamports: bigint) =>
  `${lamports / LAMPORTS_PER_SOL}.${(lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, 4)} SOL`;

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-5)}`;
