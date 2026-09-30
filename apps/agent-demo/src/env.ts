import { AddressSchema, ClusterSchema } from "@leash/contracts";
import { z } from "zod";

// The demo agent's configuration (02-contracts §13). Only `loadEnv` reads process.env.

const EnvSchema = z.object({
  LEASH_CLUSTER: ClusterSchema.default("localnet"),
  LEASH_RPC_URL: z.url().optional(),
  LEASH_PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().min(0).max(50_000).default(1),
  /** Path to the agent keypair file; created on first run if missing. */
  AGENT_KEYPAIR: z.string().min(1).default("~/.config/leash/agent.json"),
  /** The owner wallet whose principal holds this agent. */
  AGENT_OWNER: AddressSchema,
  AGENT_MODE: z.enum(["llm", "scripted"]).default("llm"),
  AGENT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  /** LLM mode only. Never printed. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AGENT_MERCHANT_URL: z.url().default("http://localhost:4300"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses an environment. Empty strings count as unset. Throws a readable error. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid demo agent configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
