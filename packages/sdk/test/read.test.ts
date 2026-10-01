import type { Address } from "@solana/kit";
import { getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  AgentStatus,
  FreezeReason,
  getAgentEncoder,
  getPayeeEncoder,
  getPaymentRequestEncoder,
  PayeeMode,
  RequestStatus,
} from "../src/generated/leash/index.ts";
import {
  ACCOUNT_OFFSETS,
  buildOnboarding,
  fetchAgentDelegation,
  fetchAgentView,
  fetchAgentViews,
  fetchOpenRequests,
  fetchPayees,
  fetchPrincipalView,
  fetchRequestView,
  readAgentStatus,
  sendPlan,
} from "../src/index.ts";
import { createTestbed, DEMO_POLICY, TESTBED_NOW, USDC } from "../src/testing/index.ts";
import { agentOf, freezePrincipal } from "./helpers.ts";

// Build step 3: chain accounts → the contract views (02-contracts §5), on the testbed.

const T = Number(TESTBED_NOW);

describe("fetch*View", () => {
  it("reads the onboarded owner, agent and allowlist", async () => {
    const bed = await createTestbed();
    const { owner, agentKey, guardian, merchant } = bed.keys;
    expect(await fetchPrincipalView(bed.chain, owner.address)).toEqual({
      address: bed.accounts.principal,
      owner: owner.address,
      guardian: guardian.address,
      frozen: false,
      frozenAt: null,
      frozenBy: null,
      agentCount: 1,
      createdAt: T,
    });
    const agent = await fetchAgentView(bed.chain, bed.accounts.agent);
    expect(agent).toEqual({
      address: bed.accounts.agent,
      principal: bed.accounts.principal,
      owner: owner.address,
      agentKey: agentKey.address,
      mint: bed.mint,
      label: "Research agent",
      status: "active",
      freezeReason: "none",
      frozenAt: null,
      payeeCount: 1,
      openRequests: 0,
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
      stats: {
        paymentsCount: 0,
        totalPaid: "0",
        deniedCount: 0,
        lastPaymentAt: null,
        velocityCount: 0,
        velocityWindowStart: null,
        strikes: 0,
        strikeWindowStart: null,
        requestNonce: "0",
      },
      allowance: {
        delegation: bed.accounts.delegation,
        kind: "recurring",
        mint: bed.mint,
        amountPerPeriod: "5000000",
        periodLengthSecs: 86_400,
        currentPeriodStart: T,
        pulledInPeriod: "0",
        amountRemaining: null,
        remaining: "5000000",
        expiresAt: null,
        asOf: T,
      },
      createdAt: T,
      updatedAt: T,
    });
    expect(await fetchPayees(bed.chain, bed.accounts.agent)).toEqual([
      {
        address: bed.accounts.merchantEntry,
        agent: bed.accounts.agent,
        payee: merchant.address,
        label: "Research API",
        maxPerPayment: "2000000",
        periodLimit: "3000000",
        periodSecs: 86_400,
        periodStart: null,
        spentInPeriod: "0",
        totalPaid: "0",
        paymentsCount: 0,
        createdAt: T,
      },
    ]);
    expect(await fetchOpenRequests(bed.chain, bed.accounts.agent)).toEqual([]);
  });

  it("reflects payments, strikes, freezes and requests", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await agent.pay({ to: bed.keys.merchant.address, amount: USDC, purpose: "x" });
    await agent.pay({ to: bed.keys.attacker.address, amount: 1n, purpose: "x" }).catch(() => {});
    bed.advance(10n);
    const request = await agent.requestApproval({
      to: bed.keys.merchant.address,
      amount: 2n * USDC,
      purpose: "Deep report",
    });
    await freezePrincipal(bed);
    const status = await readAgentStatus(bed.chain, bed.accounts.agent);
    expect(status?.now).toBe(T + 10);
    expect(status?.principal).toMatchObject({
      frozen: true,
      frozenAt: T + 10,
      frozenBy: bed.keys.guardian.address,
    });
    expect(status?.agent.stats).toMatchObject({
      paymentsCount: 1,
      totalPaid: "1000000",
      deniedCount: 1,
      lastPaymentAt: T,
      velocityCount: 1,
      velocityWindowStart: T,
      strikes: 1,
      strikeWindowStart: T,
      requestNonce: "1",
    });
    expect(status?.agent.allowance).toMatchObject({
      pulledInPeriod: "1000000",
      remaining: "4000000",
    });
    expect(status?.payees[0]).toMatchObject({ spentInPeriod: "1000000", periodStart: T });
    const [open] = await fetchOpenRequests(bed.chain, bed.accounts.agent);
    expect(open).toMatchObject({
      address: request.address,
      nonce: "0",
      payee: bed.keys.merchant.address,
      amount: "2000000",
      memo: "Deep report",
      status: "pending",
      createdAt: T + 10,
      expiresAt: T + 10 + 3_600,
      approvedAt: null,
      rentPayer: bed.keys.agentKey.address,
    });
    expect(open?.reference).toMatch(/^[0-9a-f]{64}$/);
    // One request by its address (what a Solana Action gets): the same view, or null.
    expect(await fetchRequestView(bed.chain, request.address as Address)).toEqual(open);
    expect(await fetchRequestView(bed.chain, bed.keys.stranger.address)).toBeNull();
    expect(await fetchRequestView(bed.chain, bed.accounts.agent)).toBeNull();
  });

  it("lists every agent of an owner, oldest first", async () => {
    const bed = await createTestbed();
    bed.advance(5n);
    const plan = await buildOnboarding(bed.chain, {
      owner: bed.keys.owner,
      agentKey: bed.keys.stranger.address,
      mint: bed.mint,
      label: "Second",
      policy: DEMO_POLICY,
      allowance: { kind: "fixed", amount: USDC },
    });
    await sendPlan(bed.chain, { feePayer: bed.keys.owner, transactions: plan.transactions });
    const views = await fetchAgentViews(bed.chain, bed.keys.owner.address);
    expect(views.map((v) => v.label)).toEqual(["Research agent", "Second"]);
    expect(views[1]?.allowance?.asOf).toBe(T + 5);
    expect(await fetchAgentViews(bed.chain, bed.keys.stranger.address, { now: 1n })).toEqual([]);
  });

  it("returns null for anything that is not what was asked for", async () => {
    const bed = await createTestbed();
    const { stranger, merchant } = bed.keys;
    expect(await fetchPrincipalView(bed.chain, stranger.address)).toBeNull();
    // Missing, not owned by Leash, and a Leash account of another type.
    expect(await fetchAgentView(bed.chain, stranger.address)).toBeNull();
    expect(await fetchAgentView(bed.chain, bed.accounts.merchantTokenAccount)).toBeNull();
    expect(await fetchAgentView(bed.chain, bed.accounts.principal)).toBeNull();
    expect(await readAgentStatus(bed.chain, merchant.address)).toBeNull();
    // A principal that no longer decodes.
    const principal = bed.svm.getAccount(bed.accounts.principal);
    if (!principal.exists) throw new Error("no principal");
    bed.svm.setAccount({ ...principal, data: new Uint8Array(principal.data.length) });
    expect(await readAgentStatus(bed.chain, bed.accounts.agent)).toBeNull();
  });

  it("finds no allowance in a delegation that funds someone else or is not a delegation", async () => {
    const bed = await createTestbed();
    const agent = await fetchAgentView(bed.chain, bed.accounts.agent);
    if (agent === null) throw new Error("no agent");
    const account = { owner: agent.owner as Address, mint: agent.mint as Address };
    // The right delegation, looked up as another agent's.
    expect(
      await fetchAgentDelegation(
        bed.chain,
        bed.keys.stranger.address,
        account,
        bed.accounts.delegation,
      ),
    ).toBeNull();
    // A Subscriptions account that is not a delegation, and a missing account.
    expect(
      await fetchAgentDelegation(
        bed.chain,
        bed.accounts.agent,
        account,
        bed.accounts.subscriptionAuthority,
      ),
    ).toBeNull();
    expect(
      await fetchAgentDelegation(bed.chain, bed.accounts.agent, account, bed.keys.stranger.address),
    ).toBeNull();
    expect(
      (await fetchAgentView(bed.chain, bed.accounts.agent, { delegation: bed.accounts.agent }))
        ?.allowance,
    ).toBeNull();
  });
});

