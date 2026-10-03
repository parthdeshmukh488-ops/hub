import {
  type Address,
  type Base58EncodedBytes,
  type Commitment,
  type EncodedAccount,
  fetchEncodedAccounts,
  type GetAccountInfoApi,
  type GetBlockHeightApi,
  type GetLatestBlockhashApi,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  type GetSignatureStatusesApi,
  type GetSignaturesForAddressApi,
  type GetTransactionApi,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getSolanaErrorFromTransactionError,
  isSolanaError,
  type Rpc,
  type SendTransactionApi,
  type Signature,
  type SimulateTransactionApi,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Transaction,
} from "@solana/kit";
import type {
  AccountFilter,
  LeashChain,
  SignatureInfo,
  SignaturePage,
  SimulationResult,
} from "./chain.ts";
import { LeashNetworkError } from "./errors.ts";
import { type TransactionRecord, transactionRecordFromRpc } from "./events.ts";
import { BACKOFF_MS, defaultSleep, isThrottled, isTransient, withRetries } from "./retry.ts";

// `LeashChain` over a kit RPC (devnet, localnet). Confirmation polls `getSignatureStatuses` over
// HTTP, so no websocket endpoint is needed.

/** The RPC methods `rpcChain` uses. `createSolanaRpc(url)` provides them all. */
export type LeashRpcApi = GetAccountInfoApi &
  GetBlockHeightApi &
  GetLatestBlockhashApi &
  GetMultipleAccountsApi &
  GetProgramAccountsApi &
  GetSignaturesForAddressApi &
  GetSignatureStatusesApi &
  GetTransactionApi &
  SendTransactionApi &
  SimulateTransactionApi;

export type RpcChainOptions = {
  /** A plain kit RPC such as `createSolanaRpc(url)`: `rpcChain` does its own retrying. */
  rpc: Rpc<LeashRpcApi>;
  /** Default "confirmed". */
  commitment?: Extract<Commitment, "confirmed" | "finalized">;
  /** Poll interval while waiting for confirmation. Default 1 s: public RPCs count requests. */
  pollIntervalMs?: number;
  /** Test hook: how to wait between polls and retries. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Further attempts after a transient failure (default 4, then 0 disables). Public RPCs throttle
   * with HTTP 429, and on devnet every service of the demo shares one IP.
   */
  retries?: number;
};

/**
 * A read that fails (transport, HTTP or JSON-RPC error) means the chain is out of reach, and
 * nothing was charged: `LeashNetworkError`, the cause kept for logs. Sends are classified by
 * `LeashAgent`, which needs the preflight error itself.
 */
async function reading<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LeashNetworkError) throw error;
    throw new LeashNetworkError(`${what} failed`, error);
  }
}

/** The blockhash's expiry is checked on the first poll, then on every this many polls. */
const BLOCK_HEIGHT_EVERY = 4;

/** A failure of the connection or the RPC itself (not an answer about the transaction). */
function transportFailure(error: unknown): boolean {
  return (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) || error instanceof TypeError
  );
}

