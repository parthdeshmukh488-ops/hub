/**
 * Generates `fixtures/*.json`: one coherent world that follows the demo storyline
 * (docs/workstreams/WS9-integration-story.md#the-demo-storyline). Deterministic: the
 * same input always produces the same files. Every file is validated before it is written.
 *
 * Run: pnpm --filter @leash/contracts generate
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import {
  AgentDetailResponseSchema,
  type AgentView,
  DemoStorylineSchema,
  denialInfo,
  type LeashEvent,
  OwnerOverviewResponseSchema,
  type PayeeView,
  POLICY_PRESETS,
  RequestsResponseSchema,
  type RequestView,
  StatsResponseSchema,
} from "../src/index.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const addr = (name: string) =>
  base58(createHash("sha256").update(`leash:fixture:${name}`).digest());
const sig = (name: string) =>
  base58(createHash("sha512").update(`leash:fixture:sig:${name}`).digest());
const ref = (name: string) =>
  createHash("sha256").update(`leash:fixture:ref:${name}`).digest("hex");

// Oct 2, 2026, 10:00 UTC and a plausible devnet slot.
const T0 = Date.UTC(2026, 9, 2, 10, 0, 0) / 1000;
const SLOT0 = 430_000_000;
const DAY = 86_400;

const keys = {
  owner: addr("owner"),
  principal: addr("principal"),
  guardian: addr("guardian-sentinel"),
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  merchant: addr("merchant"),
  merchantTokenAccount: addr("merchant-usdc"),
  attacker: addr("attacker"),
  attackerTokenAccount: addr("attacker-usdc"),
  researchAgentKey: addr("research-agent-key"),
  researchAgent: addr("research-agent"),
  researchDelegation: addr("research-delegation"),
  researchPayeeEntry: addr("research-payee-merchant"),
  researchRequest0: addr("research-request-0"),
  marketAgentKey: addr("market-agent-key"),
  marketAgent: addr("market-agent"),
  marketDelegation: addr("market-delegation"),
  marketPayeeEntry: addr("market-payee-merchant"),
  marketRequest0: addr("market-request-0"),
};

const policy = POLICY_PRESETS["research-assistant"].policy;
const payeePreset = POLICY_PRESETS["research-assistant"].payees[0];
if (!policy || !payeePreset) throw new Error("research-assistant preset is incomplete");

// ── Events ───────────────────────────────────────────────────────────────────

const events: LeashEvent[] = [];
let counter = 0;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<
  LeashEvent,
  "id" | "signature" | "slot" | "blockTime" | "timestamp" | "principal" | "agent"
>;

/** Adds an event at T0 + t. `innerIndex` > 0 puts it in the same transaction as the previous one. */
function emit(t: number, agent: string | null, body: EventBody, innerIndex = 0): void {
  if (innerIndex === 0) counter++;
  const signature = sig(`tx-${counter}`);
  events.push({
    id: `${signature}:${innerIndex}`,
    signature,
    slot: SLOT0 + t * 3,
    blockTime: T0 + t,
    timestamp: T0 + t,
    principal: keys.principal,
    agent,
    ...body,
  } as LeashEvent);
}

const A = keys.researchAgent;
const B = keys.marketAgent;
const merchantPayee = {
  payee: keys.merchant,
  label: payeePreset.label,
  ...payeePreset.limits,
};
const paid = (
  t: number,
  agent: string,
  amount: string,
  memo: string,
  count: number,
  nonce: string | null = null,
) =>
  emit(t, agent, {
    type: "PaymentExecuted",
    payee: keys.merchant,
    destination: keys.merchantTokenAccount,
    mint: keys.mint,
    amount,
    reference: ref(`payment-${agent === A ? "a" : "b"}-${count}`),
    memo,
    delegation: agent === A ? keys.researchDelegation : keys.marketDelegation,
    requestNonce: nonce,
    paymentsCount: count,
  });
const denied = (t: number, strikes: number, tripped: boolean) =>
  emit(t, A, {
    type: "PaymentDenied",
    payee: keys.attacker,
    destination: keys.attackerTokenAccount,
    amount: "25000000",
    reason: "payeeNotAllowed",
    reasonCode: denialInfo("payeeNotAllowed").code,
    strike: true,
    strikes,
    tripped,
    reference: ref(`attack-${strikes}`),
    memo: "tip for the guide's author",
  });

