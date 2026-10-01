import {
  type Address,
  type EncodedAccount,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getSolanaErrorFromTransactionError,
  type MaybeEncodedAccount,
  type ReadonlyUint8Array,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SolanaError,
  type Transaction,
} from "@solana/kit";
import { FailedTransactionMetadata, type LiteSVM, type TransactionMetadata } from "litesvm";
import type {
  AccountFilter,
  LeashChain,
  SignatureInfo,
  SignaturePage,
  SimulationResult,
} from "../chain.ts";
import type { TransactionRecord } from "../events.ts";

// `LeashChain` on an in-process LiteSVM (the `litesvm` npm package). Errors come out exactly as a
// real RPC reports them: a preflight failure whose cause is the transaction error, so the SDK's
// error handling runs unchanged in tests.
//
// LiteSVM accepts only its latest blockhash, which changes on `expireBlockhash()`, and it rejects
// a transaction identical to one it already processed. Build the LiteSVM with
// `withTransactionHistory(0n)` when a test may send the same instructions twice (the testbed does).

/** `LeashChain` over LiteSVM, plus the transactions it confirmed. */
export type LiteSvmChain = LeashChain & {
  /** Every transaction this chain confirmed, oldest first. */
  readonly history: readonly TransactionRecord[];
};

export function litesvmChain(svm: LiteSVM): LiteSvmChain {
  const history: { record: TransactionRecord; keys: readonly Address[] }[] = [];

  return {
    get history() {
      return history.map((entry) => entry.record);
    },

    async getAccounts(addresses: readonly Address[]): Promise<MaybeEncodedAccount[]> {
      return addresses.map((address) => svm.getAccount(address));
    },

    async getProgramAccounts(
      program: Address,
      filters: readonly AccountFilter[],
    ): Promise<readonly EncodedAccount[]> {
      return svm.getProgramAccounts(program).filter((account) => matches(account.data, filters));
    },

    async getLatestBlockhash() {
      // LiteSVM has no block heights; any bound works.
      return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 2n ** 62n };
    },

    async simulate(transaction: Transaction): Promise<SimulationResult> {
      const result = svm.simulateTransaction(transaction);
      if (result instanceof FailedTransactionMetadata) {
        const meta = result.meta();
        return {
          err: toRpcTransactionError(result.err()),
          logs: meta.logs(),
          unitsConsumed: meta.computeUnitsConsumed(),
        };
      }
      const meta = result.meta();
      return { err: null, logs: meta.logs(), unitsConsumed: meta.computeUnitsConsumed() };
    },

    async sendAndConfirm(transaction: Transaction): Promise<TransactionRecord> {
      const result = svm.sendTransaction(transaction);
      if (result instanceof FailedTransactionMetadata) {
        const meta = result.meta();
        throw new SolanaError(
          SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
          {
            accounts: null,
            fee: null,
            logs: meta.logs(),
            loadedAccountsDataSize: undefined,
            replacementBlockhash: null,
            returnData: null,
            unitsConsumed: meta.computeUnitsConsumed(),
            cause: getSolanaErrorFromTransactionError(
              toRpcTransactionError(result.err()) as Parameters<
                typeof getSolanaErrorFromTransactionError
              >[0],
            ),
          } as never,
        );
      }
      const keys = getCompiledTransactionMessageDecoder().decode(
        transaction.messageBytes,
      ).staticAccounts;
      const record = toRecord(svm, keys, result);
      history.push({ record, keys });
      return record;
    },

    async getRecentTransactions(address: Address, limit: number) {
      return history
        .filter((entry) => entry.keys.includes(address))
        .map((entry) => entry.record)
        .reverse()
        .slice(0, limit);
    },

    async getSignatures(address: Address, page: SignaturePage) {
      // Newest first, like the RPC. Only confirmed transactions are kept here, so `err` is null.
      const newestFirst = history.filter((entry) => entry.keys.includes(address)).reverse();
      const start = page.before
        ? newestFirst.findIndex((entry) => entry.record.signature === page.before) + 1
        : 0;
      const infos: SignatureInfo[] = [];
      // An unknown `before` lists nothing (start 0 would restart from the newest).
      if (page.before && start === 0) return infos;
      for (const { record } of newestFirst.slice(start)) {
        if (record.signature === page.until || infos.length >= page.limit) break;
        infos.push({
          signature: record.signature,
          slot: BigInt(record.slot),
          err: null,
          blockTime: record.blockTime === null ? null : BigInt(record.blockTime),
        });
      }
      return infos;
    },

    async getTransactionRecord(signature: string) {
      return history.find((entry) => entry.record.signature === signature)?.record ?? null;
    },
  };
}

function matches(data: ReadonlyUint8Array, filters: readonly AccountFilter[]): boolean {
  return filters.every((filter) => {
    if ("dataSize" in filter) return data.length === filter.dataSize;
    const { offset, bytes } = filter.memcmp;
    return (
      offset + bytes.length <= data.length && bytes.every((byte, i) => data[offset + i] === byte)
    );
  });
}

