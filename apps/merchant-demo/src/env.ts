import { AddressSchema, ClusterSchema } from "@leash/contracts";
import { z } from "zod";

// The merchant's configuration (02-contracts §13). Only `loadEnv` reads process.env.

const EnvSchema = z.object({
  LEASH_CLUSTER: ClusterSchema.default("localnet"),
  MERCHANT_PORT: z.coerce.number().int().min(1).max(65_535).default(4300),
  /** Receives the merchant routes' payments. Unset: the demo storyline's merchant. */
  MERCHANT_PAY_TO: AddressSchema.optional(),
  MERCHANT_FACILITATOR_URL: z.url().default("http://localhost:4200"),
  /** "on": paid routes answer 402 and are paid over x402 through the facilitator. */
  MERCHANT_PAYMENTS: z.enum(["on", "off"]).default("off"),
  /** The USDC mint prices are paid in. Required on localnet (`.localnet.json`'s `usdcMint`). */
  LEASH_USDC_MINT: AddressSchema.optional(),
  /** Where the lab's attacks try to send money. Unset: the demo storyline's attacker. */
  LAB_ATTACKER_WALLET: AddressSchema.optional(),
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
    throw new Error(`Invalid merchant environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
