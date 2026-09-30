import type { ClusterConfig } from "@leash/contracts";
import { LeashAgent, type LeashAgentOptions, type LeashChain, rpcChain } from "@leash/sdk";
import { createLeashFetch } from "@leash/x402";
import { address, createSolanaRpc, type TransactionSigner } from "@solana/kit";
import { createLeashTools, type LeashTools } from "../create-leash-tools.ts";
import type { LeashFetchPort } from "../ports.ts";

type Network = Parameters<typeof createLeashFetch>[0]["network"];

export type ConnectLeashOptions = {
  cluster: ClusterConfig;
  /** The agent key. It signs and pays the fees of the agent's own transactions. */
  signer: TransactionSigner;
  /** The owner wallet whose principal holds this agent (`AGENT_OWNER`). */
  owner: string;
  /** `LEASH_PRIORITY_FEE_MICROLAMPORTS`; default 1. */
  priorityFeeMicroLamports?: bigint;
  /** Default: `rpcChain` on `cluster.rpcUrl`. Tests pass the LiteSVM chain. */
  chain?: LeashChain;
  /** The HTTP fetch under x402. Default: the global one. */
  fetch?: typeof globalThis.fetch;
  /** SDK warnings (failed reports, a low SOL balance). Default: `console`. */
  logger?: LeashAgentOptions["logger"];
  /** Put into NOT_PAIRED tool messages (see `createLeashTools`). */
  pairingLink?: string;
};

/** Everything an agent runtime needs, wired together. */
export type LeashRuntime = {
  cluster: ClusterConfig;
  chain: LeashChain;
  agent: LeashAgent;
  leashFetch: LeashFetchPort;
  tools: LeashTools;
};

/**
 * Wires the real implementations behind the tool ports: `rpcChain` → `LeashAgent` (WS2) →
 * `createLeashFetch` (WS3) → the four tools. Nothing is read from the chain until a tool runs.
 */
export function connectLeash(options: ConnectLeashOptions): LeashRuntime {
  const { cluster, signer, priorityFeeMicroLamports: fee, logger } = options;
  const chain = options.chain ?? rpcChain({ rpc: createSolanaRpc(cluster.rpcUrl) });
  const agent = new LeashAgent({
    chain,
    signer,
    owner: address(options.owner),
    ...(fee === undefined ? {} : { priorityFeeMicroLamports: fee }),
    ...(logger ? { logger } : {}),
  });
  const leashFetch = createLeashFetch({
    agent,
    chain,
    network: cluster.x402Network as Network,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(fee === undefined ? {} : { priorityFeeMicroLamports: fee }),
  });
  const tools = createLeashTools({
    agent,
    leashFetch,
    cluster,
    ...(options.pairingLink ? { pairingLink: options.pairingLink } : {}),
  });
  return { cluster, chain, agent, leashFetch, tools };
}
