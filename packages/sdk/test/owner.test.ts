import type { LeashEvent } from "@leash/contracts";
import { type Address, createKeyPairSignerFromPrivateKeyBytes, lamports } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  buildAddPayee,
  buildAllowance,
  buildApproveRequest,
  buildCloseAgent,
  buildExpireRequest,
  buildFreezeAgent,
  buildOnboarding,
  buildRejectRequest,
  buildRemovePayee,
  buildRevokeAllowance,
  buildSetGuardian,
  buildUnfreezeAgent,
  buildUpdatePayee,
  buildUpdatePolicy,
  decodeLeashEvents,
  fetchAgentView,
  fetchOpenRequests,
  fetchPayees,
  fetchPrincipalView,
  findAgentPda,
  findPrincipalPda,
  LeashProgramError,
  packTransactions,
  sendPlan,
  UNKNOWN_SUBSCRIPTION_AUTHORITY_INIT_ID,
} from "../src/index.ts";
import {
  createTestbed,
  DEMO_MERCHANT_LIMITS,
  DEMO_POLICY,
  testKeySeed,
  USDC,
} from "../src/testing/index.ts";
import { agentOf, send } from "./helpers.ts";

// The owner builders against the real binaries: every instruction once, with its event, plus
// the authority checks the SDK relies on.

const types = (events: readonly LeashEvent[]) => events.map((e) => e.type);

describe("buildOnboarding", () => {
  it("puts an agent on a leash in one transaction, and skips what exists", async () => {
    const bed = await createTestbed();
    expect(bed.onboarding.transactions).toHaveLength(1);
    const [record] = bed.chain.history;
    if (!record) throw new Error("no onboarding transaction");
    expect(types(decodeLeashEvents(record))).toEqual([
      "PrincipalInitialized",
      "AgentCreated",
      "PayeeAdded",
    ]);
    const again = await buildOnboarding(bed.chain, {
      owner: bed.keys.owner,
      agentKey: bed.keys.agentKey.address,
      mint: bed.mint,
      label: "Research agent",
      policy: DEMO_POLICY,
      allowance: { kind: "recurring", amountPerPeriod: USDC, periodLengthSecs: 60n },
      payees: [
        { payee: bed.keys.merchant.address, label: "Research API", limits: DEMO_MERCHANT_LIMITS },
      ],
    });
    expect(again.transactions).toEqual([]);
    expect(again).toMatchObject({ agent: bed.accounts.agent, delegation: bed.accounts.delegation });
  });

  it("adds a second agent under the existing principal and Subscription Authority", async () => {
    const bed = await createTestbed();
    const secondKey = bed.keys.stranger.address;
    const plan = await buildOnboarding(bed.chain, {
      owner: bed.keys.owner,
      agentKey: secondKey,
      mint: bed.mint,
      label: "Travel agent",
      policy: { ...DEMO_POLICY, payeeMode: "anyPayee" },
      allowance: { kind: "fixed", amount: 2n * USDC, expiryTs: bed.now() + 86_400n },
    });
    // The authority exists: the delegation names its real init id, no create instructions.
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.purpose).toBe("create the agent, grant the allowance");
    await sendPlan(bed.chain, { feePayer: bed.keys.owner, transactions: plan.transactions });
    const view = await fetchAgentView(bed.chain, plan.agent);
    expect(view).toMatchObject({ label: "Travel agent", payeeCount: 0 });
    expect(view?.allowance).toMatchObject({
      kind: "fixed",
      remaining: "2000000",
      amountRemaining: "2000000",
      expiresAt: Number(bed.now()) + 86_400,
    });
    expect((await fetchPrincipalView(bed.chain, bed.keys.owner.address))?.agentCount).toBe(2);
  });

  it("splits a long allowlist over several transactions and creates a missing token account", async () => {
    const bed = await createTestbed();
    // A new owner without a token account for the mint, and ten payees.
    const owner = await createKeyPairSignerFromPrivateKeyBytes(await testKeySeed("owner2"));
    bed.svm.airdrop(owner.address, lamports(10_000_000_000n));
    const payees = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => ({
        payee: (await createKeyPairSignerFromPrivateKeyBytes(await testKeySeed(`payee${i}`)))
          .address,
        label: `Payee ${i}`,
        limits: DEMO_MERCHANT_LIMITS,
      })),
    );
    const plan = await buildOnboarding(bed.chain, {
      owner,
      agentKey: bed.keys.agentKey.address,
      mint: bed.mint,
      label: "Agent",
      policy: DEMO_POLICY,
      allowance: { kind: "recurring", amountPerPeriod: USDC, periodLengthSecs: 3_600n },
      guardian: null,
    });
    expect(plan.transactions).toHaveLength(1);
    const withPayees = await buildOnboarding(bed.chain, {
      owner,
      agentKey: bed.keys.agentKey.address,
      mint: bed.mint,
      label: "Agent",
      policy: DEMO_POLICY,
      allowance: { kind: "recurring", amountPerPeriod: USDC, periodLengthSecs: 3_600n },
      payees,
    });
    expect(withPayees.transactions.length).toBeGreaterThan(1);
    // The Subscription Authority and its delegation never end up in different transactions.
    const first = withPayees.transactions[0]?.purpose ?? "";
    expect(first).toContain("grant the allowance");
    await sendPlan(bed.chain, { feePayer: owner, transactions: withPayees.transactions });
    expect(await fetchPayees(bed.chain, withPayees.agent)).toHaveLength(10);
    expect(await bed.balanceOf(owner.address)).toBe(0n);
    const principal = await fetchPrincipalView(bed.chain, owner.address);
    expect(principal?.guardian).toBeNull();
  });

  it("refuses a mint that does not exist", async () => {
    const bed = await createTestbed();
    await expect(
      buildOnboarding(bed.chain, {
        owner: bed.keys.owner,
        agentKey: bed.keys.stranger.address,
        mint: bed.keys.stranger.address,
        label: "x",
        policy: DEMO_POLICY,
        allowance: { kind: "fixed", amount: 1n },
      }),
    ).rejects.toThrow(/is not a token mint/);
    await expect(
      buildAllowance(bed.chain, {
        owner: bed.keys.owner,
        agent: bed.accounts.agent,
        mint: bed.keys.attacker.address,
        allowance: { kind: "fixed", amount: 1n },
      }),
    ).rejects.toThrow(/is not a token mint/);
  });
});

