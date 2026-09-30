import { createHash } from "node:crypto";
import { LEASH_PROGRAM_ID, referenceToHex } from "@leash/contracts";
import {
  buildApproveRequest,
  LeashAgent,
  PaymentDeniedError,
  UnsupportedPaymentError,
} from "@leash/sdk";
import { USDC } from "@leash/sdk/testing";
import {
  AccountRole,
  type Address,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import type { PaymentRequirements } from "@x402/core/types";
import { MEMO_PROGRAM_ADDRESS } from "@x402/svm";
import { describe, expect, it } from "vitest";
import { LeashExactSvmScheme } from "../src/index.ts";
import {
  createX402Bed,
  facilitatorOf,
  memo,
  NETWORK,
  partiallySigned,
  payloadOf,
  type X402Bed,
} from "./helpers.ts";

// The Leash client scheme and Path 2 of the official facilitator (WS3 test table, rows 2–6).

function schemeOf(bed: X402Bed, purpose = "Research API: one report") {
  const agent = new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: () => {} },
  });
  return {
    agent,
    scheme: new LeashExactSvmScheme({ agent, chain: bed.chain, network: NETWORK, purpose }),
  };
}

async function leashPayload(bed: X402Bed, requirements: PaymentRequirements) {
  const { scheme } = schemeOf(bed);
  const result = await scheme.createPaymentPayload(2, requirements);
  return { scheme, transaction: result.payload.transaction as string };
}

function decode(transaction: string) {
  const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(transaction));
  const message = decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(decoded.messageBytes),
  );
  return { decoded, message };
}

describe("LeashExactSvmScheme", () => {
  it("builds [limit, price, leash::pay, Memo], fee payer = extra.feePayer, signed by the agent only", async () => {
    const bed = await createX402Bed();
    const requirements = bed.requirements(USDC / 10n);
    requirements.extra.memo = "order-42";
    const { scheme, transaction } = await leashPayload(bed, requirements);
    const { decoded, message } = decode(transaction);

    expect(message.feePayer.address).toBe(bed.facilitatorKey.address);
    const instructions = [...message.instructions] as { programAddress: string }[];
    expect(instructions.map((ix) => ix.programAddress)).toEqual([
      "ComputeBudget111111111111111111111111111111",
      "ComputeBudget111111111111111111111111111111",
      LEASH_PROGRAM_ID,
      MEMO_PROGRAM_ADDRESS,
    ]);
    const [, , pay, memoIx] = message.instructions;
    expect(memoIx?.accounts ?? []).toEqual([]);
    expect(new TextDecoder().decode(new Uint8Array(memoIx?.data ?? []))).toBe("order-42");
    // Reference = sha256(memo) (02 §3), memo arg = the purpose.
    // pay data: 8-byte discriminator, amount u64, reference [32], memo [64].
    const data = new Uint8Array(pay?.data ?? []);
    const expected = new Uint8Array(createHash("sha256").update("order-42").digest());
    expect(referenceToHex(data.subarray(16, 48))).toBe(referenceToHex(expected));
    expect(new DataView(data.buffer).getBigUint64(8, true)).toBe(USDC / 10n);
    expect(new TextDecoder().decode(data.subarray(48)).replace(/\0+$/, "")).toBe(
      "Research API: one report",
    );
    // Only the agent key signed; the fee payer's slot is empty.
    const signed = Object.entries(decoded.signatures)
      .filter(([, s]) => s !== null)
      .map(([a]) => a);
    expect(signed).toEqual([bed.keys.agentKey.address]);
    // The fee payer appears in no instruction.
    for (const ix of message.instructions) {
      expect((ix.accounts ?? []).map((a) => a.address)).not.toContain(bed.facilitatorKey.address);
    }
    expect(scheme.lastPayment).toMatchObject({
      payTo: bed.keys.merchant.address,
      amount: USDC / 10n,
      payeeLabel: "Research API",
      memo: "order-42",
      requestNonce: null,
    });
  });

  it("uses a random memo nonce when the merchant sends none", async () => {
    const bed = await createX402Bed();
    const { scheme } = await leashPayload(bed, bed.requirements(1_000n));
    expect(scheme.lastPayment?.memo).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses requirements it cannot pay", async () => {
    const bed = await createX402Bed();
    const { scheme } = schemeOf(bed);
    const base = bed.requirements(1_000n);
    const cases: PaymentRequirements[] = [
      { ...base, scheme: "upto" },
      { ...base, network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" },
      { ...base, asset: bed.keys.stranger.address },
      { ...base, payTo: "not-an-address" },
      { ...base, amount: "0" },
      { ...base, amount: "1.5" },
      { ...base, amount: (2n ** 64n).toString() },
      { ...base, extra: {} },
      { ...base, extra: { feePayer: bed.facilitatorKey.address, memo: "x".repeat(257) } },
    ];
    for (const requirements of cases) {
      await expect(scheme.createPaymentPayload(2, requirements)).rejects.toBeInstanceOf(
        UnsupportedPaymentError,
      );
    }
    expect(scheme.lastError).toBeInstanceOf(UnsupportedPaymentError);
    expect(
      () => new LeashExactSvmScheme({ ...schemeOptions(bed), priorityFeeMicroLamports: 50_001n }),
    ).toThrow(RangeError);
  });

  it("reports a denied payment and throws before building anything", async () => {
    const bed = await createX402Bed();
    const { scheme } = schemeOf(bed);
    const error = await scheme
      .createPaymentPayload(2, bed.requirements(1_000n, bed.keys.attacker.address))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentDeniedError);
    expect(error).toMatchObject({ reason: "payeeNotAllowed", recorded: true, strikes: 1 });
    expect(scheme.lastPayment).toBeNull();
  });

  it("refuses a payee without a token account (x402 cannot create it)", async () => {
    const bed = await createX402Bed();
    const { scheme } = schemeOf(bed);
    await expect(
      scheme.createPaymentPayload(2, bed.requirements(1_000n, bed.keys.guardian.address)),
    ).rejects.toBeInstanceOf(UnsupportedPaymentError);
  });
});

