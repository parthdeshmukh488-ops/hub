import { z } from "zod";
import { AddressSchema, type Cluster, ClusterSchema } from "./config.ts";
import { LabelSchema } from "./units.ts";
import type { PayeeLimits, PolicyView } from "./views.ts";

// Policy presets used by pairing links and the web wizard (02-contracts §11).

export const PRESET_IDS = ["research-assistant", "custom"] as const;
export const PresetIdSchema = z.enum(PRESET_IDS);
export type PresetId = z.infer<typeof PresetIdSchema>;

export type AllowancePreset = {
  kind: "recurring";
  /** Base units per period. */
  amountPerPeriod: string;
  periodLengthSecs: number;
  /** The delegation expires this many seconds after creation. */
  durationSecs: number;
};

export type PayeePreset = {
  /** Which demo wallet to fill in; resolved by the caller (e.g. from MERCHANT_PAY_TO). */
  role: "merchant-demo";
  label: string;
  limits: PayeeLimits;
};

export type PolicyPreset = {
  id: PresetId;
  name: string;
  description: string;
  /** null for `custom`: the owner enters everything. */
  allowance: AllowancePreset | null;
  policy: PolicyView | null;
  payees: readonly PayeePreset[];
};

const DAY = 86_400;

export const POLICY_PRESETS: Record<PresetId, PolicyPreset> = {
  "research-assistant": {
    id: "research-assistant",
    name: "Research assistant",
    description:
      "Pays for research APIs per call: up to 5 USDC a day, 1 USDC per payment, owner approval up to 5 USDC, only allowlisted APIs.",
    allowance: {
      kind: "recurring",
      amountPerPeriod: "5000000",
      periodLengthSecs: DAY,
      durationSecs: 30 * DAY,
    },
    policy: {
      maxPerPayment: "1000000",
      maxPerRequest: "5000000",
      payeeMode: "allowListOnly",
      velocityMaxPayments: 30,
      velocityWindowSecs: 60,
      tripwireMaxStrikes: 3,
      tripwireWindowSecs: 600,
      requestTtlSecs: 3_600,
      validUntil: null,
    },
    payees: [
      {
        role: "merchant-demo",
        label: "Research API",
        limits: { maxPerPayment: "2000000", periodLimit: "3000000", periodSecs: DAY },
      },
    ],
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "Set every limit yourself.",
    allowance: null,
    policy: null,
    payees: [],
  },
};

// ── Pairing links ────────────────────────────────────────────────────────────

export const PairingParamsSchema = z.object({
  agentKey: AddressSchema,
  label: LabelSchema.pipe(z.string().min(1)),
  preset: PresetIdSchema.default("custom"),
  cluster: ClusterSchema.default("devnet"),
});
export type PairingParams = z.infer<typeof PairingParamsSchema>;

/** `{webUrl}/pair?agentKey=…&label=…&preset=…&cluster=…` */
export function buildPairingUrl(
  webUrl: string,
  params: { agentKey: string; label: string; preset?: PresetId; cluster?: Cluster },
): string {
  const parsed = PairingParamsSchema.parse(params);
  const url = new URL("/pair", webUrl);
  url.searchParams.set("agentKey", parsed.agentKey);
  url.searchParams.set("label", parsed.label);
  url.searchParams.set("preset", parsed.preset);
  url.searchParams.set("cluster", parsed.cluster);
  return url.toString();
}

/** Parses the query of a pairing link. Throws a ZodError on invalid input. */
export function parsePairingParams(search: URLSearchParams): PairingParams {
  return PairingParamsSchema.parse(Object.fromEntries(search.entries()));
}
