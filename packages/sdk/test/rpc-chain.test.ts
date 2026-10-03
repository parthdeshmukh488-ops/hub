import {
  type Address,
  type Blockhash,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Encoder,
  getBase64Decoder,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
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
    // Two pending polls (500 ms each), then one retry of the record the node did not have yet.
    expect(sleep.mock.calls).toEqual([[500], [500], [500]]);
  });

  it("polls quickly at first, then once a second: a public RPC counts every request", async () => {
    const statuses = [null, null, null, null, { confirmationStatus: "confirmed" }];
    const sleep = vi.fn(async (_ms: number) => {});
    const chain = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () => call({ value: [statuses.shift() ?? null] }),
        getBlockHeight: () => call(50n),
        getTransaction: () => call(RPC_TRANSACTION),
      } as never,
      sleep,
    });
    await chain.sendAndConfirm(await signedTransaction());
    expect(sleep.mock.calls).toEqual([[500], [500], [1_000], [1_000]]);
  });

  it("checks the blockhash's expiry on the fourth poll, then every fourth", async () => {
    const statuses = [...Array<null>(8).fill(null), { confirmationStatus: "confirmed" }];
    const getBlockHeight = vi.fn(() => call(50n));
    const chain = rpcChain({
      rpc: {
        sendTransaction: () => call("sig"),
        getSignatureStatuses: () => call({ value: [statuses.shift() ?? null] }),
        getBlockHeight,
        getTransaction: () => call(RPC_TRANSACTION),
      } as never,
      sleep: async () => {},
    });
    await chain.sendAndConfirm(await signedTransaction());
    // Polls 0 to 7 were pending: the height was read on polls 3 and 7.
    expect(getBlockHeight).toHaveBeenCalledTimes(2);
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
      sleep: async () => {},
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

  it("pages signatures and fetches single transactions, cursors passed through", async () => {
    const calls: unknown[][] = [];
    const chain = rpcChain({
      rpc: {
        getSignaturesForAddress: (...args: unknown[]) => {
          calls.push(args);
          return call([
            { signature: "s2", slot: 9n, err: null, blockTime: 1_790_935_200n },
            {
              signature: "s1",
              slot: 8n,
              err: { InstructionError: [0, "GenericError"] },
              blockTime: null,
            },
          ]);
        },
        getTransaction: (signature: string) => call(signature === "s2" ? RPC_TRANSACTION : null),
      } as never,
      commitment: "finalized",
    });
    expect(await chain.getSignatures(LEASH, { limit: 2, before: "b", until: "u" })).toEqual([
      { signature: "s2", slot: 9n, err: null, blockTime: 1_790_935_200n },
      {
        signature: "s1",
        slot: 8n,
        err: { InstructionError: [0, "GenericError"] },
        blockTime: null,
      },
    ]);
    await chain.getSignatures(LEASH, { limit: 1000 });
    expect(calls).toEqual([
      [LEASH, { commitment: "finalized", limit: 2, before: "b", until: "u" }],
      [LEASH, { commitment: "finalized", limit: 1000 }],
    ]);
    expect(await chain.getTransactionRecord("s2")).toMatchObject({ signature: "sig", slot: 7n });
    expect(await chain.getTransactionRecord("s3")).toBeNull();
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
        getTransaction: () => failing,
      } as never,
      sleep: async () => {},
    });
    const transaction = await signedTransaction();
    const reads: Array<() => Promise<unknown>> = [
      () => chain.getAccounts([LEASH]),
      () => chain.getProgramAccounts(LEASH, []),
      () => chain.getLatestBlockhash(),
      () => chain.simulate(transaction),
      () => chain.getRecentTransactions(LEASH, 5),
      () => chain.getSignatures(LEASH, { limit: 5 }),
      () => chain.getTransactionRecord("s"),
    ];
    for (const read of reads) {
      const error = await read().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LeashNetworkError);
      expect((error as Error).cause).toBe(down);
    }
    // A dropped connection is transient: each read was tried once and retried four times.
    expect(failing.send).toHaveBeenCalledTimes(reads.length * 5);
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
  describe("retries, for public RPCs that throttle (devnet)", () => {
    const httpError = (statusCode: number, retryAfter?: string) =>
      new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
        headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}),
        message: `HTTP ${statusCode}`,
        statusCode,
      });
    /** A call that fails with `errors` in order, then answers `value`. */
    const flaky = <T>(errors: unknown[], value: T) => ({
      send: vi.fn(async () => {
        const error = errors.shift();
        if (error) throw error;
        return value;
      }),
    });
    const BLOCKHASH = { value: { blockhash: "abc", lastValidBlockHeight: 9n } };

    it("retries a throttled or failing read with backoff, honouring Retry-After", async () => {
      const sleep = vi.fn(async (_ms: number) => {});
      const answer = flaky([httpError(429), httpError(503), httpError(429, "3")], BLOCKHASH);
      const chain = rpcChain({ rpc: { getLatestBlockhash: () => answer } as never, sleep });
      expect(await chain.getLatestBlockhash()).toEqual(BLOCKHASH.value);
      expect(answer.send).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500, 3_000]);
    });

    it("does not retry a request the RPC rejected as wrong, and gives up after four retries", async () => {
      const sleep = vi.fn(async (_ms: number) => {});
      const wrong = flaky([httpError(400)], BLOCKHASH);
      const chain = rpcChain({ rpc: { getLatestBlockhash: () => wrong } as never, sleep });
      await expect(chain.getLatestBlockhash()).rejects.toBeInstanceOf(LeashNetworkError);
      expect(wrong.send).toHaveBeenCalledTimes(1);

      const throttledForever = flaky(
        Array.from({ length: 9 }, () => httpError(429)),
        BLOCKHASH,
      );
      const busy = rpcChain({
        rpc: { getLatestBlockhash: () => throttledForever } as never,
        sleep,
      });
      await expect(busy.getLatestBlockhash()).rejects.toBeInstanceOf(LeashNetworkError);
      expect(throttledForever.send).toHaveBeenCalledTimes(5);
      const none = rpcChain({
        rpc: { getLatestBlockhash: () => flaky([httpError(429)], BLOCKHASH) } as never,
        sleep,
        retries: 0,
      });
      await expect(none.getLatestBlockhash()).rejects.toBeInstanceOf(LeashNetworkError);
    });

    it("sends again only when throttled, and keeps polling through a throttled status check", async () => {
      const sleep = vi.fn(async (_ms: number) => {});
      let sends = 0;
      const send = flaky([httpError(429)], "sig");
      const statuses = flaky([httpError(429)], {
        value: [{ confirmationStatus: "confirmed", err: null }],
      });
      const chain = rpcChain({
        rpc: {
          sendTransaction: () => {
            sends += 1;
            return send;
          },
          getSignatureStatuses: () => statuses,
          getBlockHeight: () => call(50n),
          getTransaction: () => call(RPC_TRANSACTION),
        } as never,
        sleep,
      });
      const record = await chain.sendAndConfirm(await signedTransaction());
      expect(record).toMatchObject({ signature: "sig", err: null });
      // The RPC refused the first send with 429 (not processed), so it was sent once more.
      expect(sends).toBe(2);
      expect(send.send).toHaveBeenCalledTimes(2);
      expect(statuses.send).toHaveBeenCalledTimes(2);

      // A 503 on a send may have reached the network: it is not repeated, and it is a network
      // error for the tools.
      const unavailable = flaky([httpError(503)], "sig");
      const failing = rpcChain({
        rpc: { sendTransaction: () => unavailable } as never,
        sleep,
      });
      await expect(failing.sendAndConfirm(await signedTransaction())).rejects.toBeInstanceOf(
        LeashNetworkError,
      );
      expect(unavailable.send).toHaveBeenCalledTimes(1);

      // The RPC's own answer about the transaction (a preflight failure) stays as it is:
      // LeashAgent reads the program's error from it.
      const preflight = new Error("Transaction simulation failed: custom program error: 0x1773");
      const refused = rpcChain({
        rpc: { sendTransaction: () => flaky([preflight], "sig") } as never,
        sleep,
      });
      await expect(refused.sendAndConfirm(await signedTransaction())).rejects.toBe(preflight);
    });
  });
});
