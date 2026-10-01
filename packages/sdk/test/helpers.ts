import type { DenialReason } from "@leash/contracts";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { expect } from "vitest";
import {
  buildFreezePrincipal,
  LeashAgent,
  type LeashAgentOptions,
  type LeashChain,
  PaymentDeniedError,
} from "../src/index.ts";
import type { Testbed } from "../src/testing/index.ts";

// Shared helpers for the LiteSVM suites.

/** A `LeashAgent` for the testbed's agent key, with its warnings captured. */
export function agentOf(
  bed: Testbed,
  options: Partial<LeashAgentOptions> = {},
): { agent: LeashAgent; warnings: string[] } {
  const warnings: string[] = [];
  const agent = new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: (message) => warnings.push(message) },
    ...options,
  });
  return { agent, warnings };
}

/** Expects `promise` to reject with a `PaymentDeniedError` matching `expected`. */
export async function expectDenied(
  promise: Promise<unknown>,
  expected: { reason: DenialReason; recorded: boolean; strikes?: number; frozen?: boolean },
): Promise<PaymentDeniedError> {
  const error = await promise.then(
    () => {
      throw new Error("expected a denial, but the call succeeded");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentDeniedError);
  expect(error).toMatchObject(expected);
  return error as PaymentDeniedError;
}

/** The testbed's chain with some operations replaced (fault injection). */
export function wrapChain(chain: LeashChain, overrides: Partial<LeashChain>): LeashChain {
  return {
    getAccounts: (addresses) => chain.getAccounts(addresses),
    getProgramAccounts: (program, filters) => chain.getProgramAccounts(program, filters),
    getLatestBlockhash: () => chain.getLatestBlockhash(),
    simulate: (transaction) => chain.simulate(transaction),
    sendAndConfirm: (transaction) => chain.sendAndConfirm(transaction),
    getRecentTransactions: (address, limit) => chain.getRecentTransactions(address, limit),
    getSignatures: (address, page) => chain.getSignatures(address, page),
    getTransactionRecord: (signature) => chain.getTransactionRecord(signature),
    ...overrides,
  };
}

export async function send(
  bed: Testbed,
  signer: TransactionSigner,
  instruction: Instruction | Promise<Instruction>,
) {
  return bed.send(signer, [await instruction]);
}

/** The guardian freezes every agent of the owner. */
export async function freezePrincipal(bed: Testbed) {
  return send(
    bed,
    bed.keys.guardian,
    buildFreezePrincipal({ authority: bed.keys.guardian, owner: bed.keys.owner.address }),
  );
}

export const addressOf = (value: string) => value as Address;
