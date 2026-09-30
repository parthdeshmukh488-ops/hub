import { LEASH_PROGRAM_ID } from "@leash/contracts";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { LIGHTHOUSE_PROGRAM_ADDRESS } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";

// The facilitator side of 02-contracts §9: the official `ExactSvmScheme`, configured, never
// extended (ADR-0003). A Leash payment fails the static path (its transfer is a CPI) and passes
// the smart-wallet path because Leash is on the allowlist and the simulation shows exactly one
// matching `TransferChecked`.

/**
 * The default smart-wallet allowlist of `@x402/svm` 2.27.0, which the package does not export.
 * Keep it identical to the package's own list: `test/facilitator.test.ts` checks it against the
 * installed version, so an upgrade that changes it fails loudly.
 */
export const X402_DEFAULT_SMART_WALLET_PROGRAMS: readonly string[] = [
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf", // Squads Multisig v4
  "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG", // Squads Smart Account
  "SWiGmQedKzMz1tiTqoJCWeGDnGXfNBp2PkXLkpCAtQo", // Swig (legacy)
  "swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB", // Swig v2
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw", // SPL Governance
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", // Metaplex Core
  LIGHTHOUSE_PROGRAM_ADDRESS, // Phantom's wallet-protection assertions
];

/** Compute and priority-fee caps for smart-wallet payments (02 §9). */
export const SMART_WALLET_MAX_COMPUTE_UNITS = 400_000;
export const SMART_WALLET_MAX_PRIORITY_FEE_MICROLAMPORTS = 50_000;

/** The signer interface the official scheme needs (base64 transactions in and out). */
export type FacilitatorSvmSigner = ConstructorParameters<typeof ExactSvmScheme>[0];

export type LeashFacilitatorOptions = {
  signer: FacilitatorSvmSigner;
  networks: Network | Network[];
  /** Put Leash on the smart-wallet allowlist. Default true; false is a stock facilitator. */
  allowLeash?: boolean;
  /** Default: the Leash program ID of @leash/contracts. */
  leashProgramId?: string;
};

/** The smart-wallet allowlist: the package defaults, plus Leash unless `allowLeash` is false. */
export function smartWalletAllowlist(options: {
  allowLeash?: boolean;
  leashProgramId?: string;
}): string[] {
  return options.allowLeash === false
    ? [...X402_DEFAULT_SMART_WALLET_PROGRAMS]
    : [...X402_DEFAULT_SMART_WALLET_PROGRAMS, options.leashProgramId ?? LEASH_PROGRAM_ID];
}

/** An x402 v2 facilitator that accepts standard SVM payments and Leash payments. */
export function createLeashFacilitator(options: LeashFacilitatorOptions): x402Facilitator {
  const scheme = new ExactSvmScheme(options.signer, undefined, {
    enableSmartWalletVerification: true,
    smartWalletAllowedPrograms: smartWalletAllowlist(options),
    smartWalletMaxComputeUnits: SMART_WALLET_MAX_COMPUTE_UNITS,
    smartWalletMaxPriorityFeeMicroLamports: SMART_WALLET_MAX_PRIORITY_FEE_MICROLAMPORTS,
  });
  return new x402Facilitator().register(options.networks, scheme);
}
