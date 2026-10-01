import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  type AgentView,
  AgentViewSchema,
  type Alert,
  AlertSchema,
  type DemoStoryline,
  DemoStorylineSchema,
  type DenialReason,
  denialInfo,
  type LeashEvent,
  LeashEventSchema,
  type OwnerOverviewResponse,
  OwnerOverviewResponseSchema,
} from "@leash/contracts";
import { expect } from "vitest";
import { DEFAULT_CONFIG, type SentinelConfig } from "../src/config.ts";
import { emptyOwnerState, type OwnerState } from "../src/rules/state.ts";
import type { RuleContext, RuleInput } from "../src/rules/types.ts";

const require = createRequire(import.meta.url);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(require.resolve(`@leash/contracts/fixtures/${name}`), "utf8"));
}

export const storyline: DemoStoryline = DemoStorylineSchema.parse(fixture("demo-storyline.json"));
export const ownerOverview: OwnerOverviewResponse = OwnerOverviewResponseSchema.parse(
  fixture("owner-overview.json"),
);

export function key(name: string): string {
  const value = storyline.keys[name];
  if (!value) throw new Error(`no storyline key ${name}`);
  return value;
}

export const OWNER = key("owner");
export const RESEARCH = key("researchAgent");
export const MARKET = key("marketAgent");
/** A third agent for hand-made sequences (any address will do). */
export const SPARE = key("researchAgentKey");
export const MERCHANT = key("merchant");
export const ATTACKER = key("attacker");
export const WEB_URL = "http://localhost:3000";
export const T0 = 1_790_000_000;
export const USDC = 1_000_000n;

export function context(overrides: Partial<SentinelConfig> = {}): RuleContext {
  return { config: { ...DEFAULT_CONFIG, ...overrides }, webUrl: WEB_URL };
}

export function freshState(): OwnerState {
  return emptyOwnerState(OWNER);
}

export const events = (list: LeashEvent[]): RuleInput[] =>
  list.map((event) => ({ kind: "event", event }));

/** Every alert must satisfy the contract (02 §12). */
export function expectValid(alerts: Alert[]): void {
  for (const alert of alerts) expect(AlertSchema.parse(alert)).toEqual(alert);
}

// ── Event factories: every event is checked against the contract schema ─────────

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let counter = 0;

function signature(): string {
  let n = ++counter;
  let suffix = "";
  while (n > 0) {
    suffix = BASE58.charAt(n % 58) + suffix;
    n = Math.floor(n / 58);
  }
  return `T${"e".repeat(55)}${suffix.padStart(8, "1")}`;
}

const policy = (() => {
  const created = storyline.events.find((e) => e.type === "AgentCreated");
  if (created?.type !== "AgentCreated") throw new Error("storyline has no AgentCreated");
  return created.policy;
})();

function event(t: number, agent: string | null, body: Record<string, unknown>): LeashEvent {
  const sig = signature();
  return LeashEventSchema.parse({
    id: `${sig}:0`,
    signature: sig,
    slot: t,
    blockTime: t,
    timestamp: t,
    principal: key("principal"),
    agent,
    ...body,
  });
}

const REF = "ab".repeat(32);

export const ev = {
  agentCreated: (t: number, agent: string, label: string, maxPerPayment = "1000000") =>
    event(t, agent, {
      type: "AgentCreated",
      agentKey: SPARE,
      mint: key("mint"),
      label,
      policy: { ...policy, maxPerPayment },
    }),
  payeeAdded: (
    t: number,
    agent: string,
    payee: string,
    label: string,
    maxPerPayment = "2000000",
    type: "PayeeAdded" | "PayeeUpdated" = "PayeeAdded",
  ) =>
    event(t, agent, {
      type,
      payee,
      label,
      maxPerPayment,
      periodLimit: "0",
      periodSecs: 0,
    }),
  paid: (
    t: number,
    agent: string,
    amount: bigint,
    options: { payee?: string; requestNonce?: string | null } = {},
  ) =>
    event(t, agent, {
      type: "PaymentExecuted",
      payee: options.payee ?? MERCHANT,
      destination: key("merchantTokenAccount"),
      mint: key("mint"),
      amount: amount.toString(),
      reference: REF,
      memo: "research",
      delegation: key("researchDelegation"),
      requestNonce: options.requestNonce ?? null,
      paymentsCount: 1,
    }),
  denied: (
    t: number,
    agent: string,
    options: {
      reason?: DenialReason;
      strikes?: number;
      tripped?: boolean;
      memo?: string;
      amount?: bigint;
    } = {},
  ) => {
    const reason = options.reason ?? "payeeNotAllowed";
    const info = denialInfo(reason);
    return event(t, agent, {
      type: "PaymentDenied",
      payee: ATTACKER,
      destination: key("attackerTokenAccount"),
      amount: (options.amount ?? 25n * USDC).toString(),
      reason,
      reasonCode: info.code,
      strike: info.strike,
      strikes: options.strikes ?? (info.strike ? 1 : 0),
      tripped: options.tripped ?? false,
      reference: REF,
      memo: options.memo ?? "tip",
    });
  },
  frozen: (t: number, agent: string, reason: "owner" | "guardian" | "tripwire" = "tripwire") =>
    event(t, agent, { type: "AgentFrozen", reason, by: SPARE }),
  unfrozen: (t: number, agent: string) => event(t, agent, { type: "AgentUnfrozen" }),
  principalFrozen: (t: number) => event(t, null, { type: "PrincipalFrozen", by: OWNER }),
  requested: (t: number, agent: string, amount: bigint, memo = "premium report") =>
    event(t, agent, {
      type: "PaymentRequested",
      request: key("researchRequest0"),
      nonce: "0",
      payee: MERCHANT,
      amount: amount.toString(),
      reference: REF,
      memo,
      expiresAt: t + 600,
    }),
};

/** An agent view from the owner-overview fixture with its allowance replaced. */
export function agentView(
  agent: string,
  allowance: Partial<NonNullable<AgentView["allowance"]>>,
  asOf: number,
): AgentView {
  const base = ownerOverview.agents.find((a) => a.address === RESEARCH);
  if (!base?.allowance) throw new Error("fixture has no research agent allowance");
  return AgentViewSchema.parse({
    ...base,
    address: agent,
    allowance: { ...base.allowance, ...allowance, asOf },
  });
}
