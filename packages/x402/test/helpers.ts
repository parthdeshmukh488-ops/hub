import { CAIP2 } from "@leash/contracts";
import { createTestbed, type Testbed } from "@leash/sdk/testing";
import {
  type Address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Instruction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { findAssociatedTokenPda, getTransferCheckedInstruction } from "@solana-program/token";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { MEMO_PROGRAM_ADDRESS } from "@x402/svm";
import { createLeashFacilitator } from "../src/facilitator/index.ts";
import { litesvmFacilitatorSigner } from "../src/testing/index.ts";

// A testbed (real leash.so + subscriptions.so in LiteSVM) with a facilitator on it.

export const NETWORK = CAIP2.localnet;

export type X402Bed = Testbed & {
  facilitatorKey: TransactionSigner;
  signer: ReturnType<typeof litesvmFacilitatorSigner>;
  requirements: (amount: bigint, payTo?: Address) => PaymentRequirements;
};

export async function createX402Bed(): Promise<X402Bed> {
  const bed = await createTestbed();
  // The stranger key is funded with SOL and appears in nothing else: the facilitator's fee payer.
  const facilitatorKey = bed.keys.stranger;
  const signer = litesvmFacilitatorSigner(bed.svm, [facilitatorKey]);
  return {
    ...bed,
    facilitatorKey,
    signer,
    requirements: (amount, payTo = bed.keys.merchant.address) => ({
      scheme: "exact",
      network: NETWORK,
      asset: bed.mint,
      amount: amount.toString(),
      payTo,
      maxTimeoutSeconds: 60,
      extra: { feePayer: facilitatorKey.address },
    }),
  };
}

export function facilitatorOf(bed: X402Bed, options: { allowLeash?: boolean } = {}) {
  return createLeashFacilitator({ signer: bed.signer, networks: NETWORK, ...options });
}

export const payloadOf = (
  transaction: string,
  requirements: PaymentRequirements,
): PaymentPayload => ({ x402Version: 2, accepted: requirements, payload: { transaction } });

/** A v0 transaction with the facilitator as fee payer, signed by everyone but the fee payer. */
export async function partiallySigned(
  bed: X402Bed,
  instructions: readonly Instruction[],
): Promise<string> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(bed.facilitatorKey.address, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: bed.svm.latestBlockhash(), lastValidBlockHeight: 1_000n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message));
}

export const memo = (text: string): Instruction => ({
  programAddress: MEMO_PROGRAM_ADDRESS as Address,
  accounts: [],
  data: new TextEncoder().encode(text),
});

/** A standard x402 payment from a normal wallet, shaped like the official client builds it. */
export async function standardPayment(
  bed: X402Bed,
  payer: TransactionSigner,
  amount: bigint,
): Promise<string> {
  const [source] = await findAssociatedTokenPda({
    owner: payer.address,
    mint: bed.mint,
    tokenProgram: bed.tokenProgram,
  });
  return partiallySigned(bed, [
    getSetComputeUnitLimitInstruction({ units: 20_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
    getTransferCheckedInstruction({
      source,
      mint: bed.mint,
      destination: bed.accounts.merchantTokenAccount,
      authority: payer,
      amount,
      decimals: 6,
    }),
    memo("0123456789abcdef0123456789abcdef"),
  ]);
}
