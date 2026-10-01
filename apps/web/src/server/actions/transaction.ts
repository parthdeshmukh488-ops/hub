import { buildTransactionMessage, type LeashChain } from "@leash/sdk";
import {
  type Address,
  compileTransaction,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

/**
 * A stand-in signer for `account`: the SDK builders want a signer, but the server never holds a
 * key (I6). The wallet signs what we return.
 */
export function walletSigner(account: string): TransactionSigner {
  return createNoopSigner(account as Address);
}

/** An unsigned v0 transaction, fee payer `account`, as the base64 wire format Actions return. */
export async function unsignedTransaction(
  chain: LeashChain,
  account: string,
  instructions: readonly Instruction[],
): Promise<string> {
  const message = buildTransactionMessage({
    feePayer: walletSigner(account),
    instructions,
    lifetime: await chain.getLatestBlockhash(),
  });
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
