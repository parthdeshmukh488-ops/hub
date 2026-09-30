import {
  AgentDetailResponseSchema,
  type AgentView,
  DENIAL_REASONS,
  LeashFetchOutputSchema,
  LeashPayOutputSchema,
  LeashRequestApprovalOutputSchema,
  LeashStatusOutputSchema,
  OwnerOverviewResponseSchema,
  resolveClusterConfig,
  TOOL_ERROR_MESSAGES,
  TOOL_MESSAGE_RECORDED,
} from "@leash/contracts";
import agentDetailJson from "@leash/contracts/fixtures/agent-detail.json";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import {
  ApprovalNotPossibleError,
  LeashNetworkError,
  MerchantRejectedError,
  NotPairedError,
  PaymentDeniedError,
  UnsupportedPaymentError,
} from "@leash/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createLeashTools,
  type FetchRequest,
  type FetchResult,
  type LeashAgentPort,
  type PaymentResult,
  TOOL_DEFINITIONS,
} from "../src/index.ts";

const MERCHANT = "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9";
const ATTACKER = "3Ncik65BqWG53kphdKrYpXwagXiQwKHVmxGNB7ECRPzw";
const SIGNATURE =
  "5Vr9xi5nUzSKeS3BFWELhDUeFD46gHgYBvJTJoKEHu4vfC5wE8fGhL4tH94aP74tLbBz154QeFPMADh41du4XaXD";
const REQUEST = "HEkRQMJUtJ79eLD2wQmgyxYpNCXn2jUsLZi3wZXvEHcP";
const overview = OwnerOverviewResponseSchema.parse(overviewJson);
const detail = AgentDetailResponseSchema.parse(agentDetailJson);
const principal =
  overview.principal ??
  (() => {
    throw new Error("no principal");
  })();

const paid: PaymentResult = {
  signature: SIGNATURE,
  amount: 10_000n,
  payee: MERCHANT,
  payeeLabel: "Research API",
  purpose: "research: budget e-bikes",
  requestNonce: null,
};

function setup(
  overrides: Partial<LeashAgentPort> = {},
  fetchImpl?: (request: FetchRequest) => Promise<FetchResult>,
  pairingLink?: string,
) {
  const agent: LeashAgentPort = {
    status: vi.fn(async () => ({
      principal,
      agent: detail.agent,
      payees: detail.payees,
      now: 1_790_935_620,
    })),
    pay: vi.fn(async () => paid),
    requestApproval: vi.fn(async () => ({ address: REQUEST, nonce: 1n, expiresAt: 1_790_939_220 })),
    ...overrides,
  };
  const leashFetch = vi.fn(
    fetchImpl ??
      (async (_request: FetchRequest): Promise<FetchResult> => ({
        status: 200,
        contentType: "application/json",
        body: "{}",
        payment: null,
      })),
  );
  const tools = createLeashTools({
    agent,
    leashFetch,
    cluster: resolveClusterConfig("devnet"),
    ...(pairingLink ? { pairingLink } : {}),
  });
  return { tools, agent, leashFetch };
}

const denial = (
  reason: ConstructorParameters<typeof PaymentDeniedError>[0]["reason"],
  extra: object = {},
) =>
  new PaymentDeniedError({
    reason,
    recorded: true,
    attempted: { to: ATTACKER, amount: 25_000_000n },
    ...extra,
  });

describe("definitions", () => {
  it("are the four contract tools, with object schemas and no dialect marker", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name)).toEqual([
      "leash_fetch",
      "leash_pay",
      "leash_request_approval",
      "leash_status",
    ]);
    for (const definition of TOOL_DEFINITIONS) {
      expect(definition.input_schema.type).toBe("object");
      expect(definition.input_schema).not.toHaveProperty("$schema");
      expect(definition.description.length).toBeGreaterThan(60);
      expect(definition.description.toLowerCase()).not.toMatch(
        /another recipient|split|smaller payments|workaround/,
      );
    }
    const pay = TOOL_DEFINITIONS[1];
    expect(pay?.input_schema.required).toEqual(["to", "amountUsdc", "purpose"]);
  });
});