describe("ACCOUNT_OFFSETS", () => {
  it("point at the fields the list queries filter on", () => {
    const marker = "Leash11111111111111111111111111111111111111" as Address;
    const bytes = getAddressEncoder().encode(marker);
    const at = (data: ReadonlyUint8Array, offset: number) => [
      ...data.subarray(offset, offset + 32),
    ];
    const zero = "11111111111111111111111111111111" as Address;
    const policy = {
      maxPerPayment: 1n,
      maxPerRequest: 0n,
      payeeMode: PayeeMode.AllowListOnly,
      velocityMaxPayments: 0,
      velocityWindowSecs: 0,
      tripwireMaxStrikes: 0,
      tripwireWindowSecs: 0,
      requestTtlSecs: 0,
      validUntil: 0n,
    };
    const agent = getAgentEncoder().encode({
      version: 1,
      bump: 255,
      principal: zero,
      owner: marker,
      agentKey: zero,
      mint: zero,
      label: new Uint8Array(32),
      status: AgentStatus.Active,
      freezeReason: FreezeReason.None,
      frozenAt: 0n,
      payeeCount: 0,
      openRequests: 0,
      policy,
      stats: {
        paymentsCount: 0n,
        totalPaid: 0n,
        deniedCount: 0n,
        lastPaymentAt: 0n,
        velocityWindowStart: 0n,
        velocityCount: 0,
        strikeWindowStart: 0n,
        strikes: 0,
        requestNonce: 0n,
      },
      createdAt: 0n,
      updatedAt: 0n,
      reserved: new Uint8Array(64),
    });
    expect(at(agent, ACCOUNT_OFFSETS.agentOwner)).toEqual([...bytes]);
    const payee = getPayeeEncoder().encode({
      version: 1,
      bump: 255,
      agent: marker,
      payee: zero,
      label: new Uint8Array(32),
      maxPerPayment: 0n,
      periodLimit: 0n,
      periodSecs: 0,
      periodStart: 0n,
      spentInPeriod: 0n,
      totalPaid: 0n,
      paymentsCount: 0n,
      createdAt: 0n,
      reserved: new Uint8Array(32),
    });
    expect(at(payee, ACCOUNT_OFFSETS.payeeAgent)).toEqual([...bytes]);
    const request = getPaymentRequestEncoder().encode({
      version: 1,
      bump: 255,
      agent: marker,
      nonce: 0n,
      payee: zero,
      amount: 0n,
      reference: new Uint8Array(32),
      memo: new Uint8Array(64),
      status: RequestStatus.Pending,
      createdAt: 0n,
      expiresAt: 0n,
      approvedAt: 0n,
      rentPayer: zero,
      reserved: new Uint8Array(32),
    });
    expect(at(request, ACCOUNT_OFFSETS.requestAgent)).toEqual([...bytes]);
  });
});

type ReadonlyUint8Array = Parameters<ReturnType<typeof getAgentEncoder>["encode"]>[0]["label"];
