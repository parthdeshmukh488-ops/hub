import { AddressSchema, ClusterSchema } from "@leash/contracts";
import { z } from "zod";

// The service's configuration (02-contracts §13). Only `loadEnv` reads process.env.

const EnvSchema = z.object({
  LEASH_CLUSTER: ClusterSchema.default("localnet"),
  LEASH_PROGRAM_ID: AddressSchema.optional(),
  INDEXER_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  INDEXER_DB_URL: z.string().min(1).default("file:./data/indexer.db"),
  // Chain mode arrives in build step 2; until then fixture replay is the default.
  INDEXER_SOURCE: z.enum(["chain", "fixtures"]).default("fixtures"),
  INDEXER_BACKFILL_LIMIT: z.coerce.number().int().positive().default(1000),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  INDEXER_REPLAY_SPEED: z.coerce.number().min(0).max(1000).default(1),
  INDEXER_REPLAY_LOOP: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
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
    throw new Error(`Invalid indexer environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