describe("allowance builders", () => {
  it("revokes an allowance and grants a new one", async () => {
    const bed = await createTestbed();
    await send(
      bed,
      bed.keys.owner,
      buildRevokeAllowance({ owner: bed.keys.owner, delegation: bed.accounts.delegation }),
    );
    expect((await fetchAgentView(bed.chain, bed.accounts.agent))?.allowance).toBeNull();
    const { delegation, instructions } = await buildAllowance(bed.chain, {
      owner: bed.keys.owner,
      agent: bed.accounts.agent,
      mint: bed.mint,
      allowance: { kind: "recurring", amountPerPeriod: 2n * USDC, periodLengthSecs: 86_400n },
    });
    expect(delegation).toBe(bed.accounts.delegation);
    await bed.send(bed.keys.owner, instructions);
    const view = await fetchAgentView(bed.chain, bed.accounts.agent);
    expect(view?.allowance).toMatchObject({ amountPerPeriod: "2000000", remaining: "2000000" });
    const { agent } = agentOf(bed);
    await agent.pay({ to: bed.keys.merchant.address, amount: USDC, purpose: "x" });
  });

  it("uses Subscriptions' sentinel only when the authority is created alongside", () => {
    expect(UNKNOWN_SUBSCRIPTION_AUTHORITY_INIT_ID).toBe(-(2n ** 63n));
  });
});

