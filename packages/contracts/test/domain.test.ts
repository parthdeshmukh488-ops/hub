import { describe, expect, it } from "vitest";
import {
  ACTIONS_JSON,
  ActionsJsonSchema,
  AgentFrozenEventSchema,
  buildPairingUrl,
  DENIAL_TOOL_CODES,
  EventsQuerySchema,
  LEASH_EVENT_TYPES,
  LeashEventSchema,
  LeashFetchInputSchema,
  LeashPayInputSchema,
  PairingParamsSchema,
  POLICY_PRESETS,
  type PolicyView,
  parsePairingParams,
  payeeLimitsProblems,
  policyProblems,
  REPORTED_DENIAL_CODES,
  TOOL_ERROR_CODES,
  TOOL_ERROR_MESSAGES,
} from "../src/index.ts";

const NOW = 1_790_935_200;
const ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const valid: PolicyView = {
  maxPerPayment: "1000000",
  maxPerRequest: "5000000",
  payeeMode: "allowListOnly",
  velocityMaxPayments: 30,
  velocityWindowSecs: 60,
  tripwireMaxStrikes: 3,
  tripwireWindowSecs: 600,
  requestTtlSecs: 3600,
  validUntil: null,
};

describe("policyProblems (mirrors InvalidPolicy)", () => {
  it("accepts a valid policy", () => {
    expect(policyProblems(valid, NOW)).toEqual([]);
  });

  it.each<[string, Partial<PolicyView>]>([
    ["zero instant limit", { maxPerPayment: "0" }],
    ["approval limit not above instant limit", { maxPerRequest: "1000000" }],
    ["rate limit without a window", { velocityWindowSecs: 0 }],
    ["tripwire without a window", { tripwireWindowSecs: 0 }],
    ["approvals without a request lifetime", { requestTtlSecs: 0 }],
    ["request lifetime above 7 days", { requestTtlSecs: 604_801 }],
    ["expiry not in the future", { validUntil: NOW }],
  ])("rejects %s", (_label, change) => {
    expect(policyProblems({ ...valid, ...change }, NOW)).toHaveLength(1);
  });

  it("allows features to be switched off", () => {
    const off: PolicyView = {
      ...valid,
      maxPerRequest: "0",
      velocityMaxPayments: 0,
      velocityWindowSecs: 0,
      tripwireMaxStrikes: 0,
      tripwireWindowSecs: 0,
      requestTtlSecs: 0,
    };
    expect(policyProblems(off, NOW)).toEqual([]);
  });

  it("checks payee limits", () => {
    expect(
      payeeLimitsProblems({ maxPerPayment: "0", periodLimit: "1", periodSecs: 0 }),
    ).toHaveLength(1);
    expect(payeeLimitsProblems({ maxPerPayment: "0", periodLimit: "0", periodSecs: 0 })).toEqual(
      [],
    );
  });
});

describe("presets", () => {
  it("ship valid policies and payee limits", () => {
    for (const preset of Object.values(POLICY_PRESETS)) {
      if (preset.policy) expect(policyProblems(preset.policy, NOW)).toEqual([]);
      for (const payee of preset.payees) expect(payeeLimitsProblems(payee.limits)).toEqual([]);
    }
  });

  it("route the premium report (1.50 USDC) to approval, not to a strike", () => {
    const policy = POLICY_PRESETS["research-assistant"].policy;
    expect(policy).not.toBeNull();
    const premium = 1_500_000n;
    expect(premium > BigInt(policy?.maxPerPayment ?? 0)).toBe(true);
    expect(premium <= BigInt(policy?.maxPerRequest ?? 0)).toBe(true);
  });
});

