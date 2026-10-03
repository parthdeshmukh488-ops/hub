import { createHash } from "node:crypto";
import { referenceToHex } from "@leash/contracts";
import {
  type Address,
  getSolanaErrorFromTransactionError,
  lamports,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SolanaError,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { describe, expect, it } from "vitest";
import {
  ApprovalNotPossibleError,
  buildApproveRequest,
  buildFreezeAgent,
  buildRevokeAllowance,
  buildUnfreezePrincipal,
  decodeLeashEvents,
  evaluationFailure,
  fetchOpenRequests,
  LEASH_PROGRAM_ADDRESS,
  LeashAgent,
  LeashNetworkError,
  LeashProgramError,
  NotPairedError,
  TransactionFailedError,
  UnsupportedPaymentError,
} from "../src/index.ts";
import { createTestbed, DEMO_POLICY, type Testbed, USDC } from "../src/testing/index.ts";
import { agentOf, expectDenied, freezePrincipal, send, wrapChain } from "./helpers.ts";

// LeashAgent against the real binaries (ADR-0002, the reporting policy, the approval errors).

const NO_PAYEE_LIMITS = { maxPerPayment: 0n, periodLimit: 0n, periodSecs: 0 };

async function approve(bed: Testbed, request: string) {
  return send(
    bed,
    bed.keys.owner,
    buildApproveRequest({
      owner: bed.keys.owner,
      agent: bed.accounts.agent,
      request: request as never,
    }),
  );
}

describe("pay", () => {
  it("pays an allowlisted payee and returns the receipt of PaymentExecuted", async () => {
    const bed = await createTestbed();
    const { agent, warnings } = agentOf(bed);
    const receipt = await agent.pay({
      to: bed.keys.merchant.address,
      amount: USDC / 2n,
      purpose: "Research API: one report",
    });
    expect(receipt).toMatchObject({
      amount: USDC / 2n,
      payee: bed.keys.merchant.address,
      payeeLabel: "Research API",
      purpose: "Research API: one report",
      requestNonce: null,
      destination: bed.accounts.merchantTokenAccount,
    });
    expect(receipt.reference).toMatch(/^[0-9a-f]{64}$/);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(USDC / 2n);
    expect(await bed.balanceOf(bed.keys.owner.address)).toBe(100n * USDC - USDC / 2n);
    const status = await agent.status();
    expect(status.agent.stats).toMatchObject({ paymentsCount: 1, totalPaid: "500000" });
    expect(status.agent.allowance?.remaining).toBe("4500000");
    expect(status.payees[0]?.spentInPeriod).toBe("500000");
    expect(warnings).toEqual([]);
  });

  it("blocks and records payees that are not on the allowlist, and the third strike freezes the agent", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const attempt = () =>
      agent.pay({ to: bed.keys.attacker.address, amount: USDC / 2n, purpose: "exfiltrate" });
    await expectDenied(attempt(), { reason: "payeeNotAllowed", recorded: true, strikes: 1 });
    await expectDenied(attempt(), { reason: "payeeNotAllowed", recorded: true, strikes: 2 });
    await expectDenied(attempt(), {
      reason: "payeeNotAllowed",
      recorded: true,
      strikes: 3,
      frozen: true,
    });
    expect(await bed.balanceOf(bed.keys.attacker.address)).toBe(0n);
    const { agent: view } = await agent.status();
    expect(view).toMatchObject({ status: "frozen", freezeReason: "tripwire" });
    expect(view.stats.deniedCount).toBe(3);
    // Frozen now: even the merchant is blocked.
    await expectDenied(
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "after the freeze" }),
      { reason: "agentFrozen", recorded: true, frozen: false },
    );
  });

  it("records non-strike denials at most once per reason a minute", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await send(
      bed,
      bed.keys.owner,
      buildFreezeAgent({
        authority: bed.keys.owner,
        owner: bed.keys.owner.address,
        agent: bed.accounts.agent,
      }),
    );
    const attempt = () => agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" });
    await expectDenied(attempt(), { reason: "agentFrozen", recorded: true, strikes: 0 });
    await expectDenied(attempt(), { reason: "agentFrozen", recorded: false });
    bed.advance(59n);
    await expectDenied(attempt(), { reason: "agentFrozen", recorded: false });
    bed.advance(1n);
    await expectDenied(attempt(), { reason: "agentFrozen", recorded: true });
    expect((await agent.status()).agent.stats.deniedCount).toBe(2);
  });

  it("never records approvalRequired", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await expectDenied(
      agent.pay({ to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "big report" }),
      { reason: "approvalRequired", recorded: false },
    );
    expect((await agent.status()).agent.stats.deniedCount).toBe(0);
  });

  it("pays with an approved request for the same payee and amount, and consumes it", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const payment = { to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "big report" };
    const pending = await agent.requestApproval(payment);
    expect(pending).toMatchObject({ nonce: 0n, expiresAt: Number(bed.now()) + 3_600 });
    const [open] = await fetchOpenRequests(bed.chain, bed.accounts.agent);
    expect(open).toMatchObject({ address: pending.address, status: "pending", amount: "2000000" });

    // Pending is not enough.
    await expectDenied(agent.pay(payment), { reason: "approvalRequired", recorded: false });
    await approve(bed, pending.address);
    const receipt = await agent.pay(payment);
    expect(receipt).toMatchObject({ amount: 2n * USDC, requestNonce: 0n });
    expect(receipt.reference).toBe(open?.reference);
    expect(await fetchOpenRequests(bed.chain, bed.accounts.agent)).toEqual([]);
    // The request is gone: the same payment needs approval again.
    await expectDenied(agent.pay(payment), { reason: "approvalRequired", recorded: false });
  });

  it("stops at the allowance (I1) and pays again in the next period", async () => {
    const bed = await createTestbed({ merchant: NO_PAYEE_LIMITS });
    const { agent } = agentOf(bed);
    const pay = () => agent.pay({ to: bed.keys.merchant.address, amount: USDC, purpose: "x" });
    for (let i = 0; i < 5; i++) await pay();
    await expectDenied(pay(), { reason: "allowanceExceeded", recorded: true, strikes: 0 });
    bed.advance(86_400n);
    await expect(pay()).resolves.toMatchObject({ amount: USDC });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(6n * USDC);
  });

  it("enforces the payee's period budget and the rate limit", async () => {
    const bed = await createTestbed({
      policy: { ...DEMO_POLICY, velocityMaxPayments: 4, velocityWindowSecs: 60 },
    });
    const { agent } = agentOf(bed);
    const pay = (amount: bigint) =>
      agent.pay({ to: bed.keys.merchant.address, amount, purpose: "x" });
    await pay(USDC);
    await pay(USDC);
    await pay(USDC);
    await expectDenied(pay(1n), { reason: "exceedsPayeePeriodLimit", recorded: true });
    bed.advance(86_400n);
    await pay(1n);
    await pay(1n);
    await pay(1n);
    await pay(1n);
    await expectDenied(pay(1n), { reason: "velocityExceeded", recorded: true });
  });

  it("stops every agent while the principal is frozen, and resumes after the owner unfreezes", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await freezePrincipal(bed);
    await expectDenied(agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }), {
      reason: "principalFrozen",
      recorded: true,
    });
    await send(bed, bed.keys.owner, buildUnfreezePrincipal({ owner: bed.keys.owner }));
    await expect(
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).resolves.toMatchObject({ amount: 1n });
  });

  it("treats a revoked allowance as expired, without a report", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await send(
      bed,
      bed.keys.owner,
      buildRevokeAllowance({ owner: bed.keys.owner, delegation: bed.accounts.delegation }),
    );
    await expectDenied(agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }), {
      reason: "allowanceExpired",
      recorded: false,
    });
    expect(
      await agent.simulatePay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).toEqual({ outcome: "denied", reason: "allowanceExpired", strike: false });
    const { agent: view } = await agent.status();
    expect(view.allowance).toBeNull();
    expect(view.stats.deniedCount).toBe(0);
  });

  it("creates the payee's token account when the policy allows the payment", async () => {
    const bed = await createTestbed({ policy: { ...DEMO_POLICY, payeeMode: "anyPayee" } });
    const { agent } = agentOf(bed);
    const receipt = await agent.pay({
      to: bed.keys.stranger.address,
      amount: USDC / 4n,
      purpose: "new supplier",
    });
    expect(receipt).toMatchObject({ payee: bed.keys.stranger.address, payeeLabel: null });
    expect(await bed.balanceOf(bed.keys.stranger.address)).toBe(USDC / 4n);
  });

  it("cannot record a denied payment to a wallet without a token account", async () => {
    const bed = await createTestbed();
    const { agent, warnings } = agentOf(bed);
    await expectDenied(agent.pay({ to: bed.keys.stranger.address, amount: 1n, purpose: "x" }), {
      reason: "payeeNotAllowed",
      recorded: false,
    });
    expect(warnings).toEqual([
      "leash: denied payment to a wallet without a token account; not recorded",
    ]);
    expect((await agent.status()).agent.stats.deniedCount).toBe(0);
  });

  it("returns the earlier payment for a repeated reference", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const reference = new Uint8Array(32).fill(7);
    const payment = { to: bed.keys.merchant.address, amount: 3n, purpose: "x", reference };
    const first = await agent.pay(payment);
    const second = await agent.pay(payment);
    expect(second).toEqual(first);
    expect(first.reference).toBe(referenceToHex(reference));
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(3n);
  });

  it("runs concurrent payments one at a time", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const receipts = await Promise.all(
      [1n, 2n, 3n].map((amount) =>
        agent.pay({ to: bed.keys.merchant.address, amount, purpose: "x" }),
      ),
    );
    expect(new Set(receipts.map((r) => r.signature)).size).toBe(3);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(6n);
    // A failure does not block the queue.
    const results = await Promise.allSettled([
      agent.pay({ to: bed.keys.attacker.address, amount: 1n, purpose: "x" }),
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
  });

  it("throws NotPairedError for an agent key the owner never paired", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed, { signer: bed.keys.stranger });
    await expect(
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).rejects.toBeInstanceOf(NotPairedError);
    await expect(agent.status()).rejects.toBeInstanceOf(NotPairedError);
  });

  it("forgets a closed agent", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" });
    const account = bed.svm.getAccount(bed.accounts.principal);
    if (!account.exists) throw new Error("no principal");
    bed.svm.setAccount({ ...account, data: new Uint8Array(account.data.length) });
    await expect(
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).rejects.toBeInstanceOf(NotPairedError);
  });

  it("fails with TransactionFailedError when the agent key cannot pay the fee", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    bed.svm.setAccount({
      address: bed.keys.agentKey.address,
      data: new Uint8Array(),
      executable: false,
      lamports: lamports(0n),
      programAddress: "11111111111111111111111111111111" as never,
      space: 0n,
    });
    const error = await agent
      .pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionFailedError);
    expect(error).toMatchObject({ reason: "AccountNotFound" });
  });

  it("warns when the agent key is low on SOL", async () => {
    const bed = await createTestbed();
    const { agent, warnings } = agentOf(bed);
    const key = bed.svm.getAccount(bed.keys.agentKey.address);
    if (!key.exists) throw new Error("no agent key");
    bed.svm.setAccount({ ...key, lamports: lamports(5_000_000n) });
    await agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" });
    expect(warnings).toContain("leash: the agent key is low on SOL; it pays for its own reports");
  });

  it("trusts the simulation over its own evaluation and logs the mismatch", async () => {
    const bed = await createTestbed();
    // The SDK sees an unfrozen principal while the chain has it frozen.
    await freezePrincipal(bed);
    const stale = wrapChain(bed.chain, {
      getAccounts: async (addresses) =>
        (await bed.chain.getAccounts(addresses)).map((account) =>
          account.exists && account.address === bed.accounts.principal
            ? { ...account, data: Uint8Array.from(account.data, (b, i) => (i === 74 ? 0 : b)) }
            : account,
        ),
    });
    const { agent, warnings } = agentOf(bed, { chain: stale });
    await expectDenied(agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }), {
      reason: "principalFrozen",
      recorded: true,
    });
    expect(warnings).toEqual(["leash: PARITY MISMATCH between the SDK evaluator and the program"]);
  });

  it("pays when the simulation allows what its own evaluation denied, and logs the mismatch", async () => {
    const bed = await createTestbed();
    const stale = wrapChain(bed.chain, {
      getAccounts: async (addresses) =>
        (await bed.chain.getAccounts(addresses)).map((account) =>
          account.exists && account.address === bed.accounts.principal
            ? { ...account, data: Uint8Array.from(account.data, (b, i) => (i === 74 ? 1 : b)) }
            : account,
        ),
    });
    const { agent, warnings } = agentOf(bed, { chain: stale });
    await expect(
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).resolves.toMatchObject({ amount: 1n });
    expect(warnings).toEqual(["leash: PARITY MISMATCH between the SDK evaluator and the program"]);
  });

  it("records a denial that appears between simulation and send", async () => {
    const bed = await createTestbed();
    let raced = false;
    const racing = wrapChain(bed.chain, {
      sendAndConfirm: async (transaction) => {
        if (!raced) {
          raced = true;
          await freezePrincipal(bed);
        }
        return bed.chain.sendAndConfirm(transaction);
      },
    });
    const { agent } = agentOf(bed, { chain: racing });
    await expectDenied(agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }), {
      reason: "principalFrozen",
      recorded: true,
    });
  });

  it("classifies failed sends that are not denials", async () => {
    const bed = await createTestbed();
    const failing = (error: unknown) =>
      agentOf(bed, {
        chain: wrapChain(bed.chain, {
          sendAndConfirm: async () => {
            throw error;
          },
        }),
      }).agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" });
    const preflight = (cause: unknown) =>
      new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
        cause,
      } as never);

    await expect(failing(new Error("socket hang up"))).rejects.toBeInstanceOf(LeashNetworkError);
    await expect(failing(preflight(new Error("?")))).rejects.toThrow(
      /Network error: Solana error -32002/,
    );
    await expect(
      failing(preflight(getSolanaErrorFromTransactionError("InsufficientFundsForFee"))),
    ).rejects.toBeInstanceOf(TransactionFailedError);
    await expect(
      failing(
        preflight(getSolanaErrorFromTransactionError({ InstructionError: [2, { Custom: 6019 }] })),
      ),
    ).rejects.toMatchObject({ programError: "DelegationMismatch" });
  });

  it("throws the denial unrecorded when its report fails", async () => {
    const bed = await createTestbed();
    const offline = wrapChain(bed.chain, {
      sendAndConfirm: async () => {
        throw new Error("offline");
      },
    });
    const { agent, warnings } = agentOf(bed, { chain: offline });
    await expectDenied(agent.pay({ to: bed.keys.attacker.address, amount: 1n, purpose: "x" }), {
      reason: "payeeNotAllowed",
      recorded: false,
    });
    expect(warnings).toEqual(["leash: could not record a denied payment"]);
  });

  it("rejects program errors that are not denials", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    // Paying the agent's own key is a client bug (InvalidDestination), never a denial.
    await bed.setBalance(bed.keys.agentKey.address, 0n);
    const error = await agent
      .pay({ to: bed.keys.agentKey.address, amount: 1n, purpose: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LeashProgramError);
    expect(error).toMatchObject({ programError: "InvalidDestination" });
    // An evaluation error for a wallet without a token account (amount 0 is InvalidAmount).
    await expect(
      agent.pay({ to: bed.keys.stranger.address, amount: 0n, purpose: "x" }),
    ).rejects.toMatchObject({ programError: "InvalidAmount" });
  });
});