/** A `LeashChain` backed by a Solana RPC endpoint. */
export function rpcChain(options: RpcChainOptions): LeashChain {
  const { rpc } = options;
  const commitment = options.commitment ?? "confirmed";
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  const base58 = getBase58Decoder();
  const base64 = getBase64Encoder();
  const retry = { retries: options.retries ?? BACKOFF_MS.length, sleep };

  /** Runs `call` again after a failure `worthRetry` accepts (default: transient), backing off. */
  const retrying = <T>(call: () => Promise<T>, worthRetry = isTransient) =>
    withRetries(call, worthRetry, retry);

  /** A read: retried while the failure is transient, then `LeashNetworkError`. */
  const read = <T>(what: string, call: () => Promise<T>) => reading(what, () => retrying(call));

  /** The confirmed transaction, retried while the node has not indexed it yet. */
  async function fetchRecord(signature: Signature): Promise<TransactionRecord> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await read("reading the confirmed transaction", () =>
        rpc
          .getTransaction(signature, {
            commitment,
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          })
          .send(),
      );
      if (response !== null) return transactionRecordFromRpc(response);
      await sleep(pollIntervalMs);
    }
    throw new LeashNetworkError(`transaction ${signature} is confirmed but not retrievable`);
  }

  return {
    async getAccounts(addresses) {
      return read("reading accounts", () =>
        fetchEncodedAccounts(rpc, [...addresses], { commitment }),
      );
    },

    async getProgramAccounts(program, filters) {
      const accounts = await read("reading program accounts", () =>
        rpc
          .getProgramAccounts(program, {
            commitment,
            encoding: "base64",
            filters: filters.map(toRpcFilter),
          })
          .send(),
      );
      return accounts.map(
        ({ pubkey, account }): EncodedAccount => ({
          address: pubkey,
          data: base64.encode(account.data[0]),
          executable: account.executable,
          lamports: account.lamports,
          programAddress: account.owner,
          space: account.space,
        }),
      );
    },

    async getLatestBlockhash() {
      const { value } = await read("reading the latest blockhash", () =>
        rpc.getLatestBlockhash({ commitment }).send(),
      );
      return value;
    },

    async simulate(transaction): Promise<SimulationResult> {
      const { value } = await read("simulating", () =>
        rpc
          .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
            commitment,
            encoding: "base64",
            replaceRecentBlockhash: false,
            sigVerify: false,
          })
          .send(),
      );
      return { err: value.err, logs: value.logs ?? [], unitsConsumed: value.unitsConsumed ?? 0n };
    },

    async sendAndConfirm(transaction: Transaction) {
      const signature = getSignatureFromTransaction(transaction);
      const lastValidBlockHeight = lifetimeOf(transaction);
      // Preflight on: a failing transaction throws the RPC's preflight error, cause included.
      // Repeated only when throttled: any other failure may have reached the network. A failed
      // connection is a network error; the RPC's preflight error stays as it is, because
      // `LeashAgent` reads the program's error from it.
      try {
        await retrying(
          () =>
            rpc
              .sendTransaction(getBase64EncodedWireTransaction(transaction), {
                encoding: "base64",
                preflightCommitment: commitment,
              })
              .send(),
          isThrottled,
        );
      } catch (error) {
        if (transportFailure(error)) {
          throw new LeashNetworkError(`sending transaction ${signature} failed`, error);
        }
        throw error;
      }
      for (let poll = 0; ; poll++) {
        const {
          value: [status],
        } = await read(`checking transaction ${signature}`, () =>
          rpc.getSignatureStatuses([signature]).send(),
        );
        if (status?.err) {
          throw getSolanaErrorFromTransactionError(
            status.err as Parameters<typeof getSolanaErrorFromTransactionError>[0],
          );
        }
        const reached =
          status?.confirmationStatus === "finalized" ||
          (commitment === "confirmed" && status?.confirmationStatus === "confirmed");
        if (reached) return fetchRecord(signature);
        if (lastValidBlockHeight !== null && poll % BLOCK_HEIGHT_EVERY === 0) {
          const height = await read("reading the block height", () =>
            rpc.getBlockHeight({ commitment }).send(),
          );
          if (height > lastValidBlockHeight) {
            throw new LeashNetworkError(`transaction ${signature} expired before it confirmed`);
          }
        }
        await sleep(pollIntervalMs);
      }
    },

    async getSignatures(address: Address, page: SignaturePage) {
      const entries = await read("reading signatures", () =>
        rpc
          .getSignaturesForAddress(address, {
            commitment,
            limit: page.limit,
            ...(page.before ? { before: page.before as Signature } : {}),
            ...(page.until ? { until: page.until as Signature } : {}),
          })
          .send(),
      );
      return entries.map(
        (entry): SignatureInfo => ({
          signature: entry.signature,
          slot: entry.slot,
          err: entry.err,
          blockTime: entry.blockTime === null ? null : BigInt(entry.blockTime),
        }),
      );
    },

    async getTransactionRecord(signature: string) {
      const response = await read("reading a transaction", () =>
        rpc
          .getTransaction(signature as Signature, {
            commitment,
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          })
          .send(),
      );
      return response === null ? null : transactionRecordFromRpc(response);
    },

    async getRecentTransactions(address: Address, limit: number) {
      return read("reading recent transactions", async () => {
        const signatures = await rpc.getSignaturesForAddress(address, { commitment, limit }).send();
        const records: TransactionRecord[] = [];
        for (const entry of signatures) {
          if (entry.err === null) records.push(await fetchRecord(entry.signature));
        }
        return records;
      });
    },
  };

  function toRpcFilter(filter: AccountFilter) {
    if ("dataSize" in filter) return { dataSize: BigInt(filter.dataSize) };
    return {
      memcmp: {
        bytes: base58.decode(filter.memcmp.bytes) as Base58EncodedBytes,
        encoding: "base58" as const,
        offset: BigInt(filter.memcmp.offset),
      },
    };
  }
}

/** The last valid block height of a blockhash-lifetime transaction, or null. */
function lifetimeOf(transaction: Transaction): bigint | null {
  const lifetime = (transaction as { lifetimeConstraint?: { lastValidBlockHeight?: bigint } })
    .lifetimeConstraint;
  return lifetime?.lastValidBlockHeight ?? null;
}
