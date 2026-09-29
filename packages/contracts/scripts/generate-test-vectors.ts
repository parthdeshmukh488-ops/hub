/**
 * Generates `test-vectors/policy.json`: the shared cases for payment evaluation
 * (docs/architecture/01-onchain-program.md §7). Every expectation is written by hand from
 * the spec; the generator only removes repetition. A case is never deleted: fix it or add one.
 *
 * Run: pnpm --filter @leash/contracts generate
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POLICY_PRESETS,
  type PolicyTestCase,
  PolicyTestVectorsSchema,
  type PolicyView,
} from "../src/index.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-vectors", "policy.json");

/** Oct 2, 2026, 10:00 UTC. */
const NOW = Date.UTC(2026, 9, 2, 10, 0, 0) / 1000;
const DAY = 86_400;
const REF_A = createHash("sha256").update("leash:test-ref:a").digest("hex");
const REF_REQUEST = createHash("sha256").update("leash:test-ref:request").digest("hex");

const presetPolicy = POLICY_PRESETS["research-assistant"].policy;
if (!presetPolicy) throw new Error("research-assistant preset has no policy");
const policy: PolicyView = presetPolicy;

/** The base case: an allowlisted payment of 0.01 USDC that passes every check. */
const base: Omit<PolicyTestCase, "name" | "expect"> = {
  now: NOW,
  principal: { frozen: false },
  agent: {
    status: "active",
    policy,
    stats: { velocityWindowStart: NOW - 30, velocityCount: 5, strikeWindowStart: 0, strikes: 0 },
  },
  payee: {
    agent: "self",
    payee: "merchant",
    maxPerPayment: "2000000",
    periodLimit: "3000000",
    periodSecs: DAY,
    periodStart: NOW - 3600,
    spentInPeriod: "100000",
  },
  request: null,
  delegation: {
    kind: "recurring",
    amountPerPeriod: "5000000",
    periodLengthSecs: DAY,
    currentPeriodStart: NOW - 3600,
    pulledInPeriod: "100000",
    expiryTs: 0,
  },
  sourceAmount: "100000000",
  payment: { amount: "10000", destinationOwner: "merchant", reference: REF_A },
};

const approvedRequest = {
  agent: "self" as const,
  status: "approved" as const,
  payee: "merchant",
  amount: "1500000",
  reference: REF_REQUEST,
  expiresAt: NOW + 100,
};

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge where `null` replaces and objects merge. */
function merge<T>(target: T, patch: unknown): T {
  if (!isPlain(target) || !isPlain(patch)) return patch as T;
  const out: Plain = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlain(value) && isPlain(out[key]) ? merge(out[key], value) : value;
  }
  return out as T;
}

type Patch = {
  now?: number;
  principal?: Partial<PolicyTestCase["principal"]>;
  agent?: {
    status?: "active" | "frozen";
    policy?: Partial<PolicyView>;
    stats?: Partial<PolicyTestCase["agent"]["stats"]>;
  };
  payee?: Partial<NonNullable<PolicyTestCase["payee"]>> | null;
  request?: NonNullable<PolicyTestCase["request"]> | null;
  delegation?: PolicyTestCase["delegation"] | Plain;
  sourceAmount?: string;
  payment?: Partial<PolicyTestCase["payment"]>;
};

const cases: PolicyTestCase[] = [];
function add(name: string, patch: Patch, expect: PolicyTestCase["expect"]): void {
  cases.push({ name, ...merge(base, patch), expect });
}

const allowed = (
  effects?: NonNullable<Extract<PolicyTestCase["expect"], { outcome: "allowed" }>["effects"]>,
) => (effects ? ({ outcome: "allowed", effects } as const) : ({ outcome: "allowed" } as const));
const denied = (reason: Extract<PolicyTestCase["expect"], { outcome: "denied" }>["reason"]) =>
  ({ outcome: "denied", reason }) as const;
const error = (e: Extract<PolicyTestCase["expect"], { outcome: "error" }>["error"]) =>
  ({ outcome: "error", error: e }) as const;

