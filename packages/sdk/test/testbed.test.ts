import { getTokenDecoder } from "@solana-program/token";
import { describe, expect, it } from "vitest";
import {
  clockUnixTimestamp,
  decodeDelegation,
  LEASH_PROGRAM_ADDRESS,
  readChainTime,
  SYSVAR_CLOCK_ADDRESS,
} from "../src/index.ts";
import { createTestbed, TESTBED_NOW, toRpcTransactionError, USDC } from "../src/testing/index.ts";
import { agentOf } from "./helpers.ts";

// @leash/sdk/testing: what other workstreams' tests rely on.

describe("createTestbed", () => {
  it("funds the owner and delegates the allowance to the Agent PDA", async () => {
    const bed = await createTestbed();
    expect(await bed.balanceOf(bed.keys.owner.address)).toBe(100n * USDC);
    expect(await bed.balanceOf(bed.keys.stranger.address)).toBe(0n);
    const ownerAccount = bed.svm.getAccount(bed.accounts.ownerTokenAccount);
    if (!ownerAccount.exists) throw new Error("no owner token account");
    const token = getTokenDecoder().decode(ownerAccount.data);
    // InitSubscriptionAuthority made the authority the SPL delegate of the owner's account.
    expect(token.delegate).toEqual({ __option: "Some", value: bed.accounts.subscriptionAuthority });

    const delegationAccount = bed.svm.getAccount(bed.accounts.delegation);
    if (!delegationAccount.exists) throw new Error("no delegation");
    const delegation = decodeDelegation(
      bed.accounts.delegation,
      new Uint8Array(delegationAccount.data),
    );
    expect(delegation).toMatchObject({
      delegator: bed.keys.owner.address,
      delegatee: bed.accounts.agent,
      mint: bed.mint,
      state: { kind: "recurring", amountPerPeriod: 5n * USDC, currentPeriodStart: TESTBED_NOW },
    });
  });

  it("controls the clock and keeps the authority's approval when setting balances", async () => {
    const bed = await createTestbed({ now: 1_000n, ownerUsdc: 7n });
    expect(bed.now()).toBe(1_000n);
    bed.advance(5n);
    expect(await readChainTime(bed.chain)).toBe(1_005n);
    bed.setTime(2_000n);
    expect(bed.now()).toBe(2_000n);

    await bed.setBalance(bed.keys.owner.address, 3n * USDC);
    expect(await bed.balanceOf(bed.keys.owner.address)).toBe(3n * USDC);
    const { agent } = agentOf(bed);
    // Still pays through the authority's delegate approval.
    await agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "x" });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(1n);
  });

  it("takes options for the scenario", async () => {
    const bed = await createTestbed({
      guardian: false,
      merchant: null,
      allowance: { kind: "fixed", amount: 3n },
    });
    const { agent } = agentOf(bed);
    const status = await agent.status();
    expect(status.principal.guardian).toBeNull();
    expect(status.payees).toEqual([]);
    expect(status.agent.allowance).toMatchObject({ kind: "fixed", remaining: "3" });
  });
});

