import { DENIAL_REASONS, type LeashErrorName } from "@leash/contracts";
import { type FailedTransactionMessage, findLeashFailure, LeashNetworkError } from "@leash/sdk";
import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
} from "@solana/kit";

// What the owner reads when an action fails. Denials use the copy table of 02-contracts §4
// (`DENIAL_REASONS[].ownerCopy`); the program's other errors, the wallet and the network get the
// sentences below. Every message says whether anything changed.

export type OwnerActionErrorCode = "NOT_FOUND" | "NOT_ALLOWED" | "ALREADY" | "EXPIRED" | "INVALID";

/** A plan refused before anything was signed: the owner's message is the error's message. */
export class OwnerActionError extends Error {
  override readonly name = "OwnerActionError";
  constructor(
    readonly code: OwnerActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Copy for the Leash program's errors that are not denials (01 §10). */
export const PROGRAM_ERROR_COPY: Partial<Record<LeashErrorName, string>> = {
  Unauthorized:
    "The program refused your wallet: only the owner signs this (the guardian may only freeze and reject).",
  InvalidPolicy:
    "These rules don't fit together. The instant limit must be above zero, the approval limit above the instant limit, and every window longer than zero.",
  InvalidAmount: "An amount must be greater than zero.",
  InvalidAgentKey: "The agent key must not be your own wallet.",
  InvalidPayee: "A payee must not be the agent itself.",
  MintMismatch: "The token does not match this agent's token.",
  DelegationMismatch: "The allowance does not belong to this owner, agent and token.",
  UnsupportedDelegation: "The allowance account is not one Leash can use.",
  RequestExpired: "This request has expired. The agent has to ask again.",
  RequestNotPending: "This request was already handled.",
  RequestNotApproved: "This request is not approved.",
  ApprovalsDisabled: "Approvals are switched off for this agent.",
  AgentNotEmpty: "Remove the agent's payees and open requests first.",
};

const REJECTED = /reject|denied|declined|cancel/i;

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && current !== null && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

/** The wallet's "no": its own error, or the 4001 code of injected providers. */
export function isWalletRejection(error: unknown): boolean {
  return causes(error).some(
    (e) =>
      (typeof e === "object" && e !== null && "code" in e && e.code === 4001) ||
      (e instanceof Error && REJECTED.test(e.message) && !isSolanaError(e)),
  );
}

/** What `describeOwnerError` needs to know about a step that failed (see `StepFailedError`). */
export type FailedStep = {
  step: { instructions: FailedTransactionMessage["instructions"] };
  sent: boolean;
  confirmed: readonly string[];
  cause: unknown;
};

const isFailedStep = (error: unknown): error is FailedStep =>
  error instanceof Error && error.name === "StepFailedError";

/** The owner-facing sentence for a failed action, on `cluster` ("devnet", "localnet"). */
export function describeOwnerError(error: unknown, cluster: string): string {
  if (!isFailedStep(error)) return describeCause(error, { cluster, sent: false, instructions: [] });
  const sentence = describeCause(error.cause, {
    cluster,
    sent: error.sent,
    instructions: error.step.instructions,
  });
  const done = error.confirmed.length;
  return done === 0
    ? sentence
    : `${sentence} The first ${done === 1 ? "transaction" : `${done} transactions`} went through; starting again picks up where this stopped.`;
}

function describeCause(
  error: unknown,
  options: {
    cluster: string;
    sent: boolean;
    instructions: FailedTransactionMessage["instructions"];
  },
): string {
  if (error instanceof OwnerActionError) return error.message;
  if (isWalletRejection(error)) return "You declined in your wallet. Nothing was sent.";

  const failure = findLeashFailure(error, { instructions: options.instructions });
  if (failure) {
    if (failure.denial !== null) {
      const copy = DENIAL_REASONS.find((d) => d.name === failure.denial)?.ownerCopy;
      return `${copy ?? failure.name}. Nothing changed.`;
    }
    const copy =
      PROGRAM_ERROR_COPY[failure.name] ?? `The Leash program refused it (${failure.name}).`;
    return `${copy} Nothing changed.`;
  }

  for (const e of causes(error)) {
    // Anchor's own account checks (2000–4999): a missing account, or one that is not the
    // signer's. The UI's plans catch these first; this is the fallback when they are bypassed.
    if (
      isSolanaError(e, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
      e.context.code >= 2000 &&
      e.context.code < 5000
    ) {
      return `The program refused it: an account does not belong to this wallet or is missing (code ${e.context.code}). Nothing changed.`;
    }
    if (
      isSolanaError(e, SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE) ||
      isSolanaError(e, SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND)
    ) {
      return `Your wallet needs a little SOL on ${options.cluster} to pay the network fee. Nothing changed.`;
    }
    if (isSolanaError(e, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND)) {
      return "The transaction took too long to sign and expired. Nothing changed; try again.";
    }
  }
  if (error instanceof LeashNetworkError || isNetworkFailure(error)) {
    return options.sent
      ? `Lost contact with ${options.cluster} after sending. Check the activity feed before you try again.`
      : `Can't reach ${options.cluster} right now. Nothing was sent.`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Something went wrong: ${detail}`;
}

function isNetworkFailure(error: unknown): boolean {
  return causes(error).some((e) => e instanceof TypeError && /fetch|network/i.test(e.message));
}