// ── Basics ───────────────────────────────────────────────────────────────────
add(
  "allowed: allowlisted payee within every limit",
  {},
  allowed({
    velocityWindowStart: NOW - 30,
    velocityCount: 6,
    payeePeriodStart: NOW - 3600,
    payeeSpentInPeriod: "110000",
    delegationPeriodStart: NOW - 3600,
    delegationPulledInPeriod: "110000",
  }),
);
add("allowed: amount exactly maxPerPayment", { payment: { amount: "1000000" } }, allowed());
add("error: zero amount", { payment: { amount: "0" } }, error("InvalidAmount"));
add(
  "error: zero amount is checked before anything else",
  { principal: { frozen: true }, payment: { amount: "0" } },
  error("InvalidAmount"),
);

// ── Freeze and expiry ────────────────────────────────────────────────────────
add("denied: principal frozen", { principal: { frozen: true } }, denied("principalFrozen"));
add(
  "denied: principal frozen wins over agent frozen",
  { principal: { frozen: true }, agent: { status: "frozen" } },
  denied("principalFrozen"),
);
add("denied: agent frozen", { agent: { status: "frozen" } }, denied("agentFrozen"));
add(
  "denied: agent frozen wins over a non-allowlisted payee",
  { agent: { status: "frozen" }, payment: { destinationOwner: "attacker" } },
  denied("agentFrozen"),
);
add(
  "denied: agent expired at exactly validUntil",
  { agent: { policy: { validUntil: NOW } } },
  denied("agentExpired"),
);
add(
  "allowed: one second before validUntil",
  { agent: { policy: { validUntil: NOW + 1 } } },
  allowed(),
);

// ── Allowlist ────────────────────────────────────────────────────────────────
add("denied: no payee entry in allow-list mode", { payee: null }, denied("payeeNotAllowed"));
add(
  "denied: entry for a different payee",
  { payment: { destinationOwner: "attacker" } },
  denied("payeeNotAllowed"),
);
add(
  "denied: entry belongs to another agent",
  { payee: { agent: "other" } },
  denied("payeeNotAllowed"),
);
add(
  "denied: the allowlist is checked before the amount",
  { payment: { destinationOwner: "attacker", amount: "25000000" } },
  denied("payeeNotAllowed"),
);
add(
  "allowed: any-payee mode without an entry",
  {
    agent: { policy: { payeeMode: "anyPayee" } },
    payee: null,
    payment: { destinationOwner: "attacker" },
  },
  allowed({ velocityCount: 6, delegationPulledInPeriod: "110000" }),
);
add(
  "denied: any-payee mode still enforces the instant and approval limits",
  {
    agent: { policy: { payeeMode: "anyPayee" } },
    payee: null,
    payment: { destinationOwner: "attacker", amount: "5000001" },
  },
  denied("exceedsPaymentLimit"),
);
add(
  "denied: any-payee mode still applies a matching entry's limits",
  {
    agent: { policy: { payeeMode: "anyPayee" } },
    payee: { maxPerPayment: "500000" },
    payment: { amount: "600000" },
  },
  denied("exceedsPayeePaymentLimit"),
);

// ── Instant limit and approvals ──────────────────────────────────────────────
add(
  "denied: one unit above the instant limit needs approval",
  { payment: { amount: "1000001" } },
  denied("approvalRequired"),
);
add(
  "denied: exactly maxPerRequest needs approval",
  { payment: { amount: "5000000" } },
  denied("approvalRequired"),
);
add(
  "denied: above maxPerRequest",
  { payment: { amount: "5000001" } },
  denied("exceedsPaymentLimit"),
);
add(
  "denied: above the instant limit with approvals off",
  { agent: { policy: { maxPerRequest: "0" } }, payment: { amount: "1000001" } },
  denied("exceedsPaymentLimit"),
);