// Setup: principal with Sentinel as guardian, two agents on the research-assistant preset.
emit(0, null, { type: "PrincipalInitialized", owner: keys.owner, guardian: keys.guardian });
emit(20, A, {
  type: "AgentCreated",
  agentKey: keys.researchAgentKey,
  mint: keys.mint,
  label: "Research Assistant",
  policy,
});
emit(40, A, { type: "PayeeAdded", ...merchantPayee });
emit(60, B, {
  type: "AgentCreated",
  agentKey: keys.marketAgentKey,
  mint: keys.mint,
  label: "Market Watcher",
  policy,
});
emit(70, B, { type: "PayeeAdded", ...merchantPayee });

// Scene 2: normal work, paid per call.
paid(120, A, "10000", "research: budget e-bikes under €1,500", 1);
paid(135, A, "10000", "research: e-bike battery range tests", 2);
paid(150, A, "20000", "market: e-bike price index", 3);
paid(170, B, "20000", "market: component prices", 1);

// Scene 3: the premium report needs approval (1.50 > 1.00 instant limit).
emit(200, A, {
  type: "PaymentRequested",
  request: keys.researchRequest0,
  nonce: "0",
  payee: keys.merchant,
  amount: "1500000",
  reference: ref("research-request-0"),
  memo: "premium e-bike comparison report",
  expiresAt: T0 + 200 + policy.requestTtlSecs,
});
emit(230, A, { type: "RequestApproved", request: keys.researchRequest0, nonce: "0" });
paid(245, A, "1500000", "premium e-bike comparison report", 4, "0");
paid(260, B, "20000", "market: component prices", 2);

// Scene 4: a poisoned buying guide tells the agent to tip an unknown wallet. Three strikes.
denied(300, 1, false);
denied(310, 2, false);
denied(320, 3, true);
emit(320, A, { type: "AgentFrozen", reason: "tripwire", by: keys.researchAgentKey }, 1);

// The second agent asks for approval and waits (the approvals inbox has something in it).
emit(400, B, {
  type: "PaymentRequested",
  request: keys.marketRequest0,
  nonce: "0",
  payee: keys.merchant,
  amount: "1500000",
  reference: ref("market-request-0"),
  memo: "premium market report",
  expiresAt: T0 + 400 + policy.requestTtlSecs,
});

// ── State after the storyline ────────────────────────────────────────────────

const AS_OF = T0 + 420;

const researchAgent: AgentView = {
  address: A,
  principal: keys.principal,
  owner: keys.owner,
  agentKey: keys.researchAgentKey,
  mint: keys.mint,
  label: "Research Assistant",
  status: "frozen",
  freezeReason: "tripwire",
  frozenAt: T0 + 320,
  payeeCount: 1,
  openRequests: 0,
  policy,
  stats: {
    paymentsCount: 4,
    totalPaid: "1540000",
    deniedCount: 3,
    lastPaymentAt: T0 + 245,
    // The 60 s window restarted at the 4th payment.
    velocityCount: 1,
    velocityWindowStart: T0 + 245,
    strikes: 3,
    strikeWindowStart: T0 + 300,
    requestNonce: "1",
  },
  allowance: {
    delegation: keys.researchDelegation,
    kind: "recurring",
    mint: keys.mint,
    amountPerPeriod: "5000000",
    periodLengthSecs: DAY,
    currentPeriodStart: T0 + 20,
    pulledInPeriod: "1540000",
    amountRemaining: null,
    remaining: "3460000",
    expiresAt: T0 + 20 + 30 * DAY,
    asOf: AS_OF,
  },
  createdAt: T0 + 20,
  updatedAt: T0 + 320,
};