describe("requestApproval", () => {
  it("records a request to a payee that is not on the allowlist", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await expectDenied(
      agent.requestApproval({ to: bed.keys.attacker.address, amount: 2n * USDC, purpose: "x" }),
      { reason: "payeeNotAllowed", recorded: true, strikes: 1 },
    );
  });

  it("records a request above the approval limit", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await expectDenied(
      agent.requestApproval({ to: bed.keys.merchant.address, amount: 6n * USDC, purpose: "x" }),
      { reason: "exceedsPaymentLimit", recorded: true, strikes: 1 },
    );
  });

  it("refuses a request the instant limit already covers", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await expect(
      agent.requestApproval({ to: bed.keys.merchant.address, amount: USDC / 2n, purpose: "x" }),
    ).rejects.toEqual(new ApprovalNotPossibleError("notNeeded"));
  });

  it("treats disabled approvals as exceedsPaymentLimit", async () => {
    const bed = await createTestbed({ policy: { ...DEMO_POLICY, maxPerRequest: 0n } });
    const { agent } = agentOf(bed);
    await expectDenied(
      agent.requestApproval({ to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" }),
      { reason: "exceedsPaymentLimit", recorded: true },
    );
  });

  it("refuses a ninth open request", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const request = () =>
      agent.requestApproval({ to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" });
    for (let i = 0; i < 8; i++) await request();
    await expect(request()).rejects.toEqual(new ApprovalNotPossibleError("tooManyOpen"));
    expect(await fetchOpenRequests(bed.chain, bed.accounts.agent)).toHaveLength(8);
  });

  it("records a denial that appears between simulation and send", async () => {
    const bed = await createTestbed();
    let raced = false;
    const racing = wrapChain(bed.chain, {
      sendAndConfirm: async (transaction) => {
        if (!raced) {
          raced = true;
          await freezePrincipal(bed);
        }
        return bed.chain.sendAndConfirm(transaction);
      },
    });
    const { agent } = agentOf(bed, { chain: racing });
    await expectDenied(
      agent.requestApproval({ to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" }),
      { reason: "principalFrozen", recorded: true },
    );
    const offline = agentOf(bed, {
      chain: wrapChain(bed.chain, {
        sendAndConfirm: async () => {
          throw new Error("offline");
        },
        simulate: async () => ({ err: null, logs: [], unitsConsumed: 10_000n }),
      }),
    });
    await expect(
      offline.agent.requestApproval({
        to: bed.keys.merchant.address,
        amount: 2n * USDC,
        purpose: "x",
      }),
    ).rejects.toBeInstanceOf(LeashNetworkError);
  });
});

describe("buildPayInstruction", () => {
  it("builds the x402 shape: another fee payer, the agent key signs only pay", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const memo = "x402:5f0c2a";
    const reference = new Uint8Array(createHash("sha256").update(memo).digest());
    const pay = await agent.buildPayInstruction({
      to: bed.keys.merchant.address,
      amount: USDC / 10n,
      purpose: "Research API",
      reference,
    });
    const facilitator = bed.keys.stranger;
    // The SPL Memo program of the x402 profile (02 §9); @solana-program/memo 0.15 defaults to a
    // newer program.
    const splMemo = { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address };
    const record = await bed.send(facilitator, [pay, getAddMemoInstruction({ memo }, splMemo)]);
    const [executed] = decodeLeashEvents(record).filter((e) => e.type === "PaymentExecuted");
    expect(executed).toMatchObject({ amount: "100000", reference: referenceToHex(reference) });
  });

  it("attaches an approved request with the same reference", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const reference = new Uint8Array(32).fill(9);
    const payment = { to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x", reference };
    const pending = await agent.requestApproval(payment);
    await approve(bed, pending.address);
    const other = await agent.buildPayInstruction({ ...payment, reference: new Uint8Array(32) });
    await expect(bed.send(bed.keys.agentKey, [other])).rejects.toThrow();
    const record = await bed.send(bed.keys.agentKey, [await agent.buildPayInstruction(payment)]);
    const [executed] = decodeLeashEvents(record).filter((e) => e.type === "PaymentExecuted");
    expect(executed).toMatchObject({ requestNonce: "0" });
  });
});

describe("reportDenied", () => {
  it("records a denied payment", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const report = await agent.reportDenied({
      to: bed.keys.attacker.address,
      amount: 1n,
      purpose: "x",
      reference: new Uint8Array(32),
    });
    expect(report).toMatchObject({
      reason: "payeeNotAllowed",
      strike: true,
      strikes: 1,
      frozen: false,
    });
  });

  it("refuses to record a payment that would succeed", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    await expect(
      agent.reportDenied({
        to: bed.keys.merchant.address,
        amount: 1n,
        purpose: "x",
        reference: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ programError: "AttemptWouldSucceed" });
  });
});

describe("simulatePay and options", () => {
  it("predicts pay without sending anything", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const to = bed.keys.merchant.address;
    expect(await agent.simulatePay({ to, amount: 1n, purpose: "x" })).toMatchObject({
      outcome: "allowed",
    });
    expect(await agent.simulatePay({ to, amount: 2n * USDC, purpose: "x" })).toEqual({
      outcome: "denied",
      reason: "approvalRequired",
      strike: false,
    });
    expect(bed.chain.history).toHaveLength(1); // onboarding only
  });

  it("names its keys and validates the priority fee", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    expect(agent.address).toBe(bed.keys.agentKey.address);
    expect(await agent.agentAddress()).toBe(bed.accounts.agent);
    const make = (priorityFeeMicroLamports: bigint) =>
      new LeashAgent({
        chain: bed.chain,
        signer: bed.keys.agentKey,
        owner: bed.keys.owner.address,
        priorityFeeMicroLamports,
      });
    expect(() => make(-1n)).toThrow(RangeError);
    expect(() => make(50_001n)).toThrow(RangeError);
    expect(() => make(50_000n)).not.toThrow();
  });
});

