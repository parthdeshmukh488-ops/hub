import type {
  Address,
  Blockhash,
  EncodedAccount,
  MaybeEncodedAccount,
  ReadonlyUint8Array,
  Transaction,
} from "@solana/kit";
import { address } from "@solana/kit";
import type { TransactionRecord } from "./events.ts";

// The few chain operations the SDK needs, behind one small interface. `rpcChain` implements it
// with a kit RPC (devnet, localnet); `@leash/sdk/testing` implements it with LiteSVM. Reads,
// owner flows and `LeashAgent` only talk to this interface, so the LiteSVM tests run the same
// code as devnet.

/** A `getProgramAccounts` filter: bytes at an offset, or an exact account size. */
export type AccountFilter =
  | { memcmp: { offset: number; bytes: ReadonlyUint8Array } }
  | { dataSize: number };

/** What a simulation tells the SDK. */
export type SimulationResult = {
  /** The transaction error in the RPC's JSON shape (e.g. `{ InstructionError: [1, { Custom: 6003 }] }`), or null. */
  err: unknown;
  logs: readonly string[];
  unitsConsumed: bigint;
};

/** A blockhash lifetime for a new transaction. */
export type BlockhashLifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

export interface LeashChain {
  /** The accounts at `addresses`, in order; missing accounts have `exists: false`. */
  getAccounts(addresses: readonly Address[]): Promise<MaybeEncodedAccount[]>;
  /** The accounts owned by `program` that match every filter. */
  getProgramAccounts(
    program: Address,
    filters: readonly AccountFilter[],
  ): Promise<readonly EncodedAccount[]>;
  getLatestBlockhash(): Promise<BlockhashLifetime>;
  /** Simulates a signed transaction without sending it. */
  simulate(transaction: Transaction): Promise<SimulationResult>;
  /**
   * Sends a signed transaction and waits until it is confirmed. Throws when it fails: a kit
   * `SolanaError` whose cause chain carries the transaction error (so `findLeashFailure` reads
   * it), or a transport error.
   */
  sendAndConfirm(transaction: Transaction): Promise<TransactionRecord>;
  /** Recent successful transactions that touched `address`, newest first. */
  getRecentTransactions(address: Address, limit: number): Promise<readonly TransactionRecord[]>;
}

/** The Clock sysvar. */
export const SYSVAR_CLOCK_ADDRESS = address("SysvarC1ock11111111111111111111111111111111");

/** The Unix time in a Clock sysvar account. */
export function clockUnixTimestamp(clock: MaybeEncodedAccount | undefined): bigint {
  if (!clock?.exists || clock.data.length < 40) throw new Error("the Clock sysvar is unreadable");
  // slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64
  const view = new DataView(clock.data.buffer, clock.data.byteOffset, clock.data.byteLength);
  return view.getBigInt64(32, true);
}

/** The cluster's current Unix time, from the Clock sysvar (what the program sees as `now`). */
export async function readChainTime(chain: LeashChain): Promise<bigint> {
  const [clock] = await chain.getAccounts([SYSVAR_CLOCK_ADDRESS]);
  return clockUnixTimestamp(clock);
}
