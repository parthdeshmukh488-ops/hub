import { z } from "zod";

/** Clusters Leash runs on. Mainnet is intentionally absent (02-contracts §2.1). */
export const CLUSTERS = ["localnet", "devnet"] as const;
export const ClusterSchema = z.enum(CLUSTERS);
export type Cluster = z.infer<typeof ClusterSchema>;

/** Base58 Solana address (32 bytes). Checks the alphabet and length, not the curve. */
export const AddressSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "expected a base58 Solana address");

/** Base58 transaction signature (64 bytes). */
export const SignatureSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/, "expected a base58 transaction signature");

/**
 * Placeholder for the Leash program ID until WS1 generates the program keypair.
 * A valid address that no program owns: sha256("leash:program-id-placeholder").
 */
export const LEASH_PROGRAM_ID_PLACEHOLDER = "5ZDkdhcRtUrWLpK4vMx3C3r1w8iZyVaXvXzC5kvtQpM5";

/** Program IDs used by Leash (02-contracts §2.2). */
export const PROGRAM_IDS = {
  leash: LEASH_PROGRAM_ID_PLACEHOLDER,
  subscriptions: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  computeBudget: "ComputeBudget111111111111111111111111111111",
} as const;

/** True while the Leash program ID is still the placeholder. */
export function isLeashProgramIdPlaceholder(programId: string): boolean {
  return programId === LEASH_PROGRAM_ID_PLACEHOLDER;
}

/** PDA seed strings (02-contracts §2.3). Numeric seeds (nonces) are u64 little-endian. */
export const SEEDS = {
  principal: "principal",
  agent: "agent",
  payee: "payee",
  request: "request",
  leashEventAuthority: "__event_authority",
  subscriptionAuthority: "SubscriptionAuthority",
  delegation: "delegation",
  subscriptionsEventAuthority: "event_authority",
} as const;

/** Constants mirrored from the Leash program (01-onchain-program §3). */
export const PROGRAM_CONSTANTS = {
  labelLen: 32,
  memoLen: 64,
  referenceLen: 32,
  maxOpenRequests: 8,
  maxRequestTtlSecs: 604_800,
  accountVersion: 1,
  /** Anchor custom error codes start here; the first 12 are the denials. */
  anchorErrorBase: 6000,
} as const;

/** CAIP-2 network identifiers. */
export const CAIP2 = {
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  /** Reference only: Leash never runs on mainnet. */
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  localnet: "solana:localnet",
} as const;

/** Default local ports (02-contracts §2.4). */
export const DEFAULT_PORTS = {
  web: 3000,
  indexer: 4100,
  facilitator: 4200,
  merchant: 4300,
  sentinel: 4400,
} as const;

export type ClusterConfig = {
  cluster: Cluster;
  rpcUrl: string;
  wsUrl: string;
  /** CAIP-2 network used in x402 requirements. */
  x402Network: string;
  /** USDC mint; null on localnet until `scripts/localnet` has created the mock mint. */
  usdcMint: string | null;
  programIds: {
    leash: string;
    subscriptions: string;
    splToken: string;
    token2022: string;
    associatedToken: string;
    memo: string;
    computeBudget: string;
  };
};

const CLUSTER_DEFAULTS: Record<
  Cluster,
  Pick<ClusterConfig, "rpcUrl" | "wsUrl" | "x402Network" | "usdcMint">