describe("pairing links", () => {
  it("round-trip", () => {
    const url = buildPairingUrl("https://leash.example", {
      agentKey: ADDRESS,
      label: "Research Assistant",
      preset: "research-assistant",
      cluster: "devnet",
    });
    expect(url).toBe(
      `https://leash.example/pair?agentKey=${ADDRESS}&label=Research+Assistant&preset=research-assistant&cluster=devnet`,
    );
    expect(parsePairingParams(new URL(url).searchParams)).toEqual({
      agentKey: ADDRESS,
      label: "Research Assistant",
      preset: "research-assistant",
      cluster: "devnet",
    });
  });

  it("reject labels over 32 bytes and empty labels", () => {
    expect(
      PairingParamsSchema.safeParse({ agentKey: ADDRESS, label: "x".repeat(33) }).success,
    ).toBe(false);
    expect(PairingParamsSchema.safeParse({ agentKey: ADDRESS, label: "" }).success).toBe(false);
  });
});

describe("events", () => {
  it("cover the 18 on-chain events in spec order", () => {
    expect(LEASH_EVENT_TYPES).toEqual([
      "PrincipalInitialized",
      "GuardianChanged",
      "PrincipalFrozen",
      "PrincipalUnfrozen",
      "AgentCreated",
      "PolicyUpdated",
      "AgentFrozen",
      "AgentUnfrozen",
      "AgentClosed",
      "PayeeAdded",
      "PayeeUpdated",
      "PayeeRemoved",
      "PaymentExecuted",
      "PaymentDenied",
      "PaymentRequested",
      "RequestApproved",
      "RequestRejected",
      "RequestExpired",
    ]);
  });

  it("reject a freeze event with reason none, and unknown types", () => {
    const base = {
      id: `${"5".repeat(88)}:0`,
      signature: "5".repeat(88),
      slot: 1,
      blockTime: NOW,
      timestamp: NOW,
      principal: ADDRESS,
      agent: ADDRESS,
    };
    expect(
      AgentFrozenEventSchema.safeParse({
        ...base,
        type: "AgentFrozen",
        reason: "none",
        by: ADDRESS,
      }).success,
    ).toBe(false);
    expect(LeashEventSchema.safeParse({ ...base, type: "Nope" }).success).toBe(false);
  });
});

describe("indexer query parsing", () => {
  it("parses types and defaults the limit", () => {
    const query = EventsQuerySchema.parse({ types: "PaymentDenied,AgentFrozen" });
    expect(query.types).toEqual(["PaymentDenied", "AgentFrozen"]);
    expect(query.limit).toBe(50);
  });

  it("rejects before and after together, and limits over 200", () => {
    const id = `${"5".repeat(88)}:0`;
    expect(EventsQuerySchema.safeParse({ before: id, after: id }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("agent tools", () => {
  it("have a message for every error code", () => {
    for (const code of TOOL_ERROR_CODES)
      expect(TOOL_ERROR_MESSAGES[code].length).toBeGreaterThan(20);
  });

  it("never suggest a way around a denial", () => {
    for (const code of DENIAL_TOOL_CODES) {
      const message = TOOL_ERROR_MESSAGES[code].toLowerCase();
      expect(message).not.toMatch(/another recipient|split|smaller payments|different wallet/);
      if (code !== "APPROVAL_REQUIRED") expect(message).toContain("do not retry");
    }
  });

  it("report every denial except approval requests", () => {
    expect(REPORTED_DENIAL_CODES).not.toContain("APPROVAL_REQUIRED");
    expect(REPORTED_DENIAL_CODES).toHaveLength(DENIAL_TOOL_CODES.length - 1);
  });

  it("validate inputs", () => {
    expect(
      LeashPayInputSchema.safeParse({ to: ADDRESS, amountUsdc: "0.01", purpose: "research" })
        .success,
    ).toBe(true);
    expect(
      LeashPayInputSchema.safeParse({ to: ADDRESS, amountUsdc: "1e3", purpose: "x" }).success,
    ).toBe(false);
    expect(
      LeashFetchInputSchema.safeParse({ url: "ftp://example.com", purpose: "x" }).success,
    ).toBe(false);
    expect(
      LeashFetchInputSchema.safeParse({ url: "http://localhost:4300/api/research", purpose: "x" })
        .success,
    ).toBe(true);
  });
});

describe("Solana Actions", () => {
  it("serve a valid actions.json", () => {
    expect(ActionsJsonSchema.parse(ACTIONS_JSON)).toEqual(ACTIONS_JSON);
  });
});
