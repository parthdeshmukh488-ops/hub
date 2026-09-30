import type { KeyPairSigner } from "@solana/kit";
import type { FacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import type { LiteSVM } from "litesvm";
import { createLeashFacilitator } from "../facilitator/index.ts";
import { litesvmFacilitatorSigner } from "./litesvm-facilitator-signer.ts";

/**
 * The official facilitator with Leash allowlisted (`createLeashFacilitator`) over LiteSVM, as the
 * `FacilitatorClient` a merchant (`leashMerchant`) takes: a whole x402 payment path in process.
 */
export function litesvmFacilitatorClient(
  svm: LiteSVM,
  feePayers: readonly KeyPairSigner[],
  network: Network,
): FacilitatorClient {
  const facilitator = createLeashFacilitator({
    signer: litesvmFacilitatorSigner(svm, feePayers),
    networks: network,
  });
  return {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    getSupported: async () =>
      facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
  };
}