> = {
  localnet: {
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    x402Network: CAIP2.localnet,
    usdcMint: null,
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    wsUrl: "wss://api.devnet.solana.com",
    x402Network: CAIP2.devnet,
    // Circle devnet USDC. WS0's devnet check verifies it before any demo.
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
};

export type ClusterOverrides = {
  rpcUrl?: string | undefined;
  wsUrl?: string | undefined;
  leashProgramId?: string | undefined;
  subscriptionsProgramId?: string | undefined;
  usdcMint?: string | undefined;
};

/**
 * Resolves the configuration for a cluster. Pure: it never reads `process.env`.
 * Apps parse their environment in `src/env.ts` and pass overrides in.
 */
export function resolveClusterConfig(
  cluster: Cluster,
  overrides: ClusterOverrides = {},
): ClusterConfig {
  const defaults = CLUSTER_DEFAULTS[cluster];
  return {
    cluster,
    rpcUrl: overrides.rpcUrl ?? defaults.rpcUrl,
    wsUrl: overrides.wsUrl ?? defaults.wsUrl,
    x402Network: defaults.x402Network,
    usdcMint: overrides.usdcMint ?? defaults.usdcMint,
    programIds: {
      ...PROGRAM_IDS,
      leash: overrides.leashProgramId ?? PROGRAM_IDS.leash,
      subscriptions: overrides.subscriptionsProgramId ?? PROGRAM_IDS.subscriptions,
    },
  };
}

function explorerQuery(config: ClusterConfig): string {
  if (config.cluster === "devnet") return "?cluster=devnet";
  return `?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`;
}

/** Solana Explorer link for a transaction. */
export function explorerTxUrl(config: ClusterConfig, signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${explorerQuery(config)}`;
}

/** Solana Explorer link for an account. */
export function explorerAddressUrl(config: ClusterConfig, address: string): string {
  return `https://explorer.solana.com/address/${address}${explorerQuery(config)}`;
}

export type EnvVarSpec = {
  name: string;
  usedBy: readonly string[];
  /** Default as written in `.env.example`; empty when the variable has no default. */
  example: string;
  description: string;
  /** Holds a path to a keypair file. */
  keypairPath?: true;
};

/**
 * Every environment variable in the system (02-contracts §13). `.env.example`
 * is generated from this list (`pnpm env:example`) and checked in CI.
 */
export const ENV_VARS: readonly EnvVarSpec[] = [
  {
    name: "LEASH_CLUSTER",
    usedBy: ["all"],
    example: "localnet",
    description: "localnet or devnet",
  },
  {
    name: "LEASH_RPC_URL",
    usedBy: ["all"],
    example: "",
    description: "Override the RPC URL (e.g. a Helius devnet URL)",
  },
  {
    name: "LEASH_WS_URL",
    usedBy: ["all"],
    example: "",
    description: "Override the RPC WebSocket URL",
  },
  {
    name: "LEASH_PROGRAM_ID",
    usedBy: ["all"],
    example: "",
    description: "Override the Leash program ID",
  },
  {
    name: "LEASH_SUBSCRIPTIONS_PROGRAM_ID",
    usedBy: ["all"],
    example: "",
    description: "Override for a devnet fallback deployment of Subscriptions",
  },
  {
    name: "LEASH_USDC_MINT",
    usedBy: ["all"],
    example: "",
    description: "Override the USDC mint",
  },
  {
    name: "LEASH_PRIORITY_FEE_MICROLAMPORTS",
    usedBy: ["sdk", "x402"],
    example: "1",
    description: "Compute unit price for Leash transactions (max 50000)",
  },
  { name: "LOG_LEVEL", usedBy: ["services"], example: "info", description: "pino log level" },
  { name: "INDEXER_PORT", usedBy: ["indexer"], example: "4100", description: "HTTP port" },
  {
    name: "INDEXER_DB_URL",
    usedBy: ["indexer"],
    example: "file:./data/indexer.db",
    description: "libSQL URL",
  },
  {
    name: "INDEXER_SOURCE",
    usedBy: ["indexer"],
    example: "chain",
    description: "chain, or fixtures to replay the demo storyline without a chain",
  },
  {
    name: "INDEXER_BACKFILL_LIMIT",
    usedBy: ["indexer"],
    example: "1000",
    description: "Signatures fetched at startup",
  },
  {
    name: "INDEXER_POLL_INTERVAL_MS",
    usedBy: ["indexer"],
    example: "15000",
    description: "Backfill polling interval (covers WebSocket gaps)",
  },
  {
    name: "WEB_ORIGIN",
    usedBy: ["indexer", "facilitator"],
    example: "http://localhost:3000",
    description: "Allowed CORS origin",
  },
  { name: "FACILITATOR_PORT", usedBy: ["facilitator"], example: "4200", description: "HTTP port" },
  {
    name: "FACILITATOR_FEE_PAYER_KEYPAIR",
    usedBy: ["facilitator"],
    example: ".keys/facilitator.json",
    description: "Path to the fee-payer keypair (pays SOL network fees only)",
    keypairPath: true,
  },
  { name: "MERCHANT_PORT", usedBy: ["merchant-demo"], example: "4300", description: "HTTP port" },
  {
    name: "MERCHANT_PAY_TO",
    usedBy: ["merchant-demo"],
    example: "",
    description: "Merchant wallet address that receives payments",
  },
  {
    name: "MERCHANT_FACILITATOR_URL",
    usedBy: ["merchant-demo"],
    example: "http://localhost:4200",
    description: "Facilitator used by the merchant",
  },
  {
    name: "MERCHANT_PAYMENTS",
    usedBy: ["merchant-demo"],
    example: "on",
    description: "off serves paid routes for free (development before the x402 layer is ready)",
  },
  {
    name: "LAB_ATTACKER_WALLET",
    usedBy: ["merchant-demo"],
    example: "",
    description: "Wallet address the adversarial lab tries to get paid",
  },
  {
    name: "SENTINEL_INDEXER_URL",
    usedBy: ["sentinel"],
    example: "http://localhost:4100",
    description: "Indexer base URL",
  },
  {
    name: "SENTINEL_GUARDIAN_KEYPAIR",
    usedBy: ["sentinel"],
    example: ".keys/guardian.json",
    description: "Path to the guardian keypair (can only freeze and reject)",
    keypairPath: true,
  },
  {
    name: "SENTINEL_AUTOFREEZE",
    usedBy: ["sentinel"],
    example: "false",
    description: "Allow rule-triggered guardian freezes",
  },
  {
    name: "SENTINEL_WEB_URL",
    usedBy: ["sentinel"],
    example: "http://localhost:3000",
    description: "Web app URL used in alert links",
  },
  {
    name: "TELEGRAM_BOT_TOKEN",
    usedBy: ["sentinel"],
    example: "",
    description: "Telegram bot token; alerts are only logged if unset",
  },
  {
    name: "TELEGRAM_CHAT_ID",
    usedBy: ["sentinel"],
    example: "",
    description: "Telegram chat that receives alerts",
  },
  {
    name: "AGENT_KEYPAIR",
    usedBy: ["agent-demo", "mcp"],
    example: "~/.config/leash/agent.json",
    description: "Path to the agent keypair; created on first run if missing",
    keypairPath: true,
  },
  {
    name: "AGENT_OWNER",
    usedBy: ["agent-demo", "mcp"],
    example: "",
    description: "Owner wallet address whose principal holds this agent",
  },
  {
    name: "AGENT_MODE",
    usedBy: ["agent-demo"],
    example: "llm",
    description: "llm (Claude) or scripted (deterministic replay)",
  },
  {
    name: "AGENT_MODEL",
    usedBy: ["agent-demo"],
    example: "claude-opus-5-5",
    description: "Claude model ID for the demo agent",
  },
  {
    name: "ANTHROPIC_API_KEY",
    usedBy: ["agent-demo"],
    example: "",
    description: "Anthropic API key (demo agent, LLM mode only)",
  },
  {
    name: "AGENT_MERCHANT_URL",
    usedBy: ["agent-demo"],
    example: "http://localhost:4300",
    description: "Base URL of the demo merchant",
  },
  {
    name: "NEXT_PUBLIC_LEASH_CLUSTER",
    usedBy: ["web"],
    example: "localnet",
    description: "Cluster shown and used by the web app",
  },
  {
    name: "NEXT_PUBLIC_RPC_URL",
    usedBy: ["web"],
    example: "",
    description: "Browser RPC URL (defaults per cluster)",
  },
  {
    name: "NEXT_PUBLIC_INDEXER_URL",
    usedBy: ["web"],
    example: "http://localhost:4100",
    description: "Indexer REST base URL",
  },
  {
    name: "NEXT_PUBLIC_INDEXER_WS_URL",
    usedBy: ["web"],
    example: "ws://localhost:4100/v1/stream",
    description: "Indexer WebSocket URL",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    usedBy: ["web"],
    example: "http://localhost:3000",
    description: "Public URL of the web app (pairing and Action links)",
  },
  {
    name: "NEXT_PUBLIC_DATA_SOURCE",
    usedBy: ["web"],
    example: "indexer",
    description: "indexer, or fixtures to build the UI without any backend",
  },
];