describe("edge cases", () => {
  it("pays from an explicit delegation, and finds no allowance in anything else", async () => {
    const bed = await createTestbed();
    const to = bed.keys.merchant.address;
    const explicit = agentOf(bed, { delegation: bed.accounts.delegation }).agent;
    expect((await explicit.status()).agent.allowance?.remaining).toBe("5000000");
    await explicit.pay({ to, amount: 1n, purpose: "x" });
    // Not a delegation (the Subscription Authority), and another agent's delegation.
    for (const delegation of [bed.accounts.subscriptionAuthority, bed.accounts.merchantEntry]) {
      const { agent } = agentOf(bed, { delegation });
      expect((await agent.status()).agent.allowance).toBeNull();
      await expectDenied(agent.pay({ to, amount: 1n, purpose: "x" }), {
        reason: "allowanceExpired",
        recorded: false,
      });
    }
  });

  it("predicts a payment that an approved request covers", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const payment = { to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" };
    await approve(bed, (await agent.requestApproval(payment)).address);
    expect(await agent.simulatePay(payment)).toMatchObject({
      outcome: "allowed",
      effects: { consumesRequest: true },
    });
    expect(
      await agent.simulatePay({ ...payment, amount: 1n, reference: new Uint8Array(32) }),
    ).toMatchObject({ outcome: "allowed", effects: { consumesRequest: false } });
  });

  it("uses the oldest of two approved requests", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const payment = { to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" };
    const first = await agent.requestApproval(payment);
    const second = await agent.requestApproval(payment);
    await approve(bed, second.address);
    await approve(bed, first.address);
    expect((await agent.pay(payment)).requestNonce).toBe(0n);
    expect((await fetchOpenRequests(bed.chain, bed.accounts.agent)).map((r) => r.nonce)).toEqual([
      "1",
    ]);
  });

  it("cannot report a payment to a wallet without a token account, or without an allowance", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const report = (to: string) =>
      agent.reportDenied({ to, amount: 1n, purpose: "x", reference: new Uint8Array(32) });
    await expect(report(bed.keys.stranger.address)).rejects.toBeInstanceOf(TransactionFailedError);
    await send(
      bed,
      bed.keys.owner,
      buildRevokeAllowance({ owner: bed.keys.owner, delegation: bed.accounts.delegation }),
    );
    await expect(report(bed.keys.attacker.address)).rejects.toMatchObject({
      programError: "DelegationMismatch",
    });
  });

  it("fails cleanly when the owner closed their token account or the mint is gone", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const erase = (address: Address) =>
      bed.svm.setAccount({
        address,
        data: new Uint8Array(),
        executable: false,
        lamports: lamports(0n),
        programAddress: "11111111111111111111111111111111" as Address,
        space: 0n,
      });
    erase(bed.accounts.ownerTokenAccount);
    await expect(
      agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).rejects.toBeInstanceOf(TransactionFailedError);
    erase(bed.mint);
    const fresh = agentOf(bed).agent;
    await expect(
      fresh.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).rejects.toThrow(/mint .* does not exist/);
  });

  it("names simulation errors it does not know", async () => {
    const bed = await createTestbed();
    const simulating = (err: unknown) =>
      agentOf(bed, {
        chain: wrapChain(bed.chain, {
          simulate: async () => ({ err, logs: [], unitsConsumed: 0n }),
        }),
      }).agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" });
    await expect(
      simulating({ InstructionError: [2, "MissingRequiredSignature"] }),
    ).rejects.toMatchObject({ reason: "InstructionError" });
    await expect(simulating({})).rejects.toMatchObject({ reason: "Unknown" });
    // An instruction error at send time is a transaction failure too.
    const failing = agentOf(bed, {
      chain: wrapChain(bed.chain, {
        sendAndConfirm: async () => {
          throw getSolanaErrorFromTransactionError({
            InstructionError: [2, "MissingRequiredSignature"],
          });
        },
      }),
    }).agent;
    await expect(
      failing.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" }),
    ).rejects.toBeInstanceOf(TransactionFailedError);
  });

  it("refuses a confirmation that lacks its event", async () => {
    const bed = await createTestbed();
    const eventless = wrapChain(bed.chain, {
      sendAndConfirm: async (transaction) => ({
        ...(await bed.chain.sendAndConfirm(transaction)),
        innerInstructions: [],
      }),
    });
    const { agent } = agentOf(bed, { chain: eventless });
    const to = bed.keys.merchant.address;
    await expect(agent.pay({ to, amount: 1n, purpose: "x" })).rejects.toThrow(
      /confirmed without PaymentExecuted/,
    );
    await expect(agent.requestApproval({ to, amount: 2n * USDC, purpose: "x" })).rejects.toThrow(
      /confirmed without PaymentRequested/,
    );
    await expect(
      agent.reportDenied({
        to: bed.keys.attacker.address,
        amount: 1n,
        purpose: "x",
        reference: new Uint8Array(32),
      }),
    ).rejects.toThrow(/confirmed without PaymentDenied/);
  });

  it("records nothing when a report throws something that is not an Error", async () => {
    const bed = await createTestbed();
    const offline = wrapChain(bed.chain, {
      sendAndConfirm: async () => {
        throw "offline";
      },
    });
    const { agent } = agentOf(bed, { chain: offline });
    await expectDenied(agent.pay({ to: bed.keys.attacker.address, amount: 1n, purpose: "x" }), {
      reason: "payeeNotAllowed",
      recorded: false,
    });
  });

  it("maps every evaluation error to its program error", () => {
    const errors = [
      "InvalidAmount",
      "RequestMismatch",
      "RequestNotApproved",
      "RequestExpired",
      "UnsupportedDelegation",
      "MathOverflow",
    ] as const;
    for (const error of errors) expect(evaluationFailure(error).name).toBe(error);
    expect(() => evaluationFailure("Nope" as never)).toThrow("unknown evaluation error Nope");
  });
});