// ── Payee limits ─────────────────────────────────────────────────────────────
add(
  "denied: above the payee's per-payment cap",
  { payee: { maxPerPayment: "500000" }, payment: { amount: "600000" } },
  denied("exceedsPayeePaymentLimit"),
);
add(
  "allowed: exactly the payee's per-payment cap",
  { payee: { maxPerPayment: "500000" }, payment: { amount: "500000" } },
  allowed(),
);
add(
  "allowed: payee cap of 0 means no cap",
  { payee: { maxPerPayment: "0" }, payment: { amount: "1000000" } },
  allowed(),
);
add(
  "denied: payee period budget exceeded",
  { payee: { spentInPeriod: "2995000" } },
  denied("exceedsPayeePeriodLimit"),
);
add(
  "allowed: payee period budget reached exactly",
  { payee: { spentInPeriod: "2990000" } },
  allowed({ payeeSpentInPeriod: "3000000" }),
);
add(
  "allowed: payee period rolls over once elapsed",
  { payee: { periodStart: NOW - DAY, spentInPeriod: "3000000" } },
  allowed({ payeePeriodStart: NOW, payeeSpentInPeriod: "10000" }),
);
add(
  "denied: payee period one second before roll-over",
  { payee: { periodStart: NOW - DAY + 1, spentInPeriod: "3000000" } },
  denied("exceedsPayeePeriodLimit"),
);
add(
  "allowed: payee period never started",
  { payee: { periodStart: 0, spentInPeriod: "0" } },
  allowed({ payeePeriodStart: NOW, payeeSpentInPeriod: "10000" }),
);
add(
  "allowed: payee period limit of 0 is off and its counters are not updated",
  { payee: { periodLimit: "0", periodSecs: 0, spentInPeriod: "999999999" } },
  allowed({ payeePeriodStart: NOW - 3600, payeeSpentInPeriod: "999999999" }),
);

// ── Rate limit ───────────────────────────────────────────────────────────────
add(
  "denied: rate limit reached",
  { agent: { stats: { velocityCount: 30 } } },
  denied("velocityExceeded"),
);
add(
  "allowed: last payment within the rate limit",
  { agent: { stats: { velocityCount: 29 } } },
  allowed({ velocityWindowStart: NOW - 30, velocityCount: 30 }),
);
add(
  "allowed: rate window rolls over once elapsed",
  { agent: { stats: { velocityWindowStart: NOW - 60, velocityCount: 30 } } },
  allowed({ velocityWindowStart: NOW, velocityCount: 1 }),
);
add(
  "allowed: rate limit off and its counters are not updated",
  {
    agent: {
      policy: { velocityMaxPayments: 0, velocityWindowSecs: 0 },
      stats: { velocityCount: 1000 },
    },
  },
  allowed({ velocityWindowStart: NOW - 30, velocityCount: 1000 }),
);

// ── Allowance: recurring ─────────────────────────────────────────────────────
add(
  "denied: recurring allowance used up",
  { delegation: { pulledInPeriod: "4995000" } },
  denied("allowanceExceeded"),
);
add(
  "allowed: recurring allowance reached exactly",
  { delegation: { pulledInPeriod: "4990000" } },
  allowed({ delegationPulledInPeriod: "5000000" }),
);
add(
  "allowed: recurring period rolls forward by whole periods",
  { delegation: { currentPeriodStart: NOW - 2 * DAY - 5, pulledInPeriod: "5000000" } },
  allowed({ delegationPeriodStart: NOW - 5, delegationPulledInPeriod: "10000" }),
);
add(
  "denied: recurring allowance not started yet",
  { delegation: { currentPeriodStart: NOW + 10 } },
  denied("allowanceExceeded"),
);
add(
  "allowed: recurring allowance at exactly its expiry second",
  { delegation: { expiryTs: NOW } },
  allowed(),
);
add(
  "denied: recurring allowance one second after expiry",
  { delegation: { expiryTs: NOW - 1 } },
  denied("allowanceExpired"),
);
add(
  "denied: no fresh period at the expiry boundary (expiry clamp)",
  { delegation: { currentPeriodStart: NOW - DAY, expiryTs: NOW, pulledInPeriod: "4995000" } },
  denied("allowanceExceeded"),
);
add(
  "allowed: the expiry clamp keeps the last period's usage",
  { delegation: { currentPeriodStart: NOW - DAY, expiryTs: NOW, pulledInPeriod: "100000" } },
  allowed({ delegationPeriodStart: NOW - DAY, delegationPulledInPeriod: "110000" }),
);

