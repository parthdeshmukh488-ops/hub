import {
  AddressSchema,
  PairingParamsSchema,
  POLICY_PRESETS,
  PROGRAM_CONSTANTS,
  type PresetId,
  PresetIdSchema,
  parseUsdc,
  utf8ByteLength,
} from "@leash/contracts";
import type { PayeeInput, PolicyState } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { duration, usdc } from "./format.ts";
import { nameOf } from "./text.ts";

// The pairing wizard's pure logic (02-contracts §11): the link's parameters, the form a preset
// fills in, its validation, and the plain-language review the owner reads before signing.
// Amounts are typed as USDC ("1.50") and become base units here; nothing is a float.

/** Every field as the owner types it. */
export type PairingForm = {
  agentKey: string;
  label: string;
  mint: string;
  allowancePerPeriod: string;
  allowancePeriodSecs: string;
  /** Days until the allowance expires; "0" = never. */
  allowanceDays: string;
  maxPerPayment: string;
  /** "0" switches approvals off. */
  maxPerRequest: string;
  allowListOnly: boolean;
  velocityMaxPayments: string;
  velocityWindowSecs: string;
  tripwireMaxStrikes: string;
  tripwireWindowSecs: string;
  requestTtlSecs: string;
  payees: PayeeForm[];
};

export type PayeeForm = {
  label: string;
  address: string;
  maxPerPayment: string;
  periodLimit: string;
  periodSecs: string;
};

/** What the wizard knows besides the link: the demo merchant and the mint, when it can tell. */
export type PairingHints = { merchant?: string; mint?: string };

export type ParsedPairing = {
  agentKey: Address;
  label: string;
  mint: Address;
  policy: PolicyState;
  allowance: { amountPerPeriod: bigint; periodLengthSecs: bigint; durationSecs: bigint };
  payees: PayeeInput[];
};

export type PairingErrors = Partial<Record<string, string>>;

const DAY = 86_400;

const validLabel = (text: string) =>
  text.length > 0 && utf8ByteLength(text) <= PROGRAM_CONSTANTS.labelLen;

/** The pairing link's query, or what is wrong with it. Unknown fields are ignored. */
export function readPairingLink(
  query: Record<string, string | string[] | undefined>,
):
  | { ok: true; agentKey: string; label: string; preset: PresetId; cluster: string }
  | { ok: false; problems: string[] } {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const parsed = PairingParamsSchema.safeParse({
    agentKey: first(query.agentKey),
    label: first(query.label),
    preset: first(query.preset) || undefined,
    cluster: first(query.cluster) || undefined,
  });
  if (parsed.success) return { ok: true, ...parsed.data };
  const problems = parsed.error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "link");
    if (field === "agentKey") return "The agent key in the link is not a valid Solana address.";
    if (field === "label")
      return "The agent's name in the link is missing or longer than 32 bytes.";
    if (field === "preset") return "The link names a preset this app does not know.";
    if (field === "cluster") return "The link names an unknown cluster.";
    return "The pairing link is malformed.";
  });
  return { ok: false, problems: [...new Set(problems)] };
}

const units = (amount: string) => usdc(BigInt(amount));

/** The form a preset fills in. `custom` leaves the limits empty for the owner. */
export function formFromPreset(
  preset: PresetId,
  base: { agentKey: string; label: string },
  hints: PairingHints = {},
): PairingForm {
  const p = POLICY_PRESETS[preset];
  const policy = p.policy;
  const allowance = p.allowance;
  return {
    agentKey: base.agentKey,
    label: base.label,
    mint: hints.mint ?? "",
    allowancePerPeriod: allowance ? units(allowance.amountPerPeriod) : "",
    allowancePeriodSecs: String(allowance?.periodLengthSecs ?? DAY),
    allowanceDays: allowance ? String(Math.round(allowance.durationSecs / DAY)) : "30",
    maxPerPayment: policy ? units(policy.maxPerPayment) : "",
    maxPerRequest: policy ? units(policy.maxPerRequest) : "0",
    allowListOnly: policy ? policy.payeeMode === "allowListOnly" : true,
    velocityMaxPayments: String(policy?.velocityMaxPayments ?? 30),
    velocityWindowSecs: String(policy?.velocityWindowSecs ?? 60),
    tripwireMaxStrikes: String(policy?.tripwireMaxStrikes ?? 3),
    tripwireWindowSecs: String(policy?.tripwireWindowSecs ?? 600),
    requestTtlSecs: String(policy?.requestTtlSecs ?? 3_600),
    payees: p.payees.map((payee) => ({
      label: payee.label,
      // The preset names a role ("merchant-demo"); the address is the owner's to confirm.
      address: payee.role === "merchant-demo" ? (hints.merchant ?? "") : "",
      maxPerPayment: units(payee.limits.maxPerPayment),
      periodLimit: units(payee.limits.periodLimit),
      periodSecs: String(payee.limits.periodSecs),
    })),
  };
}

