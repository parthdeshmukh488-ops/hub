import {
  appendTransactionMessageInstructions,
  type Blockhash,
  createTransactionMessage,
  type Instruction,
  isTransactionMessageWithinSizeLimit,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import type { BlockhashLifetime, LeashChain } from "./chain.ts";
import type { TransactionRecord } from "./events.ts";

// Composing, signing and sending transactions. Wallet apps build their own messages from the
// builders' instructions (`buildTransactionMessage`); scripts, services and tests use
// `sendInstructions` and `sendPlan` with key-pair signers.

/** One transaction of a multi-step flow, in order. `purpose` is for UIs and logs. */
export type PlannedTransaction = { purpose: string; instructions: readonly Instruction[] };

/** A v0 transaction message: `feePayer` pays, `instructions` run in order. */
export function buildTransactionMessage(args: {
  feePayer: TransactionSigner;
  instructions: readonly Instruction[];
  lifetime: BlockhashLifetime;
}) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(args.feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(args.lifetime, message),
    (message) => appendTransactionMessageInstructions(args.instructions, message),
  );
}

/** Signs `instructions` with the fee payer and every signer they name, sends, and waits. */
export async function sendInstructions(
  chain: LeashChain,
  args: { feePayer: TransactionSigner; instructions: readonly Instruction[] },
): Promise<TransactionRecord> {
  const message = buildTransactionMessage({ ...args, lifetime: await chain.getLatestBlockhash() });
  return chain.sendAndConfirm(await signTransactionMessageWithSigners(message));
}

/** Sends planned transactions one after the other; stops at the first failure. */
export async function sendPlan(
  chain: LeashChain,
  args: { feePayer: TransactionSigner; transactions: readonly PlannedTransaction[] },
): Promise<TransactionRecord[]> {
  const records: TransactionRecord[] = [];
  for (const { instructions } of args.transactions) {
    records.push(await sendInstructions(chain, { feePayer: args.feePayer, instructions }));
  }
  return records;
}

const SIZE_PROBE_LIFETIME: BlockhashLifetime = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 0n,
};

/**
 * Packs groups of instructions into as few transactions as fit the size limit, keeping order and
 * never splitting a group. Throws if a single group is too large for one transaction.
 */
export function packTransactions(
  feePayer: TransactionSigner,
  groups: readonly { purpose: string; instructions: readonly Instruction[] }[],
): PlannedTransaction[] {
  const fits = (instructions: readonly Instruction[]) =>
    isTransactionMessageWithinSizeLimit(
      buildTransactionMessage({ feePayer, instructions, lifetime: SIZE_PROBE_LIFETIME }),
    );
  const transactions: { purposes: string[]; instructions: Instruction[] }[] = [];
  for (const group of groups) {
    if (group.instructions.length === 0) continue;
    if (!fits(group.instructions)) throw new Error(`"${group.purpose}" does not fit a transaction`);
    const last = transactions.at(-1);
    if (last && fits([...last.instructions, ...group.instructions])) {
      last.purposes.push(group.purpose);
      last.instructions.push(...group.instructions);
    } else {
      transactions.push({ purposes: [group.purpose], instructions: [...group.instructions] });
    }
  }
  return transactions.map((t) => ({
    purpose: t.purposes.join(", "),
    instructions: t.instructions,
  }));
}