// ── Allowance: fixed ─────────────────────────────────────────────────────────
const fixed = (amountRemaining: string, expiryTs: number) => ({
  delegation: { kind: "fixed" as const, amountRemaining, expiryTs },
});
add(
  "allowed: fixed allowance with enough remaining",
  fixed("1000000", 0),
  allowed({ delegationAmountRemaining: "990000" }),
);
add("denied: fixed allowance used up", fixed("5000", 0), denied("allowanceExceeded"));
add("denied: fixed allowance expired", fixed("1000000", NOW - 1), denied("allowanceExpired"));
add("allowed: fixed allowance at exactly its expiry second", fixed("1000000", NOW), allowed());

// ── Funds ────────────────────────────────────────────────────────────────────
add("denied: owner's balance too low", { sourceAmount: "9999" }, denied("insufficientFunds"));
add(
  "denied: the allowance is checked before the balance",
  { sourceAmount: "0", delegation: { pulledInPeriod: "5000000" } },
  denied("allowanceExceeded"),
);

// ── Approved requests ────────────────────────────────────────────────────────
const withRequest = (patch: Patch = {}): Patch =>
  merge(
    {
      request: approvedRequest,
      payment: { amount: approvedRequest.amount, reference: REF_REQUEST },
    } as Patch,
    patch,
  );
add(
  "allowed: an approved request waives the instant limit",
  withRequest(),
  allowed({
    velocityCount: 6,
    payeeSpentInPeriod: "1600000",
    delegationPulledInPeriod: "1600000",
  }),
);
add(
  "allowed: an approved request waives the payee caps",
  withRequest({ payee: { maxPerPayment: "500000", spentInPeriod: "2900000" } }),
  allowed({ payeeSpentInPeriod: "4400000" }),
);
add(
  "denied: an approved request still respects the freeze",
  withRequest({ agent: { status: "frozen" } }),
  denied("agentFrozen"),
);
add(
  "denied: an approved request still respects the allowlist",
  withRequest({
    request: { ...approvedRequest, payee: "attacker" },
    payment: { destinationOwner: "attacker" },
  }),
  denied("payeeNotAllowed"),
);
add(
  "denied: an approved request still respects the rate limit",
  withRequest({ agent: { stats: { velocityCount: 30 } } }),
  denied("velocityExceeded"),
);
add(
  "denied: an approved request still respects the allowance",
  withRequest({ delegation: { pulledInPeriod: "4000000" } }),
  denied("allowanceExceeded"),
);
add(
  "error: the request is still pending",
  withRequest({ request: { ...approvedRequest, status: "pending" } }),
  error("RequestNotApproved"),
);
add(
  "error: the request expired",
  withRequest({ request: { ...approvedRequest, expiresAt: NOW } }),
  error("RequestExpired"),
);
add(
  "error: the payment amount differs from the request",
  withRequest({ payment: { amount: "1400000" } }),
  error("RequestMismatch"),
);
add(
  "error: the payment reference differs from the request",
  withRequest({ payment: { reference: REF_A } }),
  error("RequestMismatch"),
);
add(
  "error: the request belongs to another agent",
  withRequest({ request: { ...approvedRequest, agent: "other" } }),
  error("RequestMismatch"),
);
add(
  "error: the request is for a different payee",
  withRequest({
    agent: { policy: { payeeMode: "anyPayee" } },
    payee: null,
    payment: { destinationOwner: "attacker" },
  }),
  error("RequestMismatch"),
);

// ── Write ────────────────────────────────────────────────────────────────────
const file = PolicyTestVectorsSchema.parse({
  version: 1,
  description:
    "Payment evaluation cases for the Leash program (01-onchain-program §7). Keys map to keypairs whose ed25519 seed is sha256('leash:test-key:' + name).",
  keys: {
    merchant: "Allowlisted merchant wallet (owns the destination token account)",
    attacker: "Wallet that is not on the allowlist",
  },
  cases,
});
writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
console.log(`wrote test-vectors/policy.json (${file.cases.length} cases)`);
