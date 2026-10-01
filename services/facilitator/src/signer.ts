import { type FacilitatorSvmSigner, toFacilitatorSvmSigner } from "@x402/svm";

type SignerKey = Parameters<typeof toFacilitatorSvmSigner>[0];
type FacilitatorRpc = Extract<
  NonNullable<Parameters<typeof toFacilitatorSvmSigner>[1]>,
  { getBalance: unknown }
>;

/**
 * The official facilitator signer over our one RPC, for `network`.
 *
 * The RPC goes in as a per-network map. `toFacilitatorSvmSigner` tells a single RPC from a map
 * with `"getBalance" in rpc`. A kit RPC is a Proxy without a `has` trap, so that check is false,
 * and a bare RPC would be read as a map. Every simulation then fails with "rpc.simulateTransaction
 * is not a function", on localnet and devnet alike (found on the laptop, 2026-10-01).
 */
export function facilitatorSigner(
  keypair: SignerKey,
  rpc: FacilitatorRpc,
  network: string,
): FacilitatorSvmSigner {
  return toFacilitatorSvmSigner(keypair, { [network]: rpc });
}