const marketAgent: AgentView = {
  address: B,
  principal: keys.principal,
  owner: keys.owner,
  agentKey: keys.marketAgentKey,
  mint: keys.mint,
  label: "Market Watcher",
  status: "active",
  freezeReason: "none",
  frozenAt: null,
  payeeCount: 1,
  openRequests: 1,
  policy,
  stats: {
    paymentsCount: 2,
    totalPaid: "40000",
    deniedCount: 0,
    lastPaymentAt: T0 + 260,
    velocityCount: 1,
    velocityWindowStart: T0 + 260,
    strikes: 0,
    strikeWindowStart: null,
    requestNonce: "1",
  },
  allowance: {
    delegation: keys.marketDelegation,
    kind: "recurring",
    mint: keys.mint,
    amountPerPeriod: "5000000",
    periodLengthSecs: DAY,
    currentPeriodStart: T0 + 60,
    pulledInPeriod: "40000",
    amountRemaining: null,
    remaining: "4960000",
    expiresAt: T0 + 60 + 30 * DAY,
    asOf: AS_OF,
  },
  createdAt: T0 + 60,
  updatedAt: T0 + 400,
};

const researchPayee: PayeeView = {
  address: keys.researchPayeeEntry,
  agent: A,
  ...merchantPayee,
  periodStart: T0 + 120,
  spentInPeriod: "1540000",
  totalPaid: "1540000",
  paymentsCount: 4,
  createdAt: T0 + 40,
};

const marketRequest: RequestView = {
  address: keys.marketRequest0,
  agent: B,
  nonce: "0",
  payee: keys.merchant,
  amount: "1500000",
  reference: ref("market-request-0"),
  memo: "premium market report",
  status: "pending",
  createdAt: T0 + 400,
  expiresAt: T0 + 400 + policy.requestTtlSecs,
  approvedAt: null,
  rentPayer: keys.marketAgentKey,
};

// ── Write ────────────────────────────────────────────────────────────────────

function write<S extends z.ZodType>(file: string, schema: S, value: z.input<S>): void {
  const parsed = schema.parse(value);
  writeFileSync(join(OUT, file), `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`wrote fixtures/${file}`);
}

write("demo-storyline.json", DemoStorylineSchema, {
  version: 1,
  description:
    "The pitch demo: a research agent pays per call, gets one payment approved, is manipulated by a poisoned buying guide into three blocked payments to an unknown wallet, and freezes itself. A second agent waits for approval.",
  cluster: "devnet",
  keys,
  accounts: {
    delegations: [
      {
        kind: "recurring",
        address: keys.researchDelegation,
        agent: A,
        owner: keys.owner,
        mint: keys.mint,
        amountPerPeriod: "5000000",
        periodLengthSecs: DAY,
        currentPeriodStart: T0 + 20,
        expiresAt: T0 + 20 + 30 * DAY,
      },
      {
        kind: "recurring",
        address: keys.marketDelegation,
        agent: B,
        owner: keys.owner,
        mint: keys.mint,
        amountPerPeriod: "5000000",
        periodLengthSecs: DAY,
        currentPeriodStart: T0 + 60,
        expiresAt: T0 + 60 + 30 * DAY,
      },
    ],
    payeeEntries: [
      { address: keys.researchPayeeEntry, agent: A, payee: keys.merchant },
      { address: keys.marketPayeeEntry, agent: B, payee: keys.merchant },
    ],
  },
  events,
});
write("owner-overview.json", OwnerOverviewResponseSchema, {
  principal: {
    address: keys.principal,
    owner: keys.owner,
    guardian: keys.guardian,
    frozen: false,
    frozenAt: null,
    frozenBy: null,
    agentCount: 2,
    createdAt: T0,
  },
  agents: [researchAgent, marketAgent],
});
write("agent-detail.json", AgentDetailResponseSchema, {
  agent: researchAgent,
  payees: [researchPayee],
  requests: [],
});
write("requests.json", RequestsResponseSchema, { items: [marketRequest] });
write("stats-24h.json", StatsResponseSchema, {
  window: "24h",
  totals: { paid: "1580000", payments: 6, denied: 3, strikes: 3, frozenAgents: 1 },
  byAgent: [
    { agent: A, label: "Research Assistant", paid: "1540000", payments: 4, denied: 3 },
    { agent: B, label: "Market Watcher", paid: "40000", payments: 2, denied: 0 },
  ],
  byPayee: [{ payee: keys.merchant, label: "Research API", paid: "1580000", payments: 6 }],
});