describe("admin builders", () => {
  it("update the policy and the allowlist", async () => {
    const bed = await createTestbed();
    const { owner } = bed.keys;
    const agent = bed.accounts.agent;
    const policy = { ...DEMO_POLICY, maxPerPayment: 2n * USDC, validUntil: bed.now() + 3_600n };
    const updated = await send(bed, owner, buildUpdatePolicy({ owner, agent, policy }));
    expect(types(decodeLeashEvents(updated))).toEqual(["PolicyUpdated"]);
    expect((await fetchAgentView(bed.chain, agent))?.policy).toMatchObject({
      maxPerPayment: "2000000",
      validUntil: Number(bed.now()) + 3_600,
    });

    const payee = bed.keys.stranger.address;
    const limits = { maxPerPayment: 0n, periodLimit: 0n, periodSecs: 0 };
    await send(bed, owner, buildAddPayee({ owner, agent, payee, label: "Stranger", limits }));
    await send(
      bed,
      owner,
      buildUpdatePayee({ owner, agent, payee, label: "Known", limits: DEMO_MERCHANT_LIMITS }),
    );
    const known = (await fetchPayees(bed.chain, agent)).find((p) => p.payee === payee);
    expect(known).toMatchObject({ label: "Known", maxPerPayment: "2000000" });
    const removed = await send(bed, owner, buildRemovePayee({ owner, agent, payee }));
    expect(types(decodeLeashEvents(removed))).toEqual(["PayeeRemoved"]);
    expect(await fetchPayees(bed.chain, agent)).toHaveLength(1);
  });

  it("freeze: owner or guardian; unfreeze: owner only (I3)", async () => {
    const bed = await createTestbed();
    const { owner, guardian, stranger } = bed.keys;
    const agent = bed.accounts.agent;
    const freeze = (authority: typeof owner) =>
      send(bed, authority, buildFreezeAgent({ authority, owner: owner.address, agent }));
    await expect(freeze(stranger)).rejects.toThrow();
    const frozen = await freeze(guardian);
    expect(decodeLeashEvents(frozen)[0]).toMatchObject({
      type: "AgentFrozen",
      reason: "guardian",
      by: guardian.address,
    });
    // The guardian cannot unfreeze: the builder signs with it as "owner", the program refuses.
    await expect(
      send(bed, guardian, buildUnfreezeAgent({ owner: guardian, agent })),
    ).rejects.toThrow();
    await send(bed, owner, buildUnfreezeAgent({ owner, agent }));
    expect((await fetchAgentView(bed.chain, agent))?.status).toBe("active");
  });

  it("clear an active agent's leftover strikes with a freeze and an unfreeze in one transaction", async () => {
    const bed = await createTestbed();
    const { owner } = bed.keys;
    const { agent: leash } = agentOf(bed);
    const agent = bed.accounts.agent;
    await leash
      .pay({ to: bed.keys.attacker.address, amount: 1n, purpose: "x" })
      .catch(() => undefined);
    expect((await fetchAgentView(bed.chain, agent))?.stats.strikes).toBe(1);
    // unfreeze_agent alone leaves an active agent's strikes alone (01 §6)...
    await bed.send(owner, [await buildUnfreezeAgent({ owner, agent })]);
    expect((await fetchAgentView(bed.chain, agent))?.stats.strikes).toBe(1);
    // ...so `pnpm owner:unfreeze` freezes and unfreezes in one transaction.
    await bed.send(owner, [
      await buildFreezeAgent({ authority: owner, owner: owner.address, agent }),
      await buildUnfreezeAgent({ owner, agent }),
    ]);
    const view = await fetchAgentView(bed.chain, agent);
    expect(view).toMatchObject({ status: "active", stats: { strikes: 0 } });
  });

  it("change the guardian", async () => {
    const bed = await createTestbed();
    const { owner, stranger } = bed.keys;
    await send(bed, owner, buildSetGuardian({ owner, guardian: stranger.address }));
    expect((await fetchPrincipalView(bed.chain, owner.address))?.guardian).toBe(stranger.address);
    await send(bed, owner, buildSetGuardian({ owner, guardian: null }));
    expect((await fetchPrincipalView(bed.chain, owner.address))?.guardian).toBeNull();
  });

  it("approve, reject and expire requests", async () => {
    const bed = await createTestbed();
    const { owner, guardian, stranger } = bed.keys;
    const { agent } = agentOf(bed);
    const agentPda = bed.accounts.agent;
    const request = () =>
      agent.requestApproval({ to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" });
    const [a, b, c] = [await request(), await request(), await request()];
    if (!a || !b || !c) throw new Error("no requests");
    const rentReceiver = bed.keys.agentKey.address;

    await send(
      bed,
      owner,
      buildApproveRequest({ owner, agent: agentPda, request: a.address as Address }),
    );
    const rejected = await send(
      bed,
      guardian,
      buildRejectRequest({
        authority: guardian,
        owner: owner.address,
        agent: agentPda,
        request: b.address as Address,
        rentReceiver,
      }),
    );
    expect(decodeLeashEvents(rejected)[0]).toMatchObject({ type: "RequestRejected", nonce: "1" });

    const expire = () =>
      send(
        bed,
        stranger,
        buildExpireRequest({ agent: agentPda, request: c.address as Address, rentReceiver }),
      );
    await expect(expire()).rejects.toThrow();
    bed.advance(3_600n);
    const expired = await expire();
    expect(decodeLeashEvents(expired)[0]).toMatchObject({ type: "RequestExpired", nonce: "2" });

    const open = await fetchOpenRequests(bed.chain, agentPda);
    expect(open.map((r) => [r.nonce, r.status])).toEqual([["0", "approved"]]);
    expect(open[0]?.approvedAt).toBe(Number(bed.now()) - 3_600);
  });

  it("close an agent once its allowlist is empty", async () => {
    const bed = await createTestbed();
    const { owner } = bed.keys;
    const agent = bed.accounts.agent;
    const close = () => send(bed, owner, buildCloseAgent({ owner, agent }));
    await expect(close()).rejects.toThrow();
    await send(bed, owner, buildRemovePayee({ owner, agent, payee: bed.keys.merchant.address }));
    const closed = await close();
    expect(types(decodeLeashEvents(closed))).toEqual(["AgentClosed"]);
    expect(await fetchAgentView(bed.chain, agent)).toBeNull();
    expect((await fetchPrincipalView(bed.chain, owner.address))?.agentCount).toBe(0);
  });

  it("surface program errors through the kit error chain", async () => {
    const bed = await createTestbed();
    const { stranger } = bed.keys;
    // A stranger "owns" no principal: Anchor refuses the missing account, not a Leash denial.
    const principal = await findPrincipalPda(stranger.address);
    const error = await send(
      bed,
      stranger,
      buildUpdatePolicy({
        owner: stranger,
        agent: await findAgentPda(principal, stranger.address),
        policy: DEMO_POLICY,
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LeashProgramError);
  });
});

describe("packTransactions", () => {
  it("skips empty groups and refuses a group that cannot fit", async () => {
    const bed = await createTestbed();
    const { owner } = bed.keys;
    const ix = await buildSetGuardian({ owner, guardian: bed.keys.stranger.address });
    expect(packTransactions(owner, [{ purpose: "nothing", instructions: [] }])).toEqual([]);
    expect(() =>
      packTransactions(owner, [{ purpose: "huge", instructions: Array(40).fill(ix) }]),
    ).toThrow('"huge" does not fit a transaction');
  });
});