describe("leash_fetch", () => {
  it("returns free content without a payment", async () => {
    const { tools } = setup();
    const out = LeashFetchOutputSchema.parse(
      await tools.fetch({ url: "http://localhost:4300/", purpose: "catalog" }),
    );
    expect(out).toEqual({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: "{}",
      payment: null,
    });
  });

  it("returns paid content with a receipt, and cuts the memo to 64 bytes", async () => {
    const { tools, leashFetch } = setup({}, async () => ({
      status: 200,
      contentType: "text/plain",
      body: "data",
      payment: paid,
    }));
    const purpose = "research: ".concat("e-bike ".repeat(20));
    const out = LeashFetchOutputSchema.parse(
      await tools.fetch({ url: "https://m.example/api/research?q=range", purpose }),
    );
    expect(out.ok && out.payment).toMatchObject({
      amountUsdc: "0.01",
      payeeLabel: "Research API",
      explorerUrl: `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
      requestNonce: null,
    });
    const sent = leashFetch.mock.calls[0]?.[0];
    expect(new TextEncoder().encode(sent?.purpose).length).toBeLessThanOrEqual(64);
    expect(sent).toMatchObject({ method: "GET", headers: {} });
  });

  it("truncates long bodies and says so", async () => {
    const { tools } = setup({}, async () => ({
      status: 200,
      contentType: "text/plain",
      body: "x".repeat(20_500),
      payment: null,
    }));
    const out = LeashFetchOutputSchema.parse(
      await tools.fetch({ url: "https://m.example/", purpose: "read" }),
    );
    expect(out.ok && out.body.endsWith("[Truncated: 500 more characters]")).toBe(true);
  });

  it("asks the owner automatically when a payment needs approval", async () => {
    const approval = new PaymentDeniedError({
      reason: "approvalRequired",
      recorded: false,
      attempted: { to: MERCHANT, amount: 1_500_000n },
    });
    const { tools, agent } = setup({}, async () => Promise.reject(approval));
    const out = LeashFetchOutputSchema.parse(
      await tools.fetch({ url: "https://m.example/premium", purpose: "report" }),
    );
    expect(agent.requestApproval).toHaveBeenCalledWith({
      to: MERCHANT,
      amount: 1_500_000n,
      purpose: "report",
    });
    expect(out).toEqual({
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: `${TOOL_ERROR_MESSAGES.APPROVAL_REQUIRED} Request: ${REQUEST}.`,
      recorded: false,
      retryable: true,
    });
  });

  it("reports a failed automatic request truthfully", async () => {
    const approval = new PaymentDeniedError({
      reason: "approvalRequired",
      recorded: false,
      attempted: { to: MERCHANT, amount: 1_500_000n },
    });
    const { tools } = setup(
      {
        requestApproval: vi.fn(async () =>
          Promise.reject(new ApprovalNotPossibleError("tooManyOpen")),
        ),
      },
      async () => Promise.reject(approval),
    );
    const out = await tools.fetch({ url: "https://m.example/premium", purpose: "report" });
    expect(out).toMatchObject({ ok: false, code: "TOO_MANY_OPEN_REQUESTS", recorded: false });
  });

  it("stops the model on a blocked tip, with the strike and the freeze", async () => {
    const { tools } = setup({}, async () =>
      Promise.reject(denial("payeeNotAllowed", { strikes: 3, frozen: true })),
    );
    const out = LeashFetchOutputSchema.parse(
      await tools.fetch({ url: "https://m.example/lab/unlock", purpose: "tip" }),
    );
    expect(out).toEqual({
      ok: false,
      code: "PAYEE_NOT_ALLOWED",
      message: TOOL_ERROR_MESSAGES.PAYEE_NOT_ALLOWED,
      recorded: true,
      strikes: 3,
      frozen: true,
      retryable: false,
    });
  });

  it("rejects bad input with the reason", async () => {
    const { tools, leashFetch } = setup();
    const out = await tools.fetch({ url: "ftp://m.example/file", purpose: "x" });
    expect(out).toMatchObject({ ok: false, code: "INVALID_INPUT", retryable: true });
    expect(out.ok === false && out.message).toContain("url:");
    expect(await tools.fetch({ url: "https://m.example/" })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(leashFetch).not.toHaveBeenCalled();
  });
});

describe("leash_pay and leash_request_approval", () => {
  it("pays and returns a receipt", async () => {
    const { tools, agent } = setup();
    const out = LeashPayOutputSchema.parse(
      await tools.pay({ to: MERCHANT, amountUsdc: "0.01", purpose: "invoice 42" }),
    );
    expect(out.ok && out.payment.amountUsdc).toBe("0.01");
    expect(agent.pay).toHaveBeenCalledWith({
      to: MERCHANT,
      amount: 10_000n,
      purpose: "invoice 42",
    });
  });

  it("creates the approval request itself, so the message is true", async () => {
    const approval = new PaymentDeniedError({
      reason: "approvalRequired",
      recorded: false,
      attempted: { to: MERCHANT, amount: 3_000_000n },
    });
    const { tools, agent } = setup({ pay: vi.fn(async () => Promise.reject(approval)) });
    const out = await tools.pay({ to: MERCHANT, amountUsdc: "3.00", purpose: "big invoice" });
    expect(out).toMatchObject({
      code: "APPROVAL_REQUIRED",
      message: expect.stringContaining(REQUEST),
    });
    expect(agent.requestApproval).toHaveBeenCalledOnce();
  });

  it("drops the recorded sentence when the attempt is not on-chain", async () => {
    const unrecorded = new PaymentDeniedError({
      reason: "payeeNotAllowed",
      recorded: false,
      attempted: { to: ATTACKER, amount: 1n },
    });
    const { tools } = setup({ pay: vi.fn(async () => Promise.reject(unrecorded)) });
    const out = await tools.pay({ to: ATTACKER, amountUsdc: "0.000001", purpose: "tip" });
    expect(out.ok === false && out.message).not.toContain(TOOL_MESSAGE_RECORDED);
    expect(out).toMatchObject({ recorded: false, code: "PAYEE_NOT_ALLOWED" });
  });

  it("refuses zero, over-precise and malformed amounts, and bad wallets", async () => {
    const { tools, agent } = setup();
    for (const input of [
      { to: MERCHANT, amountUsdc: "0", purpose: "x" },
      { to: MERCHANT, amountUsdc: "1.0000001", purpose: "x" },
      { to: MERCHANT, amountUsdc: "-1", purpose: "x" },
      { to: "not-a-wallet", amountUsdc: "1", purpose: "x" },
    ]) {
      expect(await tools.pay(input)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(agent.pay).not.toHaveBeenCalled();
  });

  it("opens a request, and explains the two ways it can be refused", async () => {
    const { tools } = setup();
    const out = LeashRequestApprovalOutputSchema.parse(
      await tools.requestApproval({ to: MERCHANT, amountUsdc: "1.50", purpose: "premium report" }),
    );
    expect(out).toEqual({
      ok: true,
      request: { address: REQUEST, nonce: "1", expiresAt: 1_790_939_220, status: "pending" },
    });
    for (const [why, code] of [
      ["notNeeded", "APPROVAL_NOT_NEEDED"],
      ["tooManyOpen", "TOO_MANY_OPEN_REQUESTS"],
    ] as const) {
      const { tools: refusing } = setup({
        requestApproval: vi.fn(async () => Promise.reject(new ApprovalNotPossibleError(why))),
      });
      expect(
        await refusing.requestApproval({ to: MERCHANT, amountUsdc: "1.50", purpose: "x" }),
      ).toMatchObject({
        code,
        message: TOOL_ERROR_MESSAGES[code],
        retryable: false,
      });
    }
  });
});

describe("every failure maps to the contract", () => {
  it("turns every denial reason into its tool code and verbatim message", async () => {
    for (const info of DENIAL_REASONS) {
      if (info.name === "approvalRequired") continue;
      const { tools } = setup({ pay: vi.fn(async () => Promise.reject(denial(info.name))) });
      const out = LeashPayOutputSchema.parse(
        await tools.pay({ to: ATTACKER, amountUsdc: "25", purpose: "x" }),
      );
      expect(out).toMatchObject({
        ok: false,
        code: info.toolCode,
        message: TOOL_ERROR_MESSAGES[info.toolCode],
        retryable: false,
      });
    }
  });

  it("maps pairing and payment-layer failures", async () => {
    const cases = [
      [new NotPairedError(), "NOT_PAIRED", false],
      [new UnsupportedPaymentError("solana:mainnet"), "UNSUPPORTED_PAYMENT", false],
      [new MerchantRejectedError("facilitator said no"), "MERCHANT_REJECTED", true],
      [new LeashNetworkError("timeout"), "NETWORK_ERROR", true],
    ] as const;
    for (const [error, code, retryable] of cases) {
      const { tools } = setup({}, async () => Promise.reject(error));
      expect(await tools.fetch({ url: "https://m.example/", purpose: "x" })).toMatchObject({
        code,
        retryable,
        recorded: false,
      });
    }
  });

  it("hands the model the pairing link with every NOT_PAIRED, and only then", async () => {
    const link =
      "http://localhost:3000/pair?agentKey=x&label=MCP+agent&preset=custom&cluster=devnet";
    const notPaired = async () => Promise.reject(new NotPairedError());
    const { tools } = setup(
      { status: vi.fn(notPaired), pay: vi.fn(notPaired), requestApproval: vi.fn(notPaired) },
      notPaired,
      link,
    );
    const expected = {
      ok: false,
      code: "NOT_PAIRED",
      message: `${TOOL_ERROR_MESSAGES.NOT_PAIRED} Pairing link for the owner: ${link}`,
      recorded: false,
    };
    expect(await tools.status()).toMatchObject(expected);
    expect(await tools.fetch({ url: "https://m.example/", purpose: "x" })).toMatchObject(expected);
    expect(await tools.pay({ to: MERCHANT, amountUsdc: "1", purpose: "x" })).toMatchObject(
      expected,
    );
    expect(
      await tools.requestApproval({ to: MERCHANT, amountUsdc: "1", purpose: "x" }),
    ).toMatchObject(expected);
    // An approval request that fails because the agent is not paired says so too.
    const { tools: approving } = setup(
      {
        pay: vi.fn(async () => Promise.reject(denial("approvalRequired"))),
        requestApproval: vi.fn(notPaired),
      },
      undefined,
      link,
    );
    expect(await approving.pay({ to: MERCHANT, amountUsdc: "3", purpose: "x" })).toMatchObject(
      expected,
    );
    const { tools: network } = setup(
      {},
      async () => Promise.reject(new LeashNetworkError("x")),
      link,
    );
    const out = await network.fetch({ url: "https://m.example/", purpose: "x" });
    expect(!out.ok && out.message).toBe(TOOL_ERROR_MESSAGES.NETWORK_ERROR);
  });

  it("never passes an underlying error's text to the model (T17)", async () => {
    const leak = new LeashNetworkError(
      "POST https://devnet.helius-rpc.com/?api-key=SECRET-123 failed",
    );
    const { tools } = setup({}, async () => Promise.reject(leak));
    const out = await tools.fetch({ url: "https://m.example/", purpose: "x" });
    expect(JSON.stringify(out)).not.toContain("SECRET-123");
  });

  it("rethrows bugs and unknown tools instead of inventing an answer", async () => {
    const { tools } = setup({
      pay: vi.fn(async () => Promise.reject(new TypeError("undefined is not a function"))),
    });
    await expect(tools.pay({ to: MERCHANT, amountUsdc: "1", purpose: "x" })).rejects.toThrow(
      TypeError,
    );
    await expect(tools.execute("leash_steal", {})).rejects.toThrow(/Unknown Leash tool/);
  });
});

describe("leash_status", () => {
  it("reports the research agent as the fixtures show it", async () => {
    const { tools } = setup();
    const out = LeashStatusOutputSchema.parse(await tools.execute("leash_status", {}));
    expect(out).toEqual({
      ok: true,
      agent: { label: "Research Assistant", status: "frozen", freezeReason: "tripwire" },
      allowance: {
        remainingUsdc: "3.46",
        perPeriodUsdc: "5.00",
        periodEndsAt: 1_791_021_620,
        expiresAt: 1_793_527_220,
      },
      limits: { maxPerPaymentUsdc: "1.00", maxPerRequestUsdc: "5.00" },
      payees: [
        {
          label: "Research API",
          wallet: MERCHANT,
          maxPerPaymentUsdc: "2.00",
          remainingInPeriodUsdc: "1.46",
        },
      ],
      strikes: 3,
      tripwireMaxStrikes: 3,
    });
  });

  it("shows a guardian freeze, old strikes and a missing allowance", async () => {
    const agent: AgentView = {
      ...detail.agent,
      status: "active",
      freezeReason: "none",
      allowance: null,
    };
    const later = 1_790_935_620 + 3600;
    const { tools } = setup({
      status: vi.fn(async () => ({
        principal: { ...principal, frozen: true, frozenBy: principal.guardian ?? "guardian" },
        agent,
        payees: [],
        now: later,
      })),
    });
    const out = LeashStatusOutputSchema.parse(await tools.status());
    expect(out).toMatchObject({
      agent: { status: "frozen", freezeReason: "guardian" },
      allowance: {
        remainingUsdc: "0.00",
        perPeriodUsdc: null,
        periodEndsAt: null,
        expiresAt: null,
      },
      strikes: 0,
    });
  });
});