describe("round trips", () => {
  it("fetches one blockhash per operation, read alongside the accounts", async () => {
    const bed = await createTestbed();
    let blockhashes = 0;
    const chain = wrapChain(bed.chain, {
      getLatestBlockhash: () => {
        blockhashes += 1;
        return bed.chain.getLatestBlockhash();
      },
    });
    const { agent } = agentOf(bed, { chain });
    const count = async (operation: () => Promise<unknown>) => {
      blockhashes = 0;
      await operation().catch(() => undefined);
      return blockhashes;
    };
    const merchant = { to: bed.keys.merchant.address, purpose: "x" };
    // Simulation and send share it; so do the denied payment's simulation, report and send.
    expect(await count(() => agent.pay({ ...merchant, amount: 1n }))).toBe(1);
    expect(
      await count(() => agent.pay({ to: bed.keys.attacker.address, amount: 1n, purpose: "x" })),
    ).toBe(1);
    expect(await count(() => agent.requestApproval({ ...merchant, amount: 2n * USDC }))).toBe(1);
    // x402 builds its transaction on the simulation's blockhash.
    const prepared = await agent.preparePayment({
      ...merchant,
      amount: 1n,
      reference: new Uint8Array(32),
    });
    expect(prepared.lifetime).toEqual(await bed.chain.getLatestBlockhash());
  });
});