export const emptyPayee = (): PayeeForm => ({
  label: "",
  address: "",
  maxPerPayment: "0",
  periodLimit: "0",
  periodSecs: String(DAY),
});

/**
 * Validates the form into what `planOnboarding` takes. The program checks the same rules
 * (01 §4.5); checking here only lets the owner fix them before the wallet opens.
 */
export function parsePairingForm(
  form: PairingForm,
): { ok: true; value: ParsedPairing } | { ok: false; errors: PairingErrors } {
  const errors: PairingErrors = {};
  const amount = (field: string, text: string, { positive = false } = {}) => {
    try {
      const value = parseUsdc(text.trim());
      if (positive && value === 0n) errors[field] = "Must be more than 0.";
      return value;
    } catch {
      errors[field] = "Enter an amount in USDC, like 1.50.";
      return 0n;
    }
  };
  const whole = (field: string, text: string, { max = 4_294_967_295, positive = false } = {}) => {
    const value = Number(text.trim());
    if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value > max) {
      errors[field] = `Enter a whole number${max < 4_294_967_295 ? ` up to ${max}` : ""}.`;
      return 0;
    }
    if (positive && value === 0) errors[field] = "Must be more than 0.";
    return value;
  };
  const address = (field: string, text: string) => {
    const parsed = AddressSchema.safeParse(text.trim());
    if (!parsed.success) errors[field] = "Enter a Solana address.";
    return text.trim() as Address;
  };

  const agentKey = address("agentKey", form.agentKey);
  const label = form.label.trim();
  if (!validLabel(label)) {
    errors.label = "Give the agent a name of at most 32 bytes.";
  }
  const mint = address("mint", form.mint);

  const allowancePerPeriod = amount("allowancePerPeriod", form.allowancePerPeriod, {
    positive: true,
  });
  const allowancePeriodSecs = whole("allowancePeriodSecs", form.allowancePeriodSecs, {
    positive: true,
  });
  const allowanceDays = whole("allowanceDays", form.allowanceDays, { max: 3_650 });

  const maxPerPayment = amount("maxPerPayment", form.maxPerPayment, { positive: true });
  const maxPerRequest = amount("maxPerRequest", form.maxPerRequest);
  if (maxPerRequest > 0n && maxPerRequest <= maxPerPayment && !errors.maxPerRequest) {
    errors.maxPerRequest = "Must be above the instant limit, or 0 to switch approvals off.";
  }
  const velocityMaxPayments = whole("velocityMaxPayments", form.velocityMaxPayments, {
    max: 65_535,
  });
  const velocityWindowSecs = whole("velocityWindowSecs", form.velocityWindowSecs, {
    positive: velocityMaxPayments > 0,
  });
  const tripwireMaxStrikes = whole("tripwireMaxStrikes", form.tripwireMaxStrikes, { max: 255 });
  const tripwireWindowSecs = whole("tripwireWindowSecs", form.tripwireWindowSecs, {
    positive: tripwireMaxStrikes > 0,
  });
  const requestTtlSecs = whole("requestTtlSecs", form.requestTtlSecs, {
    max: PROGRAM_CONSTANTS.maxRequestTtlSecs,
    positive: maxPerRequest > 0n,
  });

  const seen = new Set<string>();
  const payees = form.payees.map((payee, i): PayeeInput => {
    const at = (field: string) => `payees.${i}.${field}`;
    const payeeLabel = payee.label.trim();
    if (!validLabel(payeeLabel)) {
      errors[at("label")] = "Name the payee (at most 32 bytes).";
    }
    const payeeAddress = address(at("address"), payee.address);
    if (seen.has(payeeAddress)) errors[at("address")] = "This payee is listed twice.";
    seen.add(payeeAddress);
    if (payeeAddress === agentKey) errors[at("address")] = "A payee must not be the agent itself.";
    const periodLimit = amount(at("periodLimit"), payee.periodLimit);
    return {
      payee: payeeAddress,
      label: payeeLabel,
      limits: {
        maxPerPayment: amount(at("maxPerPayment"), payee.maxPerPayment),
        periodLimit,
        periodSecs: whole(at("periodSecs"), payee.periodSecs, { positive: periodLimit > 0n }),
      },
    };
  });
  if (form.allowListOnly && payees.length === 0) {
    errors.payees = "Add at least one payee, or let the agent pay anyone.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      agentKey,
      label,
      mint,
      policy: {
        maxPerPayment,
        maxPerRequest,
        payeeMode: form.allowListOnly ? "allowListOnly" : "anyPayee",
        velocityMaxPayments,
        velocityWindowSecs,
        tripwireMaxStrikes,
        tripwireWindowSecs,
        requestTtlSecs: maxPerRequest > 0n ? requestTtlSecs : requestTtlSecs || 3_600,
        validUntil: 0n,
      },
      allowance: {
        amountPerPeriod: allowancePerPeriod,
        periodLengthSecs: BigInt(allowancePeriodSecs),
        durationSecs: BigInt(allowanceDays) * BigInt(DAY),
      },
      payees,
    },
  };
}

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const per = (secs: number) => (secs === DAY ? "day" : duration(secs));

