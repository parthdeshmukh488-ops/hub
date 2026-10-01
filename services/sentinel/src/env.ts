import { ClusterSchema } from "@leash/contracts";
import { z } from "zod";

// The service's configuration (02-contracts §13). Only `loadEnv` reads process.env.

const EnvSchema = z.object({
  LEASH_CLUSTER: ClusterSchema.default("localnet"),
  /** For guardian freezes; the cluster's default when unset. */
  LEASH_RPC_URL: z.url().optional(),
  SENTINEL_INDEXER_URL: z.url().default("http://localhost:4100"),
  /** A file path, never key material. */
  SENTINEL_GUARDIAN_KEYPAIR: z.string().min(1).optional(),
  SENTINEL_AUTOFREEZE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SENTINEL_WEB_URL: z.url().default("http://localhost:3000"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses an environment. Empty strings count as unset. Throws a readable error. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    // Never echo the input: TELEGRAM_BOT_TOKEN is a secret.
    throw new Error(`Invalid sentinel environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