describe("preparePayment (the x402 path)", () => {
  it("returns a checked pay instruction without sending anything", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    expect(await agent.mint()).toBe(bed.mint);
    const reference = new Uint8Array(32).fill(3);
    const prepared = await agent.preparePayment({
      to: bed.keys.merchant.address,
      amount: 5n,
      purpose: "x402",
      reference,
    });
    expect(prepared).toMatchObject({
      requestNonce: null,
      payeeLabel: "Research API",
      purpose: "x402",
      reference,
    });
    expect(prepared.instruction.programAddress).toBe(LEASH_PROGRAM_ADDRESS);
    expect(prepared.unitsConsumed).toBeGreaterThan(0n);
    expect(bed.chain.history).toHaveLength(1); // onboarding only: nothing was sent
    // The instruction pays when someone else sends it.
    await bed.send(bed.keys.agentKey, [prepared.instruction]);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(5n);
  });

  it("uses an approved request and its reference, reports denials, and needs a token account", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const payment = { to: bed.keys.merchant.address, amount: 2n * USDC, purpose: "x" };
    const pending = await agent.requestApproval(payment);
    await approve(bed, pending.address);
    const [open] = await fetchOpenRequests(bed.chain, bed.accounts.agent);
    const prepared = await agent.preparePayment({ ...payment, reference: new Uint8Array(32) });
    expect(prepared.requestNonce).toBe(0n);
    expect(referenceToHex(prepared.reference)).toBe(open?.reference);

    await expectDenied(
      agent.preparePayment({
        to: bed.keys.attacker.address,
        amount: 1n,
        purpose: "x",
        reference: new Uint8Array(32),
      }),
      { reason: "payeeNotAllowed", recorded: true, strikes: 1 },
    );
    await expect(
      agent.preparePayment({
        to: bed.keys.stranger.address,
        amount: 1n,
        purpose: "x",
        reference: new Uint8Array(32),
      }),
    ).rejects.toBeInstanceOf(UnsupportedPaymentError);
  });
});
