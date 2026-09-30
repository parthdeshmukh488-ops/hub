import {
  type DenialReason,
  denialFromAnchorErrorCode,
  type LeashErrorName,
  leashErrorName,
} from "@leash/contracts";
import {
  type Address,
  getSolanaErrorFromTransactionError,
  isProgramError,
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";
import {
  ApprovalNotPossibleError,
  type AttemptedPayment,
  LeashSdkError,
  PaymentDeniedError,
} from "./errors.ts";
import { LEASH_PROGRAM_ADDRESS } from "./pda.ts";

// Finding the Leash program's error in a failed transaction or simulation, and turning it into the
// SDK's typed errors. Codes follow `LEASH_ERRORS` (01-onchain-program §10): 6000–6011 are the
// denials, in `DenialReason` order.

/** A Leash program error, with the name and denial reason the contracts give its code. */
export type LeashFailure = {
  /** Anchor error code, 6000 and up. */
  code: number;
  name: LeashErrorName;
  /** Set for the twelve denials (6000–6011). */
  denial: DenialReason | null;
  /** Index of the failing instruction in the transaction. */
  instructionIndex: number;
};

/** The instructions of the transaction that failed, as kit messages carry them. */
export type FailedTransactionMessage = {
  instructions: Readonly<Record<number, { programAddress: Address }>>;
};

/** The failure for an Anchor error `code` raised by the Leash program, or null if unknown. */
export function leashFailureFromCode(code: number, instructionIndex = 0): LeashFailure | null {
  const name = leashErrorName(code);
  if (name === null) return null;
  return { code, name, denial: denialFromAnchorErrorCode(code), instructionIndex };
}

/**
 * Finds the Leash program error in `error`: a kit `SolanaError` (followed through its `cause`
 * chain, e.g. a preflight failure), or the raw `err` of a simulation or confirmed transaction.
 * Returns null when the transaction failed for another reason, including a custom error of
 * another program in the same transaction.
 */
export function findLeashFailure(
  error: unknown,
  transactionMessage: FailedTransactionMessage,
): LeashFailure | null {
  const seen = new Set<unknown>();
  let current: unknown = isRawTransactionError(error)
    ? getSolanaErrorFromTransactionError(error)
    : error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (
      isSolanaError(current, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
      isProgramError(current, transactionMessage, LEASH_PROGRAM_ADDRESS)
    ) {
      return leashFailureFromCode(current.context.code, current.context.index);
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

/** The raw JSON error of `simulateTransaction` or `getTransaction`, e.g. `{ InstructionError: [1, { Custom: 6003 }] }`. */
function isRawTransactionError(
  error: unknown,
): error is Parameters<typeof getSolanaErrorFromTransactionError>[0] {
  return (
    (typeof error === "object" && error !== null && !(error instanceof Error)) ||
    typeof error === "string"
  );
}

/** A Leash program error that is neither a denial nor a refused approval request. */
export class LeashProgramError extends LeashSdkError {
  readonly programError: LeashErrorName;
  readonly errorCode: number;

  constructor(failure: LeashFailure) {
    super("PROGRAM_ERROR", `The Leash program rejected the transaction: ${failure.name}`);
    this.name = "LeashProgramError";
    this.programError = failure.name;
    this.errorCode = failure.code;
  }
}

/**
 * The SDK error for a Leash failure: `PaymentDeniedError` for a denial (not recorded: only the pay
 * flow reports attempts), `ApprovalNotPossibleError` for `ApprovalNotNeeded` and
 * `TooManyOpenRequests`, and `LeashProgramError` for everything else.
 */
export function toSdkError(failure: LeashFailure, attempted: AttemptedPayment): LeashSdkError {
  if (failure.denial !== null) {
    return new PaymentDeniedError({ reason: failure.denial, recorded: false, attempted });
  }
  if (failure.name === "ApprovalNotNeeded") return new ApprovalNotPossibleError("notNeeded");
  if (failure.name === "TooManyOpenRequests") return new ApprovalNotPossibleError("tooManyOpen");
  return new LeashProgramError(failure);
}
