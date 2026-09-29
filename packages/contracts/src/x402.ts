import { CAIP2 } from "./config.ts";

// The Leash x402 profile (02-contracts §9, ADR-0003). Encodings and verification come
// from the official @x402/* packages; this file only pins the values Leash relies on.

export const X402_VERSION = 2;
export const X402_SCHEME = "exact";

/** x402 v2 HTTP headers. */
export const X402_HEADERS = {
  /** Server → client: the 402 challenge. */
  paymentRequired: "PAYMENT-REQUIRED",
  /** Client → server: the signed payment payload. */
  paymentSignature: "PAYMENT-SIGNATURE",
  /** Server → client: the settlement result. */
  paymentResponse: "PAYMENT-RESPONSE",
} as const;

/** CAIP-2 network per cluster; localnet is never used with x402 facilitators. */
export const X402_NETWORKS = {
  devnet: CAIP2.devnet,
} as const;

/** Lighthouse (Phantom's wallet-protection assertions), exempted by the official facilitator. */
export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** Default smart-wallet allowlist of `@x402/svm` 2.27 `ExactSvmScheme` (copied, not imported). */
export const X402_DEFAULT_SMART_WALLET_PROGRAMS = [
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf", // Squads Multisig v4
  "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG", // Squads Smart Account
  "SWiGmQedKzMz1tiTqoJCWeGDnGXfNBp2PkXLkpCAtQo", // Swig (legacy)
  "swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB", // Swig v2
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw", // SPL Governance
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", // Metaplex Core
  LIGHTHOUSE_PROGRAM_ID,
] as const;

/** The facilitator's smart-wallet allowlist with Leash added. */
export function leashSmartWalletAllowlist(leashProgramId: string): string[] {
  return [...X402_DEFAULT_SMART_WALLET_PROGRAMS, leashProgramId];
}

/** Compute and fee limits for Leash x402 payments. */
export const X402_LIMITS = {
  /** Upper bound the facilitator accepts on the smart-wallet path. */
  maxComputeUnits: 400_000,
  maxPriorityFeeMicroLamports: 50_000,
  /** The SDK sets the CU limit to ceil(consumed × margin) after simulating. */
  computeUnitMargin: 1.15,
  defaultPriorityFeeMicroLamports: 1,
} as const;

/**
 * The instruction layout of a Leash x402 payment transaction, in order. The facilitator
 * skips ComputeBudget and Memo when checking its allowlist, so only Leash must be listed.
 */
export const LEASH_X402_INSTRUCTIONS = [
  "ComputeBudget.SetComputeUnitLimit",
  "ComputeBudget.SetComputeUnitPrice",
  "Leash.pay",
  "Memo",
] as const;
