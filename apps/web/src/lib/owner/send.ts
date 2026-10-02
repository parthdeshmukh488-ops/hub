import { buildTransactionMessage, type LeashChain } from "@leash/sdk";
import {
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import type { OwnerPlan, PlannedStep } from "./plans.ts";

// Running a plan: for each step, a fresh blockhash, the wallet's signature, then the app sends
// through its own RPC and waits for confirmation. The wallet only signs, so localnet works with
// any wallet, and a failure comes back as the program's error (`describeOwnerError`).

export type SendProgress =
  | { phase: "signing"; step: number; purpose: string }
  | { phase: "pending"; step: number; purpose: string; signature: string }
  | { phase: "confirmed"; step: number; purpose: string; signature: string };

/** Thrown when a step fails; carries what `describeOwnerError` needs. */
export class StepFailedError extends Error {
  override readonly name = "StepFailedError";
  constructor(
    readonly step: PlannedStep,
    readonly stepIndex: number,
    /** Whether the wallet signed and the transaction went out. */
    readonly sent: boolean,
    /** Signatures of the steps that already confirmed. */
    readonly confirmed: readonly string[],
    cause: unknown,
  ) {
    super(`step ${stepIndex + 1} (${step.purpose}) failed`, { cause });
  }
}

/** Signs and sends every step of `plan` in order; returns the confirmed signatures. */
export async function sendOwnerPlan(
  chain: LeashChain,
  signer: TransactionSigner,
  plan: Pick<OwnerPlan, "steps">,
  onProgress: (progress: SendProgress) => void = () => {},
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const base = { step: index, purpose: step.purpose };
    let sent = false;
    try {
      const message = buildTransactionMessage({
        feePayer: signer,
        instructions: step.instructions,
        lifetime: await chain.getLatestBlockhash(),
      });
      onProgress({ phase: "signing", ...base });
      const signed = await signTransactionMessageWithSigners(message);
      const signature = getSignatureFromTransaction(signed);
      onProgress({ phase: "pending", ...base, signature });
      sent = true;
      await chain.sendAndConfirm(signed);
      confirmed.push(signature);
      onProgress({ phase: "confirmed", ...base, signature });
    } catch (error) {
      throw new StepFailedError(step, index, sent, [...confirmed], error);
    }
  }
  return confirmed;
}
