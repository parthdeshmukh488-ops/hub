import { AddressSchema, ClusterSchema } from "@leash/contracts";
import { z } from "zod";

// The service's configuration (02-contracts §13). Only `loadEnv` reads process.env.

const EnvSchema = z.object({
  LEASH_CLUSTER: ClusterSchema.default("localnet"),
  LEASH_RPC_URL: z.url().optional(),
  LEASH_PROGRAM_ID: AddressSchema.optional(),
  FACILITATOR_PORT: z.coerce.number().int().min(1).max(65_535).default(4200),
  FACILITATOR_FEE_PAYER_KEYPAIR: z.string().min(1).default(".keys/facilitator.json"),
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
    throw new Error(`Invalid facilitator environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