/**
 * The plain-language review, one sentence per line, read before the wallet opens: "This agent
 * can spend up to 5 USDC per day, only with Research API, at most 1 USDC per payment."
 */
export function reviewLines(parsed: ParsedPairing): string[] {
  const { policy, allowance, payees } = parsed;
  const payeeNames = payees.map((p) => nameOf(p.label, p.payee));
  const lines: string[] = [];
  const who =
    policy.payeeMode === "allowListOnly"
      ? `only with ${list(payeeNames)}`
      : "with anyone (the allowlist is off)";
  lines.push(
    `This agent can spend up to ${usdc(allowance.amountPerPeriod)} USDC per ${per(Number(allowance.periodLengthSecs))}, ${who}, at most ${usdc(policy.maxPerPayment)} USDC per payment.`,
  );
  lines.push(
    allowance.durationSecs === 0n
      ? "The allowance never expires; revoke it any time."
      : `The allowance ends after ${duration(Number(allowance.durationSecs))}.`,
  );
  lines.push(
    policy.maxPerRequest === 0n
      ? "It never asks you to approve more: larger payments are blocked."
      : `It asks you before paying more, up to ${usdc(policy.maxPerRequest)} USDC; your approval request expires after ${duration(policy.requestTtlSecs)}.`,
  );
  for (const payee of payees) {
    const caps = [
      payee.limits.maxPerPayment > 0n
        ? `at most ${usdc(payee.limits.maxPerPayment)} USDC per payment`
        : null,
      payee.limits.periodLimit > 0n
        ? `${usdc(payee.limits.periodLimit)} USDC per ${per(payee.limits.periodSecs)}`
        : null,
    ].filter((c): c is string => c !== null);
    if (caps.length > 0) lines.push(`${nameOf(payee.label, payee.payee)}: ${caps.join(", ")}.`);
  }
  lines.push(
    policy.velocityMaxPayments === 0
      ? "No rate limit."
      : `At most ${policy.velocityMaxPayments} payments per ${duration(policy.velocityWindowSecs)}.`,
  );
  lines.push(
    policy.tripwireMaxStrikes === 0
      ? "Tripwire off: blocked attempts never freeze it."
      : `It freezes itself after ${policy.tripwireMaxStrikes} blocked attempts within ${duration(policy.tripwireWindowSecs)}.`,
  );
  lines.push("You can freeze it at any time, and the money stays in your wallet until it pays.");
  return lines;
}

/**
 * The agent key as the owner compares it with the agent's terminal: the whole base58 address in
 * groups of four. An attacker's key can share a few characters with the real one, never all.
 */
export function keyFingerprint(agentKey: string): string[] {
  return agentKey.match(/.{1,4}/g) ?? [];
}

export const isPresetId = (value: string): value is PresetId =>
  PresetIdSchema.safeParse(value).success;