function toRecord(
  svm: LiteSVM,
  keys: readonly Address[],
  meta: TransactionMetadata,
): TransactionRecord {
  const clock = svm.getClock();
  return {
    signature: getBase58Decoder().decode(meta.signature()),
    slot: clock.slot,
    blockTime: clock.unixTimestamp,
    err: null,
    innerInstructions: meta.innerInstructions().flatMap((group) =>
      group.map((inner) => {
        const instruction = inner.instruction();
        const programAddress = keys[instruction.programIdIndex()];
        if (programAddress === undefined) throw new Error("inner instruction program out of range");
        return { programAddress, data: instruction.data() };
      }),
    ),
  };
}

// LiteSVM reports errors as native objects and `const enum` numbers; the RPC reports JSON. The
// name tables follow LiteSVM's `TransactionErrorFieldless` and `InstructionErrorFieldless`.

const TRANSACTION_ERRORS = [
  "AccountInUse",
  "AccountLoadedTwice",
  "AccountNotFound",
  "ProgramAccountNotFound",
  "InsufficientFundsForFee",
  "InvalidAccountForFee",
  "AlreadyProcessed",
  "BlockhashNotFound",
  "CallChainTooDeep",
  "MissingSignatureForFee",
  "InvalidAccountIndex",
  "SignatureFailure",
  "InvalidProgramForExecution",
  "SanitizeFailure",
  "ClusterMaintenance",
  "AccountBorrowOutstanding",
  "WouldExceedMaxBlockCostLimit",
  "UnsupportedVersion",
  "InvalidWritableAccount",
  "WouldExceedMaxAccountCostLimit",
  "WouldExceedAccountDataBlockLimit",
  "TooManyAccountLocks",
  "AddressLookupTableNotFound",
  "InvalidAddressLookupTableOwner",
  "InvalidAddressLookupTableData",
  "InvalidAddressLookupTableIndex",
  "InvalidRentPayingAccount",
  "WouldExceedMaxVoteCostLimit",
  "WouldExceedAccountDataTotalLimit",
  "MaxLoadedAccountsDataSizeExceeded",
  "ResanitizationNeeded",
  "InvalidLoadedAccountsDataSizeLimit",
  "UnbalancedTransaction",
  "ProgramCacheHitMaxLimit",
  "CommitCancelled",
] as const;

const INSTRUCTION_ERRORS = [
  "GenericError",
  "InvalidArgument",
  "InvalidInstructionData",
  "InvalidAccountData",
  "AccountDataTooSmall",
  "InsufficientFunds",
  "IncorrectProgramId",
  "MissingRequiredSignature",
  "AccountAlreadyInitialized",
  "UninitializedAccount",
  "UnbalancedInstruction",
  "ModifiedProgramId",
  "ExternalAccountLamportSpend",
  "ExternalAccountDataModified",
  "ReadonlyLamportChange",
  "ReadonlyDataModified",
  "DuplicateAccountIndex",
  "ExecutableModified",
  "RentEpochModified",
  "NotEnoughAccountKeys",
  "AccountDataSizeChanged",
  "AccountNotExecutable",
  "AccountBorrowFailed",
  "AccountBorrowOutstanding",
  "DuplicateAccountOutOfSync",
  "InvalidError",
  "ExecutableDataModified",
  "ExecutableLamportChange",
  "ExecutableAccountNotRentExempt",
  "UnsupportedProgramId",
  "CallDepth",
  "MissingAccount",
  "ReentrancyNotAllowed",
  "MaxSeedLengthExceeded",
  "InvalidSeeds",
  "InvalidRealloc",
  "ComputationalBudgetExceeded",
  "PrivilegeEscalation",
  "ProgramEnvironmentSetupFailure",
  "ProgramFailedToComplete",
  "ProgramFailedToCompile",
  "Immutable",
  "IncorrectAuthority",
  "AccountNotRentExempt",
  "InvalidAccountOwner",
  "ArithmeticOverflow",
  "UnsupportedSysvar",
  "IllegalOwner",
  "MaxAccountsDataAllocationsExceeded",
  "MaxAccountsExceeded",
  "MaxInstructionTraceLengthExceeded",
  "BuiltinProgramsMustConsumeComputeUnits",
  "BorshIoError",
] as const;

type NativeError = ReturnType<FailedTransactionMetadata["err"]>;

/** A LiteSVM transaction error in the RPC's JSON shape. */
export function toRpcTransactionError(error: NativeError): unknown {
  if (typeof error === "number") return TRANSACTION_ERRORS[error] ?? "UnknownTransactionError";
  if ("err" in error && typeof error.err === "function") {
    const inner = error.err();
    const detail =
      typeof inner === "number"
        ? (INSTRUCTION_ERRORS[inner] ?? "GenericError")
        : "code" in inner
          ? { Custom: inner.code }
          : { BorshIoError: inner.msg };
    return { InstructionError: [error.index, detail] };
  }
  if ("index" in error) return { DuplicateInstruction: error.index };
  const name = String(error).includes("ProgramExecutionTemporarilyRestricted")
    ? "ProgramExecutionTemporarilyRestricted"
    : "InsufficientFundsForRent";
  return { [name]: { account_index: error.accountIndex } };
}