function schemeOptions(bed: X402Bed) {
  const { agent } = schemeOf(bed);
  return { agent, chain: bed.chain, network: NETWORK, purpose: "x" };
}

describe("Path 2: a Leash payment through the official facilitator", () => {
  it("verifies on the smart-wallet path and settles through the program", async () => {
    const bed = await createX402Bed();
    const facilitator = facilitatorOf(bed);
    const requirements = bed.requirements(USDC / 10n);
    const { transaction } = await leashPayload(bed, requirements);
    const payload = payloadOf(transaction, requirements);

    const verified = await facilitator.verify(payload, requirements);
    // The payer is the transfer's authority: the owner's Subscription Authority (the delegate).
    expect(verified).toMatchObject({ isValid: true, payer: bed.accounts.subscriptionAuthority });

    const feePayerBefore = bed.svm.getBalance(bed.facilitatorKey.address) ?? 0n;
    const settled = await facilitator.settle(payload, requirements);
    expect(settled).toMatchObject({ success: true, network: NETWORK });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(USDC / 10n);
    // The facilitator paid the fee; the agent key paid nothing.
    expect(bed.svm.getBalance(bed.facilitatorKey.address) ?? 0n).toBeLessThan(feePayerBefore);
    const status = await schemeOf(bed).agent.status();
    expect(status.agent.stats).toMatchObject({ paymentsCount: 1, totalPaid: "100000" });
  });

  it("is rejected by a facilitator without Leash on its allowlist", async () => {
    const bed = await createX402Bed();
    const requirements = bed.requirements(USDC / 10n);
    const { transaction } = await leashPayload(bed, requirements);
    const verified = await facilitatorOf(bed, { allowLeash: false }).verify(
      payloadOf(transaction, requirements),
      requirements,
    );
    expect(verified).toMatchObject({
      isValid: false,
      invalidReason: `invalid_exact_svm_smart_wallet_program_not_allowed: ${LEASH_PROGRAM_ID}`,
    });
  });

  it("fails verification when the program would deny the payment (fail closed)", async () => {
    const bed = await createX402Bed();
    const { agent } = schemeOf(bed);
    // Bypass the client's checks: a pay instruction to the attacker, built directly.
    const pay = await agent.buildPayInstruction({
      to: bed.keys.attacker.address,
      amount: 1_000n,
      purpose: "x",
      reference: new Uint8Array(32),
    });
    const requirements = bed.requirements(1_000n, bed.keys.attacker.address);
    const transaction = await partiallySigned(bed, [pay, memo("nonce")]);
    const verified = await facilitatorOf(bed).verify(
      payloadOf(transaction, requirements),
      requirements,
    );
    expect(verified.isValid).toBe(false);
    expect(verified.invalidReason).toMatch(/^invalid_exact_svm_smart_wallet_simulation_failed/);
  });

  it("rejects a transaction that puts the fee payer in an instruction", async () => {
    const bed = await createX402Bed();
    const { agent } = schemeOf(bed);
    const pay = await agent.buildPayInstruction({
      to: bed.keys.merchant.address,
      amount: 1_000n,
      purpose: "x",
      reference: new Uint8Array(32),
    });
    const sneaky = {
      ...memo("nonce"),
      accounts: [{ address: bed.facilitatorKey.address as Address, role: AccountRole.READONLY }],
    };
    const requirements = bed.requirements(1_000n);
    const transaction = await partiallySigned(bed, [pay, sneaky]);
    const verified = await facilitatorOf(bed).verify(
      payloadOf(transaction, requirements),
      requirements,
    );
    expect(verified.isValid).toBe(false);
    expect(verified.invalidReason).toMatch(/fee_payer_not_isolated/);
  });

  it("settles the same payload once", async () => {
    const bed = await createX402Bed();
    const facilitator = facilitatorOf(bed);
    const requirements = bed.requirements(USDC / 10n);
    const { transaction } = await leashPayload(bed, requirements);
    const payload = payloadOf(transaction, requirements);
    expect((await facilitator.settle(payload, requirements)).success).toBe(true);
    const again = await facilitator.settle(payload, requirements);
    expect(again).toMatchObject({ success: false, errorReason: "duplicate_settlement" });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(USDC / 10n);
  });

  it("pays with an approved request, using its reference", async () => {
    const bed = await createX402Bed();
    const { agent, scheme } = schemeOf(bed);
    const request = await agent.requestApproval({
      to: bed.keys.merchant.address,
      amount: 2n * USDC,
      purpose: "Deep report",
    });
    await bed.send(bed.keys.owner, [
      await buildApproveRequest({
        owner: bed.keys.owner,
        agent: bed.accounts.agent,
        request: request.address as Address,
      }),
    ]);
    const requirements = bed.requirements(2n * USDC);
    const result = await scheme.createPaymentPayload(2, requirements);
    expect(scheme.lastPayment?.requestNonce).toBe(0n);
    const settled = await facilitatorOf(bed).settle(
      payloadOf(result.payload.transaction as string, requirements),
      requirements,
    );
    expect(settled.success).toBe(true);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(2n * USDC);
  });
});
