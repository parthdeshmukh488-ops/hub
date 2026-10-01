import { AmountStringSchema } from "@leash/contracts";
import { z } from "zod";

// Rule thresholds, read from `sentinel.config.json`. Every field has a default, so a file only
// lists what it changes. Unknown keys are rejected: a typo must not silently keep a default.
// Nested objects use `prefault` so a missing object is parsed and gets its fields' defaults.

const seconds = z.number().int().positive();
const percent = z.number().int().min(1).max(100);

const toggle = z.strictObject({ enabled: z.boolean().default(true) });

export const SentinelConfigSchema = z.strictObject({
  /** One alert per rule per agent (or per owner) within this many seconds of event time. */
  cooldownSecs: seconds.default(600),
  /** Add Solana Action (Blink) URLs to alerts (02-contracts §10), served by apps/web. */
  actionLinks: z.boolean().default(true),
  rules: z
    .strictObject({
      tripwireFired: toggle.prefault({}),
      approvalRequested: toggle.prefault({}),
      burstDenials: z
        .strictObject({
          enabled: z.boolean().default(true),
          minDenials: z.number().int().min(2).default(3),
          windowSecs: seconds.default(300),
        })
        .prefault({}),
      spendSpike: z
        .strictObject({
          enabled: z.boolean().default(true),
          /** The recent window whose spend is compared. */
          windowSecs: seconds.default(600),
          /** The trailing window just before it that sets the usual rate. */
          baselineSecs: seconds.default(3600),
          /** Recent spend must exceed this multiple of the baseline rate. */
          multiplier: z.number().int().min(1).default(3),
          /** And be at least this much (base units). */
          minAmount: AmountStringSchema.default("1000000"),
        })
        .prefault({}),
      newPayeeSpend: z
        .strictObject({
          enabled: z.boolean().default(true),
          /** How long after `PayeeAdded` a payee counts as new. */
          windowSecs: seconds.default(600),
          /** A payment of at least this share of the payee's per-payment cap alerts. */
          capPercent: percent.default(50),
        })
        .prefault({}),
      allowanceLow: z
        .strictObject({
          enabled: z.boolean().default(true),
          /** Alert when less than this share of the allowance remains. */
          remainingPercent: percent.default(10),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type SentinelConfig = z.infer<typeof SentinelConfigSchema>;

/** Every threshold at its default. */
export const DEFAULT_CONFIG: SentinelConfig = SentinelConfigSchema.parse({});

/** Parses a config file's content; throws a readable error naming the bad fields. */
export function parseConfig(json: unknown): SentinelConfig {
  const result = SentinelConfigSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid sentinel.config.json:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
