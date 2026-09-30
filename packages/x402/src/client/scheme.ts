import {
  type LeashAgent,
  type LeashChain,
  MAX_COMPUTE_UNITS,
  type PreparedPaymentResult,
  UnsupportedPaymentError,
} from "@leash/sdk";
import {
  type Address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Instruction,
  isAddress,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import type {
  Network,
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { MAX_MEMO_BYTES, MEMO_PROGRAM_ADDRESS } from "@x402/svm";

// The client half of 02-contracts §9: an x402 v2 `exact` scheme for `solana:*` that pays through
// Leash. The official fetch wrapper and x402Client do everything else (ADR-0003).

/** Priority fee in micro-lamports per compute unit: default 1, at most the facilitator's cap. */
export const DEFAULT_PRIORITY_FEE_MICROLAMPORTS = 1n;
export const MAX_PRIORITY_FEE_MICROLAMPORTS = 50_000n;

/** The payment this scheme prepared, for the receipt once the merchant has settled it. */
export type X402Payment = PreparedPaymentResult & {
  payTo: string;
  amount: bigint;
  /** The Memo instruction's text: `extra.memo` or a random nonce. */
  memo: string;
};

export type LeashSchemeOptions = {
  agent: LeashAgent;
  chain: LeashChain;
  /** The CAIP-2 network this agent pays on. */
  network: Network;
  /** Stored on-chain as the payment's memo (at most 64 bytes of UTF-8). */
  purpose: string;
  priorityFeeMicroLamports?: bigint;
};

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** The requirement fields we pay, checked (02 §9 "Accepted requirements"). */
function validate(
  requirements: PaymentRequirements,
  expected: { network: Network; mint: Address },
): { payTo: Address; amount: bigint; feePayer: Address; memo: string | null } {
  const unsupported = (detail: string): never => {
    throw new UnsupportedPaymentError(detail);
  };
  if (requirements.scheme !== "exact") unsupported(`scheme ${requirements.scheme}`);
  if (requirements.network !== expected.network) unsupported(`network ${requirements.network}`);
  if (requirements.asset !== expected.mint) unsupported(`asset ${requirements.asset}`);
  if (!isAddress(requirements.payTo)) unsupported("payTo is not an address");
  if (!/^[1-9][0-9]*$/.test(requirements.amount) || BigInt(requirements.amount) >= 2n ** 64n) {
    unsupported(`amount ${requirements.amount}`);
  }
  const feePayer = requirements.extra?.feePayer;
  if (typeof feePayer !== "string" || !isAddress(feePayer)) unsupported("no extra.feePayer");
  const memo = requirements.extra?.memo;
  if (
    memo !== undefined &&
    (typeof memo !== "string" || encoder.encode(memo).length > MAX_MEMO_BYTES)
  ) {
    unsupported("extra.memo");
  }
  return {
    payTo: requirements.payTo as Address,
    amount: BigInt(requirements.amount),
    feePayer: feePayer as Address,
    memo: (memo as string | undefined) ?? null,
  };
}

/**
 * x402 `exact` on Solana, paid through Leash. `createPaymentPayload` checks the requirements
 * (else `UnsupportedPaymentError`), derives the memo and reference (02 §3), lets the SDK evaluate,
 * simulate and report a denial (`PaymentDeniedError`), then returns the transaction
 * `[SetComputeUnitLimit, SetComputeUnitPrice, leash::pay, Memo]`, fee payer `extra.feePayer`,
 * signed by the agent key only.
 */
export class LeashExactSvmScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  readonly #options: LeashSchemeOptions;
  readonly #priorityFee: bigint;
  /** The last payment this scheme prepared. */
  lastPayment: X402Payment | null = null;
  /**
   * The last error `createPaymentPayload` threw. The official fetch wrapper rethrows it as a
   * plain `Error`; `leashFetch` rethrows this one instead, so callers see the SDK's typed errors.
   */
  lastError: unknown = null;

  constructor(options: LeashSchemeOptions) {
    const fee = options.priorityFeeMicroLamports ?? DEFAULT_PRIORITY_FEE_MICROLAMPORTS;
    if (fee < 0n || fee > MAX_PRIORITY_FEE_MICROLAMPORTS) {
      throw new RangeError(`priority fee must be in 0..=${MAX_PRIORITY_FEE_MICROLAMPORTS}`);
    }
    this.#options = options;
    this.#priorityFee = fee;
  }

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    try {
      return await this.#create(x402Version, requirements);
    } catch (error) {
      this.lastError = error;
      throw error;
    }
  }

  async #create(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    const { agent, chain, network, purpose } = this.#options;
    const { payTo, amount, feePayer, memo } = validate(requirements, {
      network,
      mint: await agent.mint(),
    });
    const memoText = memo ?? hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    // No signer accounts on the Memo (02 §9 pitfall): the fee payer must appear in nothing.
    const memoInstruction: Instruction = {
      programAddress: MEMO_PROGRAM_ADDRESS as Address,
      accounts: [],
      data: encoder.encode(memoText),
    };
    const prepared = await agent.preparePayment(
      { to: payTo, amount, purpose, reference: await sha256(memoText) },
      { append: [memoInstruction] },
    );
    const units = Math.min(MAX_COMPUTE_UNITS, Math.ceil(Number(prepared.unitsConsumed) * 1.15));
    const lifetime = await chain.getLatestBlockhash();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
      (m) =>
        appendTransactionMessageInstructions(
          [
            getSetComputeUnitLimitInstruction({ units }),
            getSetComputeUnitPriceInstruction({ microLamports: this.#priorityFee }),
            prepared.instruction,
            memoInstruction,
          ],
          m,
        ),
    );
    const signed = await partiallySignTransactionMessageWithSigners(message);
    this.lastPayment = { ...prepared, payTo, amount, memo: memoText };
    return { x402Version, payload: { transaction: getBase64EncodedWireTransaction(signed) } };
  }
}
