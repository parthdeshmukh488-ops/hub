import {
  type Address,
  type Blockhash,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Encoder,
  getBase64Decoder,
  SolanaError,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import {
  buildSetGuardian,
  buildTransactionMessage,
  LeashNetworkError,
  rpcChain,
} from "../src/index.ts";
import { testKeySeed } from "../src/testing/index.ts";

// rpcChain against a scripted RPC: the cloud cannot reach devnet (ADR-0007); `pnpm devnet:smoke`
// runs it for real on the laptop.

const call = <T>(value: T) => ({ send: vi.fn(async () => value) });
const LEASH = "HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu" as Address;
const base64 = (bytes: number[]) => getBase64Decoder().decode(new Uint8Array(bytes));

async function signedTransaction(lastValidBlockHeight = 100n) {
  const owner = await createKeyPairSignerFromPrivateKeyBytes(await testKeySeed("owner"));
  const message = buildTransactionMessage({
    feePayer: owner,
    instructions: [await buildSetGuardian({ owner, guardian: null })],
    lifetime: {
      blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N" as Blockhash,
      lastValidBlockHeight,
    },
  });
  return signTransactionMessageWithSigners(message);
}

const RPC_TRANSACTION = {
  slot: 7n,
  blockTime: 1_790_935_200n,
  meta: { err: null, innerInstructions: [], loadedAddresses: { writable: [], readonly: [] } },
  transaction: { message: { accountKeys: [LEASH] }, signatures: ["sig"] },
};

describe("rpcChain", () => {
  it("reads accounts and program accounts in the RPC's encodings", async () => {
    const getMultipleAccounts = call({
      context: { slot: 1n },
      value: [
        {
          data: [base64([1, 2, 3]), "base64"],
          executable: false,
          lamports: 5n,
          owner: LEASH,
          space: 3n,
        },
        null,
      ],
    });
    const getProgramAccounts = call([
      {
        pubkey: "11111111111111111111111111111112",
        account: {
          data: [base64([9]), "base64"],
          executable: false,
          lamports: 1n,
          owner: LEASH,
          space: 1n,
        },
      },
    ]);
    const chain = rpcChain({
      rpc: {
        getMultipleAccounts: () => getMultipleAccounts,
        getProgramAccounts: (...args: unknown[]) => {
          lastArgs = args;
          return getProgramAccounts;
        },
      } as never,
    });
    let lastArgs: unknown[] = [];
    const [found, missing] = await chain.getAccounts([
      "11111111111111111111111111111112" as Address,
      "11111111111111111111111111111113" as Address,
    ]);
    expect(found).toMatchObject({ exists: true, programAddress: LEASH });
    expect(found?.exists && [...found.data]).toEqual([1, 2, 3]);
    expect(missing).toMatchObject({ exists: false });

    const accounts = await chain.getProgramAccounts(LEASH, [
      { memcmp: { offset: 10, bytes: getBase58Encoder().encode("2") } },
      { dataSize: 191 },
    ]);
    expect(accounts).toHaveLength(1);
    expect([...(accounts[0]?.data ?? [])]).toEqual([9]);
    expect(lastArgs[1]).toEqual({
      commitment: "confirmed",
      encoding: "base64",
      filters: [{ memcmp: { bytes: "2", encoding: "base58", offset: 10n } }, { dataSize: 191n }],
    });
  });

  it("returns blockhashes and simulation results", async () => {
    const chain = rpcChain({
      rpc: {
        getLatestBlockhash: () => call({ value: { blockhash: "abc", lastValidBlockHeight: 9n } }),
        simulateTransaction: () =>
          call({ value: { err: { InstructionError: [0, { Custom: 6003 }] }, logs: null } }),
      } as never,
    });
    expect(await chain.getLatestBlockhash()).toEqual({
      blockhash: "abc",
      lastValidBlockHeight: 9n,
    });
    expect(await chain.simulate(await signedTransaction())).toEqual({
      err: { InstructionError: [0, { Custom: 6003 }] },
      logs: [],
      unitsConsumed: 0n,
    });
  });

  it("sends, polls until confirmed and returns the confirmed transaction", async () => {
    const statuses = [
      null,
      { confirmationStatus: "processed", err: null },
      { confirmationStatus: "confirmed", err: null },
    ];
    const transactions = [null, RPC_TRANSACTION];
    const sleep = vi.fn(async () => {});
    const sendTransaction = vi.fn((..._args: unknown[]) => call("sig"));
    const chain = rpcChain({
      rpc: {
        sendTransaction,
        getSignatureStatuses: () => call({ value: [statuses.shift()] }),
        getBlockHeight: () => call(50n),
        getTransaction: () => call(transactions.shift()),
      } as never,
      sleep,
    });
    const record = await chain.sendAndConfirm(await signedTransaction());
    expect(record).toMatchObject({ signature: "sig", slot: 7n, err: null });
    expect(sendTransaction.mock.calls[0]?.[1]).toEqual({
      encoding: "base64",
      preflightCommitment: "confirmed",
    });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("waits for finalized when asked to", async () => {
    const statuses = [
      { confirmationStatus: "confirmed", err: null },
      { confirmationStatus: "finalized", err: null },
    ];
    const chain = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () => call({ value: [statuses.shift()] }),
        getBlockHeight: () => call(50n),
        getTransaction: () => call(RPC_TRANSACTION),
      } as never,
      commitment: "finalized",
      sleep: async () => {},
    });
    await expect(chain.sendAndConfirm(await signedTransaction())).resolves.toMatchObject({
      signature: "sig",
    });
    expect(statuses).toEqual([]);
  });

  it("throws the transaction error of a failed transaction", async () => {
    const chain = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () =>
          call({
            value: [
              { confirmationStatus: "confirmed", err: { InstructionError: [2, { Custom: 6003 }] } },
            ],
          }),
      } as never,
    });
    const error = await chain.sendAndConfirm(await signedTransaction()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SolanaError);
    expect(error).toMatchObject({ context: { code: 6003, index: 2 } });
  });

  it("gives up when the blockhash expires or the transaction never shows up", async () => {
    const pending = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () => call({ value: [null] }),
        getBlockHeight: () => call(101n),
      } as never,
    });
    await expect(pending.sendAndConfirm(await signedTransaction(100n))).rejects.toBeInstanceOf(
      LeashNetworkError,
    );
    const unindexed = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () =>
          call({ value: [{ confirmationStatus: "confirmed", err: null }] }),
        getTransaction: () => call(null),
      } as never,
      sleep: async () => {},
    });
    await expect(unindexed.sendAndConfirm(await signedTransaction())).rejects.toThrow(
      /confirmed but not retrievable/,
    );
    // A transaction without a blockhash lifetime is polled without an expiry check.
    const statuses = [null, { confirmationStatus: "confirmed", err: null }];
    const noLifetime = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () => call({ value: [statuses.shift()] }),
        getTransaction: () => call(RPC_TRANSACTION),
      } as never,
      sleep: async () => {},
    });
    const { lifetimeConstraint: _, ...bare } = await signedTransaction();
    await expect(noLifetime.sendAndConfirm(bare as never)).resolves.toMatchObject({
      signature: "sig",
    });
  });

  it("lists recent successful transactions", async () => {
    const getTransaction = vi.fn(() => call(RPC_TRANSACTION));
    const chain = rpcChain({
      rpc: {
        getSignaturesForAddress: () =>
          call([
            { signature: "a", err: null },
            { signature: "b", err: { InstructionError: [0, "GenericError"] } },
          ]),
        getTransaction,
      } as never,
    });
    expect(await chain.getRecentTransactions(LEASH, 5)).toHaveLength(1);
    expect(getTransaction).toHaveBeenCalledTimes(1);
  });

  it("turns a failed read into LeashNetworkError, cause kept, so the tools say NETWORK_ERROR", async () => {
    const down = new TypeError("fetch failed");
    const failing = { send: vi.fn(async () => Promise.reject(down)) };
    const chain = rpcChain({
      rpc: {
        getMultipleAccounts: () => failing,
        getProgramAccounts: () => failing,
        getLatestBlockhash: () => failing,
        simulateTransaction: () => failing,
        getSignaturesForAddress: () => failing,
      } as never,
    });
    const transaction = await signedTransaction();
    const reads: Array<() => Promise<unknown>> = [
      () => chain.getAccounts([LEASH]),
      () => chain.getProgramAccounts(LEASH, []),
      () => chain.getLatestBlockhash(),
      () => chain.simulate(transaction),
      () => chain.getRecentTransactions(LEASH, 5),
    ];
    for (const read of reads) {
      const error = await read().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LeashNetworkError);
      expect((error as Error).cause).toBe(down);
    }
    // A network error from deeper down keeps its own message.
    const unindexed = rpcChain({
      rpc: {
        getSignaturesForAddress: () => call([{ signature: "a", err: null }]),
        getTransaction: () => call(null),
      } as never,
      sleep: async () => {},
    });
    await expect(unindexed.getRecentTransactions(LEASH, 1)).rejects.toThrow(
      "Network error: transaction a is confirmed but not retrievable",
    );
  });
});
