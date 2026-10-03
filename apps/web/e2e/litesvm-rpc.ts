import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { TransactionRecord } from "@leash/sdk";
import type { LiteSvmChain } from "@leash/sdk/testing";
import {
  type Address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";

// A Solana JSON-RPC endpoint over the LiteSVM testbed, for the browser tests: the web app's own
// `rpcChain` talks to it exactly as it talks to devnet. It answers the methods the owner's write
// path uses (accounts, program accounts, blockhash, send, statuses, transactions). Test code only.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const toBase64 = (bytes: Uint8Array) => getBase64Decoder().decode(bytes);
const fromBase64 = (text: string) => new Uint8Array(getBase64Encoder().encode(text));
const toBase58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
const fromBase58 = (text: string) => new Uint8Array(getBase58Encoder().encode(text));

export type LiteSvmRpc = { url: string; close: () => Promise<void> };

export async function startLiteSvmRpc(
  chain: LiteSvmChain,
  options: {
    /** Called after each confirmed transaction (the test indexer syncs here). */
    onConfirmed?: (record: TransactionRecord) => Promise<void>;
    port?: number;
  } = {},
): Promise<LiteSvmRpc> {
  const records = new Map<string, TransactionRecord>();

  const accountJson = (account: {
    data: Uint8Array | ArrayLike<number>;
    executable: boolean;
    lamports: bigint;
    programAddress: string;
    space: bigint;
  }): Json => ({
    data: [toBase64(Uint8Array.from(account.data)), "base64"],
    executable: account.executable,
    lamports: Number(account.lamports),
    owner: account.programAddress,
    rentEpoch: 0,
    space: Number(account.space),
  });
  const context = { slot: 1 };

  const methods: Record<string, (params: Json[]) => Promise<Json>> = {
    async getMultipleAccounts([addresses]) {
      const accounts = await chain.getAccounts(addresses as Address[]);
      return {
        context,
        value: accounts.map((account) => (account.exists ? accountJson(account) : null)),
      };
    },
    async getAccountInfo([address]) {
      const [account] = await chain.getAccounts([address as Address]);
      return { context, value: account?.exists ? accountJson(account) : null };
    },
    async getProgramAccounts([program, config]) {
      const filters = ((config as { filters?: Json[] } | null)?.filters ?? []).map((filter) => {
        const f = filter as {
          dataSize?: number;
          memcmp?: { offset: number; bytes: string; encoding?: string };
        };
        if (f.dataSize !== undefined) return { dataSize: Number(f.dataSize) };
        const memcmp = f.memcmp as { offset: number; bytes: string; encoding?: string };
        const bytes =
          memcmp.encoding === "base64" ? fromBase64(memcmp.bytes) : fromBase58(memcmp.bytes);
        return { memcmp: { offset: Number(memcmp.offset), bytes } };
      });
      const accounts = await chain.getProgramAccounts(program as Address, filters);
      return accounts.map((account) => ({
        pubkey: account.address,
        account: accountJson(account),
      }));
    },
    async getLatestBlockhash() {
      const { blockhash } = await chain.getLatestBlockhash();
      return { context, value: { blockhash, lastValidBlockHeight: 1_000_000_000 } };
    },
    async getBlockHeight() {
      return 1;
    },
    async sendTransaction([wire]) {
      const transaction = getTransactionDecoder().decode(fromBase64(wire as string));
      // Preflight, as an RPC node does: a failing transaction is refused with its error.
      const simulation = await chain.simulate(transaction);
      if (simulation.err !== null) {
        throw new RpcError(-32002, "Transaction simulation failed", {
          err: simulation.err as Json,
          logs: [...simulation.logs],
          accounts: null,
          unitsConsumed: Number(simulation.unitsConsumed),
          returnData: null,
        });
      }
      const record = await chain.sendAndConfirm(transaction);
      records.set(record.signature, record);
      await options.onConfirmed?.(record);
      return getSignatureFromTransaction(transaction);
    },
    async getSignatureStatuses([signatures]) {
      return {
        context,
        value: (signatures as string[]).map((signature) =>
          records.has(signature)
            ? { slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" }
            : null,
        ),
      };
    },
    async getTransaction([signature]) {
      const record = records.get(signature as string);
      if (!record) return null;
      const keys = [...new Set(record.innerInstructions.map((ix) => ix.programAddress))];
      return {
        slot: Number(record.slot),
        blockTime: record.blockTime === null ? null : Number(record.blockTime),
        transaction: {
          signatures: [record.signature],
          message: { accountKeys: keys, instructions: [], recentBlockhash: "", header: null },
        },
        meta: {
          err: null,
          innerInstructions: [
            {
              index: 0,
              instructions: record.innerInstructions.map((ix) => ({
                programIdIndex: keys.indexOf(ix.programAddress),
                accounts: [],
                data: toBase58(Uint8Array.from(ix.data)),
              })),
            },
          ],
          loadedAddresses: { writable: [], readonly: [] },
        },
      };
    },
    async getGenesisHash() {
      return "LiteSVM111111111111111111111111111111111111";
    },
  };

  const server: Server = createServer(async (request, response) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors).end();
      return;
    }
    const body = JSON.parse(await readBody(request)) as {
      id: Json;
      method: string;
      params?: Json[];
    };
    const method = methods[body.method];
    let reply: Json;
    try {
      if (!method) throw new RpcError(-32601, `Method not found: ${body.method}`);
      reply = { jsonrpc: "2.0", id: body.id, result: await method(body.params ?? []) };
    } catch (error) {
      const rpc = error instanceof RpcError ? error : new RpcError(-32603, String(error));
      reply = {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: rpc.code, message: rpc.message, ...(rpc.data ? { data: rpc.data } : {}) },
      };
    }
    response.writeHead(200, { ...cors, "content-type": "application/json" });
    response.end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Json,
  ) {
    super(message);
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      text += chunk;
    });
    request.on("end", () => resolve(text));
    request.on("error", reject);
  });
}
