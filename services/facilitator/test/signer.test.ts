import { CAIP2 } from "@leash/contracts";
import { createSolanaRpcFromTransport, generateKeyPairSigner } from "@solana/kit";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { describe, expect, it } from "vitest";
import { facilitatorSigner } from "../src/signer.ts";

// The facilitator's RPC wiring, without a network: a kit RPC over a transport that records the
// methods it is asked for (the laptop found this on a real validator, 2026-10-01).

function recordingRpc() {
  const methods: string[] = [];
  const rpc = createSolanaRpcFromTransport(async ({ payload }) => {
    const { id, method } = payload as { id: number; method: string };
    methods.push(method);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        context: { slot: 1n },
        value: { err: null, logs: [], unitsConsumed: 1n, accounts: null },
      },
    } as never;
  });
  // Branded like the devnet RPC main.ts builds; the brand only types it.
  return { rpc: rpc as unknown as Parameters<typeof facilitatorSigner>[1], methods };
}

describe("the facilitator's signer", () => {
  it("simulates through our one RPC on every network we serve", async () => {
    const keypair = await generateKeyPairSigner();
    for (const network of [CAIP2.localnet, CAIP2.devnet]) {
      const { rpc, methods } = recordingRpc();
      const signer = facilitatorSigner(keypair, rpc, network);
      await signer.simulateTransaction("AQ==", network);
      expect(methods, network).toEqual(["simulateTransaction"]);
      expect(signer.getAddresses()).toEqual([keypair.address]);
    }
  });

  it("works around the official detection, which reads a bare kit RPC as a per-network map", async () => {
    const keypair = await generateKeyPairSigner();
    const { rpc, methods } = recordingRpc();
    await expect(
      toFacilitatorSvmSigner(keypair, rpc).simulateTransaction("AQ==", CAIP2.localnet),
    ).rejects.toThrow(/simulateTransaction is not a function/);
    expect(methods).toEqual([]);
  });
});
