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
  type Rpc,
  type SendTransactionApi,
  type Signature,
  type SimulateTransactionApi,
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
  rpc: Rpc<LeashRpcApi>;
  /** Default "confirmed". */
  commitment?: Extract<Commitment, "confirmed" | "finalized">;
  /** Poll interval while waiting for confirmation. Default 500 ms. */
  pollIntervalMs?: number;
  /** Test hook: how to wait between polls. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** A `LeashChain` backed by a Solana RPC endpoint. */
export function rpcChain(options: RpcChainOptions): LeashChain {
  const { rpc } = options;
  const commitment = options.commitment ?? "confirmed";
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const base58 = getBase58Decoder();
  const base64 = getBase64Encoder();

  /** The confirmed transaction, retried while the node has not indexed it yet. */
  async function fetchRecord(signature: Signature): Promise<TransactionRecord> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await rpc
        .getTransaction(signature, {
          commitment,
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      if (response !== null) return transactionRecordFromRpc(response);
      await sleep(pollIntervalMs);
    }
    throw new LeashNetworkError(`transaction ${signature} is confirmed but not retrievable`);
  }

  return {
    async getAccounts(addresses) {
      return reading("reading accounts", () =>
        fetchEncodedAccounts(rpc, [...addresses], { commitment }),
      );
    },

    async getProgramAccounts(program, filters) {
      const accounts = await reading("reading program accounts", () =>
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
      const { value } = await reading("reading the latest blockhash", () =>
        rpc.getLatestBlockhash({ commitment }).send(),
      );
      return value;
    },

    async simulate(transaction): Promise<SimulationResult> {
      const { value } = await reading("simulating", () =>
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
      await rpc
        .sendTransaction(getBase64EncodedWireTransaction(transaction), {
          encoding: "base64",
          preflightCommitment: commitment,
        })
        .send();
      for (;;) {
        const {
          value: [status],
        } = await rpc.getSignatureStatuses([signature]).send();
        if (status?.err) {
          throw getSolanaErrorFromTransactionError(
            status.err as Parameters<typeof getSolanaErrorFromTransactionError>[0],
          );
        }
        const reached =
          status?.confirmationStatus === "finalized" ||
          (commitment === "confirmed" && status?.confirmationStatus === "confirmed");
        if (reached) return fetchRecord(signature);
        if (lastValidBlockHeight !== null) {
          const height = await rpc.getBlockHeight({ commitment }).send();
          if (height > lastValidBlockHeight) {
            throw new LeashNetworkError(`transaction ${signature} expired before it confirmed`);
          }
        }
        await sleep(pollIntervalMs);
      }
    },

    async getSignatures(address: Address, page: SignaturePage) {
      const entries = await reading("reading signatures", () =>
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
      const response = await reading("reading a transaction", () =>
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
      return reading("reading recent transactions", async () => {
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
