import {
  type Address,
  getAddressDecoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  type KeyPairSigner,
  partiallySignTransaction,
  type Transaction,
} from "@solana/kit";
import { getTokenDecoder } from "@solana-program/token";
import { FailedTransactionMetadata, type LiteSVM, type TransactionMetadata } from "litesvm";
import type { FacilitatorSvmSigner } from "../facilitator/index.ts";

// The official facilitator's signer interface over an in-process LiteSVM, so the unmodified
// `ExactSvmScheme` verifies and settles against the real leash.so and subscriptions.so without a
// network (WS3 brief). Simulations skip signature checks, as the RPC does with `sigVerify: false`:
// the fee payer has not signed yet when the facilitator verifies.

type InnerInstructions = NonNullable<
  NonNullable<
    Awaited<
      ReturnType<NonNullable<FacilitatorSvmSigner["simulateTransactionWithInnerInstructions"]>>
    >
  >["innerInstructions"]
>;

const base58 = getBase58Decoder();
const decodeTransaction = (base64: string): Transaction =>
  getTransactionDecoder().decode(getBase64Encoder().encode(base64));

const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
const TRANSFER_CHECKED = 12;

/**
 * Inner instructions as `getTransaction(..., { encoding: "jsonParsed" })` returns them, which
 * is how the official signer reads a confirmed transaction: token `TransferChecked`s come parsed
 * (the post-settlement check reads only those), everything else raw.
 */
function parsedInnerInstructionsOf(
  meta: TransactionMetadata,
  keys: readonly string[],
): InnerInstructions {
  return innerInstructionsOf(meta).map((group) => ({
    index: group.index,
    instructions: group.instructions.map((ix) => {
      const programId = keys[ix.programIdIndex] ?? "";
      const data = getBase58Encoder().encode(ix.data);
      if (!TOKEN_PROGRAMS.has(programId) || data[0] !== TRANSFER_CHECKED) return ix;
      const [source, mint, destination, authority] = ix.accounts.map((i) => keys[i]);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return {
        programId,
        parsed: {
          type: "transferChecked",
          info: {
            source,
            mint,
            destination,
            authority,
            tokenAmount: { amount: view.getBigUint64(1, true).toString(), decimals: data[9] },
          },
        },
      } as unknown as (typeof group.instructions)[number];
    }),
  }));
}

function innerInstructionsOf(meta: TransactionMetadata): InnerInstructions {
  return meta
    .innerInstructions()
    .map((group, index) => ({
      index,
      instructions: group.map((inner) => {
        const instruction = inner.instruction();
        return {
          programIdIndex: instruction.programIdIndex(),
          accounts: [...instruction.accounts()],
          data: base58.decode(instruction.data()),
        };
      }),
    }))
    .filter((group) => group.instructions.length > 0);
}

/** A facilitator signer for `feePayers` on `svm`. Sent transactions stay queryable by signature. */
export function litesvmFacilitatorSigner(
  svm: LiteSVM,
  feePayers: readonly KeyPairSigner[],
): FacilitatorSvmSigner & { readonly sent: ReadonlyMap<string, InnerInstructions> } {
  const sent = new Map<string, InnerInstructions>();
  const signerFor = (address: string) => {
    const signer = feePayers.find((s) => s.address === address);
    if (!signer) throw new Error(`no signer for fee payer ${address}`);
    return signer;
  };
  const simulate = (base64: string) => {
    svm.withSigverify(false);
    try {
      const result = svm.simulateTransaction(decodeTransaction(base64));
      if (result instanceof FailedTransactionMetadata) {
        throw new Error(`simulation failed: ${result.err().toString()}`);
      }
      return result.meta();
    } finally {
      svm.withSigverify(true);
    }
  };

  return {
    sent,
    getAddresses: () => feePayers.map((s) => s.address as Address),

    async signTransaction(transaction, feePayer) {
      const signed = await partiallySignTransaction(
        [signerFor(feePayer).keyPair],
        decodeTransaction(transaction),
      );
      return getBase64EncodedWireTransaction(signed);
    },

    async simulateTransaction(transaction) {
      simulate(transaction);
    },

    async simulateTransactionWithInnerInstructions(transaction) {
      return { innerInstructions: innerInstructionsOf(simulate(transaction)) };
    },

    async sendTransaction(transaction) {
      const decoded = decodeTransaction(transaction);
      const result = svm.sendTransaction(decoded);
      if (result instanceof FailedTransactionMetadata) {
        throw new Error(`transaction failed: ${result.err().toString()}`);
      }
      const signature = getSignatureFromTransaction(decoded);
      const keys = getCompiledTransactionMessageDecoder().decode(
        decoded.messageBytes,
      ).staticAccounts;
      sent.set(signature, parsedInnerInstructionsOf(result, keys));
      return signature;
    },

    async confirmTransaction(signature) {
      if (!sent.has(signature)) throw new Error(`unknown transaction ${signature}`);
    },

    async getConfirmedTransactionInnerInstructions(signature) {
      const inner = sent.get(signature);
      return inner === undefined ? null : { innerInstructions: inner };
    },

    async fetchAddressLookupTables(tables) {
      // An address lookup table is a 56-byte header followed by 32-byte addresses.
      const decoder = getAddressDecoder();
      return Object.fromEntries(
        tables.map((table) => {
          const account = svm.getAccount(table as Address);
          if (!account.exists) throw new Error(`lookup table ${table} not found`);
          const addresses: string[] = [];
          for (let offset = 56; offset + 32 <= account.data.length; offset += 32) {
            addresses.push(decoder.decode(account.data.subarray(offset, offset + 32)));
          }
          return [table, addresses];
        }),
      );
    },

    async getTokenAccountBalance(tokenAccount) {
      const account = svm.getAccount(tokenAccount as Address);
      return account.exists ? getTokenDecoder().decode(account.data).amount : null;
    },
  };
}