describe("litesvmChain", () => {
  it("filters program accounts and lists recent transactions, newest first", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const first = await agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "a" });
    const second = await agent.pay({ to: bed.keys.merchant.address, amount: 2n, purpose: "b" });
    const recent = await bed.chain.getRecentTransactions(bed.accounts.agent, 2);
    expect(recent.map((r) => r.signature)).toEqual([second.signature, first.signature]);
    expect(await bed.chain.getRecentTransactions(bed.keys.attacker.address, 5)).toEqual([]);
    expect(bed.chain.history).toHaveLength(3);

    const principals = await bed.chain.getProgramAccounts(LEASH_PROGRAM_ADDRESS, [
      { dataSize: 191 },
    ]);
    expect(principals.map((a) => a.address)).toEqual([bed.accounts.principal]);
    const none = await bed.chain.getProgramAccounts(LEASH_PROGRAM_ADDRESS, [
      { memcmp: { offset: 400, bytes: new Uint8Array([1]) } },
    ]);
    expect(none).toEqual([]);
  });

  it("pages the transactions that touched an address like getSignaturesForAddress", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const first = await agent.pay({ to: bed.keys.merchant.address, amount: 1n, purpose: "a" });
    const second = await agent.pay({ to: bed.keys.merchant.address, amount: 2n, purpose: "b" });
    const all = await bed.chain.getSignatures(LEASH_PROGRAM_ADDRESS, { limit: 10 });
    // Onboarding, then the two payments, newest first.
    expect(all.map((s) => s.signature)).toEqual([
      second.signature,
      first.signature,
      bed.chain.history[0]?.signature,
    ]);
    expect(all[0]).toEqual({
      signature: second.signature,
      slot: expect.any(BigInt),
      err: null,
      blockTime: TESTBED_NOW,
    });
    const page = (p: { limit: number; before?: string; until?: string }) =>
      bed.chain
        .getSignatures(LEASH_PROGRAM_ADDRESS, p)
        .then((list) => list.map((s) => s.signature));
    expect(await page({ limit: 1 })).toEqual([second.signature]);
    expect(await page({ limit: 5, before: second.signature })).toEqual(
      all.slice(1).map((s) => s.signature),
    );
    expect(await page({ limit: 5, until: first.signature })).toEqual([second.signature]);
    expect(await page({ limit: 5, before: second.signature, until: first.signature })).toEqual([]);
    expect(await page({ limit: 5, before: "unknown" })).toEqual([]);
    expect(await bed.chain.getSignatures(bed.keys.attacker.address, { limit: 5 })).toEqual([]);

    expect(await bed.chain.getTransactionRecord(first.signature)).toEqual(bed.chain.history[1]);
    expect(await bed.chain.getTransactionRecord("unknown")).toBeNull();
  });

  it("reads the clock sysvar and refuses anything else", async () => {
    const bed = await createTestbed();
    const [clock] = await bed.chain.getAccounts([SYSVAR_CLOCK_ADDRESS]);
    expect(clockUnixTimestamp(clock)).toBe(TESTBED_NOW);
    expect(() => clockUnixTimestamp(undefined)).toThrow("the Clock sysvar is unreadable");
    const [other] = await bed.chain.getAccounts([bed.keys.stranger.address]);
    expect(() => clockUnixTimestamp(other)).toThrow("the Clock sysvar is unreadable");
  });

  it("reports simulation failures in the RPC's JSON shape", async () => {
    const bed = await createTestbed();
    const { agent } = agentOf(bed);
    const instruction = await agent.buildPayInstruction({
      to: bed.keys.attacker.address,
      amount: 1n,
      purpose: "x",
      reference: new Uint8Array(32),
    });
    // Signed by the agent key alone, fee paid by the agent key.
    const error = await bed.send(bed.keys.agentKey, [instruction]).catch((e: unknown) => e);
    expect(error).toMatchObject({ context: { logs: expect.any(Array) } });
    expect((error as Error).cause).toMatchObject({ context: { code: 6003, index: 0 } });
  });
});

describe("toRpcTransactionError", () => {
  // LiteSVM's native error objects, as their shapes (the classes are not exported).
  const instructionError = (err: unknown) => ({ index: 1, err: () => err });

  it("translates every shape LiteSVM reports", () => {
    expect(toRpcTransactionError(2 as never)).toBe("AccountNotFound");
    expect(toRpcTransactionError(999 as never)).toBe("UnknownTransactionError");
    expect(toRpcTransactionError(instructionError(7) as never)).toEqual({
      InstructionError: [1, "MissingRequiredSignature"],
    });
    expect(toRpcTransactionError(instructionError(999) as never)).toEqual({
      InstructionError: [1, "GenericError"],
    });
    expect(toRpcTransactionError(instructionError({ code: 6003 }) as never)).toEqual({
      InstructionError: [1, { Custom: 6003 }],
    });
    expect(toRpcTransactionError(instructionError({ msg: "bad" }) as never)).toEqual({
      InstructionError: [1, { BorshIoError: "bad" }],
    });
    expect(toRpcTransactionError({ index: 3 } as never)).toEqual({ DuplicateInstruction: 3 });
    expect(
      toRpcTransactionError({
        accountIndex: 4,
        toString: () => "InsufficientFundsForRent { account_index: 4 }",
      } as never),
    ).toEqual({ InsufficientFundsForRent: { account_index: 4 } });
    expect(
      toRpcTransactionError({
        accountIndex: 5,
        toString: () => "ProgramExecutionTemporarilyRestricted { account_index: 5 }",
      } as never),
    ).toEqual({ ProgramExecutionTemporarilyRestricted: { account_index: 5 } });
  });
});
