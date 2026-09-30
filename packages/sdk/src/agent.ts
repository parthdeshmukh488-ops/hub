import {
  type DenialReason,
  decodeLabel,
  denialInfo,
  encodeMemo,
  LEASH_ERRORS,
  type LeashEvent,
  type LeashEventOf,
  NON_STRIKE_REPORT_COOLDOWN_SECS,
  randomReference,
  referenceToHex,
} from "@leash/contracts";
import {
  type Address,
  getAddressEncoder,
  type Instruction,
  isSolanaError,
  type MaybeEncodedAccount,
  type ReadonlyUint8Array,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTokenDecoder,
} from "@solana-program/token";
import { type DecodedDelegation, decodeDelegation } from "./allowance.ts";
import { clockUnixTimestamp, type LeashChain, SYSVAR_CLOCK_ADDRESS } from "./chain.ts";
import { AGENT_STATUS_FROM_CHAIN, policyToState, REQUEST_STATUS_FROM_CHAIN } from "./convert.ts";
import {
  LeashNetworkError,
  NotPairedError,
  PaymentDeniedError,
  TransactionFailedError,
} from "./errors.ts";
import { evaluatePayment } from "./evaluate/evaluate.ts";
import type { EvaluationError, EvaluationInput, EvaluationResult } from "./evaluate/types.ts";
import { decodeLeashEvents, type TransactionRecord } from "./events.ts";
import * as leash from "./generated/leash/index.ts";
import {
  findAgentPda,
  findDelegationPda,
  findLeashEventAuthorityPda,
  findPayeePda,
  findPrincipalPda,
  findRequestPda,
  findSubscriptionAuthorityPda,
  findSubscriptionsEventAuthorityPda,
  LEASH_PROGRAM_ADDRESS,
  SUBSCRIPTIONS_PROGRAM_ADDRESS,
} from "./pda.ts";
import {
  findLeashFailure,
  type LeashFailure,
  leashFailureFromCode,
  toSdkError,
} from "./program-errors.ts";
import { type AgentStatusSnapshot, readAgentStatus } from "./read.ts";
import { buildTransactionMessage } from "./transactions.ts";

// Build step 5: the agent runtime's side of Leash (WS2 brief, ADR-0002). The agent key signs and
// pays the fees of `pay`, `request_payment` and `report_denied_attempt`. It implements the
// `LeashAgentPort` of @leash/tools (packages/tools/src/ports.ts).

/** Simulations run with this limit; sends use `ceil(consumed × 1.15)`, never more (02 §9). */
export const MAX_COMPUTE_UNITS = 400_000;
/** Priority fee in micro-lamports per compute unit (02 §9 default). */
export const DEFAULT_PRIORITY_FEE_MICROLAMPORTS = 1n;
/** Below this the agent key may not afford its reports (ADR-0002): the SDK warns. */
export const LOW_AGENT_BALANCE_LAMPORTS = 10_000_000n;
/** How many recent agent transactions the idempotency check reads. */
const IDEMPOTENCY_LOOKBACK = 25;

export type LeashAgentOptions = {
  chain: LeashChain;
  /** The agent key. It signs and pays the fees of its own transactions. */
  signer: TransactionSigner;
  /** The owner wallet that paired this agent. */
  owner: Address;
  /** The delegation to pay from. Default: the nonce-0 delegation onboarding creates. */
  delegation?: Address;
  /** Default 1 (02 §9); at most 50 000. */
  priorityFeeMicroLamports?: bigint;
  /** Warnings: parity mismatches, failed reports, a low agent balance. Default `console`. */
  logger?: { warn(message: string, details?: Record<string, unknown>): void };
};

/** A payment that went through, read from its `PaymentExecuted` event. */
export type PaymentResult = {
  signature: string;
  /** Base units. */
  amount: bigint;
  /** The wallet that was paid (owner of the destination token account). */
  payee: string;
  /** The allowlist label, if the payee is on it. */
  payeeLabel: string | null;
  /** The memo as stored on-chain. */
  purpose: string;
  /** Set when the payment used an approved request. */
  requestNonce: bigint | null;
  /** Lowercase hex. */
  reference: string;
  destination: string;
};

/** A payment request waiting for the owner. */
export type PendingRequest = { address: string; nonce: bigint; expiresAt: number };

/** What `report_denied_attempt` recorded. */
export type ReportResult = {
  signature: string;
  reason: DenialReason;
  strike: boolean;
  /** Strikes in the current window after this report. */
  strikes: number;
  /** True if this report froze the agent (tripwire). */
  frozen: boolean;
};

export type PaymentArgs = {
  /** The payee wallet. The SDK pays its associated token account for the agent's mint. */
  to: string;
  /** Base units. */
  amount: bigint;
  /** Stored on-chain as the memo; at most 64 bytes of UTF-8. */
  purpose: string;
  /**
   * Binds the payment to its context (02-contracts §3). A payment with the reference of an
   * already executed payment returns that payment instead of paying twice. Default: random.
   */
  reference?: Uint8Array;
};

type AgentAccounts = {
  principal: Address;
  agent: Address;
  mint: Address;
  tokenProgram: Address;
  subscriptionAuthority: Address;
  delegation: Address;
  source: Address;
};

type OpenRequest = { address: Address; account: leash.PaymentRequest };

/** A payment as `report_denied_attempt` takes it. */
type ReportedPayment = { to: string; amount: bigint; memo: Uint8Array; reference: Uint8Array };

/** Everything a payment is evaluated against, read in one batch. */
type PaymentState = {
  accounts: AgentAccounts;
  now: bigint;
  principal: leash.Principal;
  agent: leash.Agent;
  delegation: DecodedDelegation | null;
  sourceAmount: bigint;
  destination: Address;
  destinationExists: boolean;
  payeeEntry: Address;
  payee: leash.Payee | null;
};

const bytes = (value: ReadonlyUint8Array) => new Uint8Array(value);
const sameBytes = (a: ReadonlyUint8Array, b: ReadonlyUint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

function decodeAccount<T>(
  account: MaybeEncodedAccount | undefined,
  discriminator: ReadonlyUint8Array,
  decode: (data: ReadonlyUint8Array) => T,
): T | null {
  if (!account?.exists || account.programAddress !== LEASH_PROGRAM_ADDRESS) return null;
  return sameBytes(account.data.subarray(0, discriminator.length), discriminator)
    ? decode(account.data)
    : null;
}

function eventOf<T extends LeashEvent["type"]>(
  events: readonly LeashEvent[],
  type: T,
): LeashEventOf<T> | undefined {
  return events.find((event): event is LeashEventOf<T> => event.type === type);
}

/** The name of a transaction error in the RPC's JSON shape, e.g. `InsufficientFundsForFee`. */
function transactionErrorName(error: unknown): string {
  return typeof error === "string" ? error : (Object.keys(error as object)[0] ?? "Unknown");
}

/** The Leash error the program raises for an evaluation error; every one is a Leash error. */
export function evaluationFailure(error: EvaluationError): LeashFailure {
  const failure = leashFailureFromCode(6000 + (LEASH_ERRORS as readonly string[]).indexOf(error));
  if (failure === null) throw new Error(`unknown evaluation error ${error}`);
  return failure;
}

/** Kit error codes of the transaction and instruction error domains. */
const isTransactionDomainCode = (code: number) =>
  (code >= 7_050_000 && code < 7_051_000) || (code >= 4_615_000 && code < 4_616_000);

/**
 * The agent runtime's client. Payments from one `LeashAgent` run one at a time, so our own
 * concurrency never races the rate limit or the allowance.
 */
export class LeashAgent {
  readonly #chain: LeashChain;
  readonly #signer: TransactionSigner;
  readonly #owner: Address;
  readonly #delegation: Address | undefined;
  readonly #priorityFee: bigint;
  readonly #logger: NonNullable<LeashAgentOptions["logger"]>;
  #accounts: AgentAccounts | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  /** Chain time of the last report per non-strike reason (ADR 20260929-ws0-denial-reporting-policy). */
  readonly #lastReported = new Map<DenialReason, bigint>();

  constructor(options: LeashAgentOptions) {
    const fee = options.priorityFeeMicroLamports ?? DEFAULT_PRIORITY_FEE_MICROLAMPORTS;
    if (fee < 0n || fee > 50_000n) throw new RangeError("priority fee must be in 0..=50000");
    this.#chain = options.chain;
    this.#signer = options.signer;
    this.#owner = options.owner;
    this.#delegation = options.delegation;
    this.#priorityFee = fee;
    this.#logger = options.logger ?? console;
  }

  /** The agent key's address. */
  get address(): Address {
    return this.#signer.address;
  }

  /** The Agent PDA (also the delegatee of the allowance). */
  async agentAddress(): Promise<Address> {
    return findAgentPda(await findPrincipalPda(this.#owner), this.#signer.address);
  }

  /** Principal, agent (with the allowance at the cluster's time) and allowlist. */
  async status(): Promise<AgentStatusSnapshot> {
    const status = await readAgentStatus(this.#chain, await this.agentAddress(), {
      ...(this.#delegation ? { delegation: this.#delegation } : {}),
    });
    if (status === null) throw new NotPairedError();
    return status;
  }

  /**
   * Predicts what `pay` would do right now, from fresh chain state, without sending anything.
   * An approved request for the same payee and amount is taken into account, as `pay` does.
   */
  async simulatePay(args: PaymentArgs): Promise<EvaluationResult> {
    const state = await this.#readState(args.to as Address);
    const request = await this.#findApprovedRequest(state, args.to, args.amount);
    const reference = request
      ? bytes(request.account.reference)
      : (args.reference ?? randomReference());
    if (state.delegation === null) {
      return { outcome: "denied", reason: "allowanceExpired", strike: false };
    }
    return evaluatePayment(
      this.#evaluationInput(state, state.delegation, request, { ...args, reference }),
    );
  }

  /**
   * Pays `amount` to `to` through the Leash program (ADR-0002): evaluate locally, simulate,
   * then send and confirm. A denied payment is reported on-chain per the reporting policy and
   * thrown as `PaymentDeniedError`. An approved request for the same payee and amount is used
   * (and consumed) when one exists.
   */
  pay(args: PaymentArgs): Promise<PaymentResult> {
    return this.#serialize(() => this.#pay(args));
  }

  /**
   * Asks the owner to approve a payment above the instant limit (`request_payment`). Denials are
   * reported like `pay` reports them (ADR 20260930-ws7-approval-request-errors).
   */
  requestApproval(args: PaymentArgs): Promise<PendingRequest> {
    return this.#serialize(() => this.#requestApproval(args));
  }

  /**
   * The `pay` instruction alone, for transactions someone else composes (x402, 02 §9: the
   * facilitator pays the fee). An approved request with this payee, amount and reference is
   * attached when one exists.
   */
  async buildPayInstruction(args: Required<PaymentArgs>): Promise<Instruction> {
    const state = await this.#readState(args.to as Address);
    const request = await this.#findApprovedRequest(state, args.to, args.amount, args.reference);
    return this.#payInstruction(state, {
      amount: args.amount,
      memo: encodeMemo(args.purpose),
      reference: request ? bytes(request.account.reference) : args.reference,
      request,
    });
  }

  /**
   * Records a denied payment on-chain (`report_denied_attempt`). The program re-evaluates it and
   * refuses with `AttemptWouldSucceed` when the payment would go through.
   */
  reportDenied(args: Required<PaymentArgs>): Promise<ReportResult> {
    return this.#serialize(async () => {
      const state = await this.#readState(args.to as Address);
      return this.#report(state, {
        to: args.to,
        amount: args.amount,
        memo: encodeMemo(args.purpose),
        reference: args.reference,
      });
    });
  }

  // ------------------------------------------------------------------------------ internals

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #pay(args: PaymentArgs): Promise<PaymentResult> {
    const memo = encodeMemo(args.purpose);
    const to = args.to as Address;
    const attempted = { to: args.to, amount: args.amount };
    const state = await this.#readState(to);
    const request = await this.#findApprovedRequest(state, to, args.amount);
    const reference = request
      ? bytes(request.account.reference)
      : (args.reference ?? randomReference());

    if (args.reference !== undefined) {
      const earlier = await this.#findExecutedPayment(state, reference);
      if (earlier) return earlier;
    }

    // A revoked allowance leaves no delegation to pay from: the owner ended it.
    if (state.delegation === null) {
      throw new PaymentDeniedError({ reason: "allowanceExpired", recorded: false, attempted });
    }
    const local = evaluatePayment(
      this.#evaluationInput(state, state.delegation, request, { ...args, reference }),
    );

    const instructions: Instruction[] = [];
    if (!state.destinationExists) {
      // `pay` and `report_denied_attempt` both need the payee's token account. The agent creates
      // it only for a payment the policy allows; a denied one cannot be recorded (no account).
      if (local.outcome !== "allowed") {
        this.#logger.warn(
          "leash: denied payment to a wallet without a token account; not recorded",
          {
            outcome: local.outcome,
          },
        );
        if (local.outcome === "denied") {
          throw new PaymentDeniedError({ reason: local.reason, recorded: false, attempted });
        }
        throw toSdkError(evaluationFailure(local.error), attempted);
      }
      instructions.push(
        getCreateAssociatedTokenIdempotentInstruction({
          payer: this.#signer,
          owner: to,
          mint: state.accounts.mint,
          ata: state.destination,
          tokenProgram: state.accounts.tokenProgram,
        }),
      );
    }
    instructions.push(
      await this.#payInstruction(state, { amount: args.amount, memo, reference, request }),
    );

    const simulation = await this.#simulate(instructions);
    if (simulation.failure !== null) {
      const { failure } = simulation;
      if (failure.denial !== null) {
        if (local.outcome !== "denied" || local.reason !== failure.denial) {
          this.#parityMismatch(local, failure);
        }
        return this.#denied(state, failure.denial, { to, amount: args.amount, memo, reference });
      }
      throw toSdkError(failure, attempted);
    }
    if (local.outcome !== "allowed") this.#parityMismatch(local, "allowed");

    let record: TransactionRecord;
    try {
      record = await this.#send(instructions, simulation.unitsConsumed);
    } catch (error) {
      const failure = findLeashFailure(error, { instructions: this.#withBudget(instructions, 0) });
      // The state moved between simulation and send (e.g. a concurrent payment of the owner).
      if (failure?.denial) {
        return this.#denied(state, failure.denial, { to, amount: args.amount, memo, reference });
      }
      throw this.#classify(error, failure, attempted);
    }
    const executed = eventOf(decodeLeashEvents(record), "PaymentExecuted");
    if (!executed) throw new Error(`payment ${record.signature} confirmed without PaymentExecuted`);
    return this.#result(record.signature, executed, state);
  }

  async #requestApproval(args: PaymentArgs): Promise<PendingRequest> {
    const memo = encodeMemo(args.purpose);
    const to = args.to as Address;
    const attempted = { to: args.to, amount: args.amount };
    const state = await this.#readState(to);
    const reference = args.reference ?? randomReference();
    const request = await findRequestPda(state.accounts.agent, state.agent.stats.requestNonce);
    const instruction = leash.getRequestPaymentInstruction({
      agentKey: this.#signer,
      rentPayer: this.#signer,
      principal: state.accounts.principal,
      agent: state.accounts.agent,
      ...(state.payee ? { payeeEntry: state.payeeEntry } : {}),
      request,
      payee: to,
      amount: args.amount,
      reference,
      memo,
      eventAuthority: await findLeashEventAuthorityPda(),
      program: LEASH_PROGRAM_ADDRESS,
    });

    const simulation = await this.#simulate([instruction]);
    const refused = (failure: LeashFailure): Promise<never> => {
      // `ApprovalsDisabled` is what `pay` reports as `exceedsPaymentLimit` for this amount.
      if (failure.denial !== null || failure.name === "ApprovalsDisabled") {
        const reason = failure.denial ?? "exceedsPaymentLimit";
        return this.#denied(state, reason, { to, amount: args.amount, memo, reference });
      }
      throw toSdkError(failure, attempted);
    };
    if (simulation.failure !== null) return refused(simulation.failure);
    let record: TransactionRecord;
    try {
      record = await this.#send([instruction], simulation.unitsConsumed);
    } catch (error) {
      const failure = findLeashFailure(error, { instructions: this.#withBudget([instruction], 0) });
      if (failure) return refused(failure);
      throw this.#classify(error, null, attempted);
    }
    const requested = eventOf(decodeLeashEvents(record), "PaymentRequested");
    if (!requested)
      throw new Error(`request ${record.signature} confirmed without PaymentRequested`);
    return {
      address: requested.request,
      nonce: BigInt(requested.nonce),
      expiresAt: requested.expiresAt,
    };
  }

  /** Reports a denial per the reporting policy, then throws the `PaymentDeniedError`. */
  async #denied(
    state: PaymentState,
    reason: DenialReason,
    payment: ReportedPayment,
  ): Promise<never> {
    const attempted = { to: payment.to, amount: payment.amount };
    const info = denialInfo(reason);
    const last = this.#lastReported.get(reason);
    const coolingDown =
      !info.strike &&
      last !== undefined &&
      state.now < last + BigInt(NON_STRIKE_REPORT_COOLDOWN_SECS);
    if (reason === "approvalRequired" || coolingDown) {
      throw new PaymentDeniedError({ reason, recorded: false, attempted });
    }
    let report: ReportResult;
    try {
      report = await this.#report(state, payment);
    } catch (error) {
      this.#logger.warn("leash: could not record a denied payment", {
        reason,
        error: error instanceof Error ? error.name : String(error),
      });
      throw new PaymentDeniedError({ reason, recorded: false, attempted });
    }
    if (!report.strike) this.#lastReported.set(report.reason, state.now);
    throw new PaymentDeniedError({
      reason: report.reason,
      recorded: true,
      attempted,
      strikes: report.strikes,
      frozen: report.frozen,
    });
  }

  async #report(state: PaymentState, payment: ReportedPayment): Promise<ReportResult> {
    const { amount, memo, reference } = payment;
    if (!state.destinationExists) {
      throw new TransactionFailedError("the payee has no token account for this mint");
    }
    const instruction = leash.getReportDeniedAttemptInstruction({
      agentKey: this.#signer,
      principal: state.accounts.principal,
      agent: state.accounts.agent,
      ...(state.payee ? { payeeEntry: state.payeeEntry } : {}),
      delegation: state.accounts.delegation,
      sourceTokenAccount: state.accounts.source,
      destinationTokenAccount: state.destination,
      mint: state.accounts.mint,
      args: { amount, reference, memo },
      eventAuthority: await findLeashEventAuthorityPda(),
      program: LEASH_PROGRAM_ADDRESS,
    });
    const simulation = await this.#simulate([instruction]);
    if (simulation.failure !== null) {
      throw toSdkError(simulation.failure, { to: payment.to, amount });
    }
    const record = await this.#send([instruction], simulation.unitsConsumed);
    const events = decodeLeashEvents(record);
    const denied = eventOf(events, "PaymentDenied");
    if (!denied) throw new Error(`report ${record.signature} confirmed without PaymentDenied`);
    return {
      signature: record.signature,
      reason: denied.reason,
      strike: denied.strike,
      strikes: denied.strikes,
      frozen: denied.tripped,
    };
  }

  /** The accounts that never change for this agent, read once. */
  async #agentAccounts(): Promise<AgentAccounts> {
    if (this.#accounts) return this.#accounts;
    const principal = await findPrincipalPda(this.#owner);
    const agent = await findAgentPda(principal, this.#signer.address);
    const [agentAccount] = await this.#chain.getAccounts([agent]);
    const decoded = decodeAccount(agentAccount, leash.AGENT_DISCRIMINATOR, (data) =>
      leash.getAgentDecoder().decode(data),
    );
    if (decoded === null) throw new NotPairedError();
    const [mintAccount] = await this.#chain.getAccounts([decoded.mint]);
    if (!mintAccount?.exists) throw new Error(`the agent's mint ${decoded.mint} does not exist`);
    const tokenProgram = mintAccount.programAddress;
    const subscriptionAuthority = await findSubscriptionAuthorityPda(this.#owner, decoded.mint);
    const [source] = await findAssociatedTokenPda({
      owner: this.#owner,
      mint: decoded.mint,
      tokenProgram,
    });
    this.#accounts = {
      principal,
      agent,
      mint: decoded.mint,
      tokenProgram,
      subscriptionAuthority,
      delegation:
        this.#delegation ??
        (await findDelegationPda({ subscriptionAuthority, owner: this.#owner, agent })),
      source,
    };
    return this.#accounts;
  }

  async #readState(to: Address): Promise<PaymentState> {
    const accounts = await this.#agentAccounts();
    const [destination] = await findAssociatedTokenPda({
      owner: to,
      mint: accounts.mint,
      tokenProgram: accounts.tokenProgram,
    });
    const payeeEntry = await findPayeePda(accounts.agent, to);
    const [clock, principal, agent, delegation, source, destinationAccount, entry, key] =
      await this.#chain.getAccounts([
        SYSVAR_CLOCK_ADDRESS,
        accounts.principal,
        accounts.agent,
        accounts.delegation,
        accounts.source,
        destination,
        payeeEntry,
        this.#signer.address,
      ]);
    const decodedPrincipal = decodeAccount(principal, leash.PRINCIPAL_DISCRIMINATOR, (data) =>
      leash.getPrincipalDecoder().decode(data),
    );
    const decodedAgent = decodeAccount(agent, leash.AGENT_DISCRIMINATOR, (data) =>
      leash.getAgentDecoder().decode(data),
    );
    if (decodedPrincipal === null || decodedAgent === null) {
      this.#accounts = undefined;
      throw new NotPairedError();
    }
    if (key?.exists && key.lamports < LOW_AGENT_BALANCE_LAMPORTS) {
      this.#logger.warn("leash: the agent key is low on SOL; it pays for its own reports", {
        lamports: key.lamports.toString(),
      });
    }
    return {
      accounts,
      now: clockUnixTimestamp(clock),
      principal: decodedPrincipal,
      agent: decodedAgent,
      delegation: this.#decodeDelegation(delegation, accounts, decodedAgent),
      sourceAmount: source?.exists ? getTokenDecoder().decode(source.data).amount : 0n,
      destination,
      destinationExists: destinationAccount?.exists === true,
      payeeEntry,
      payee: decodeAccount(entry, leash.PAYEE_DISCRIMINATOR, (data) =>
        leash.getPayeeDecoder().decode(data),
      ),
    };
  }

  #decodeDelegation(
    account: MaybeEncodedAccount | undefined,
    accounts: AgentAccounts,
    agent: leash.Agent,
  ): DecodedDelegation | null {
    if (!account?.exists || account.programAddress !== SUBSCRIPTIONS_PROGRAM_ADDRESS) return null;
    try {
      const decoded = decodeDelegation(account.address, bytes(account.data));
      const ours =
        decoded.delegator === this.#owner &&
        decoded.delegatee === accounts.agent &&
        decoded.mint === agent.mint;
      return ours ? decoded : null;
    } catch {
      return null;
    }
  }

  /** An approved, unexpired request for this payee and amount (and reference, if given). */
  async #findApprovedRequest(
    state: PaymentState,
    to: string,
    amount: bigint,
    reference?: Uint8Array,
  ): Promise<OpenRequest | null> {
    if (state.agent.openRequests === 0) return null;
    const accounts = await this.#chain.getProgramAccounts(LEASH_PROGRAM_ADDRESS, [
      { memcmp: { offset: 0, bytes: leash.PAYMENT_REQUEST_DISCRIMINATOR } },
      { memcmp: { offset: 10, bytes: getAddressEncoder().encode(state.accounts.agent) } },
    ]);
    const usable = accounts
      .map((account) => ({
        address: account.address,
        account: leash.getPaymentRequestDecoder().decode(account.data),
      }))
      .filter(
        ({ account }) =>
          REQUEST_STATUS_FROM_CHAIN[account.status] === "approved" &&
          account.payee === to &&
          account.amount === amount &&
          state.now < account.expiresAt &&
          (reference === undefined || sameBytes(account.reference, reference)),
      )
      .sort((a, b) => Number(a.account.nonce - b.account.nonce));
    return usable[0] ?? null;
  }

  async #findExecutedPayment(
    state: PaymentState,
    reference: Uint8Array,
  ): Promise<PaymentResult | null> {
    const hex = referenceToHex(reference);
    const records = await this.#chain.getRecentTransactions(
      state.accounts.agent,
      IDEMPOTENCY_LOOKBACK,
    );
    for (const record of records) {
      const executed = decodeLeashEvents(record).find(
        (event): event is LeashEventOf<"PaymentExecuted"> =>
          event.type === "PaymentExecuted" &&
          event.agent === state.accounts.agent &&
          event.reference === hex,
      );
      if (executed) return this.#result(record.signature, executed, state);
    }
    return null;
  }

  #evaluationInput(
    state: PaymentState,
    delegation: DecodedDelegation,
    request: OpenRequest | null,
    payment: { amount: bigint; to: string; reference: Uint8Array },
  ): EvaluationInput {
    const { agent, payee } = state;
    return {
      now: state.now,
      principalFrozen: state.principal.frozen,
      agent: {
        address: state.accounts.agent,
        status: AGENT_STATUS_FROM_CHAIN[agent.status],
        policy: policyToState(agent.policy),
        velocityWindowStart: agent.stats.velocityWindowStart,
        velocityCount: agent.stats.velocityCount,
      },
      payeeEntry: payee && {
        agent: payee.agent,
        payee: payee.payee,
        maxPerPayment: payee.maxPerPayment,
        periodLimit: payee.periodLimit,
        periodSecs: payee.periodSecs,
        periodStart: payee.periodStart,
        spentInPeriod: payee.spentInPeriod,
      },
      request: request && {
        agent: request.account.agent,
        status: REQUEST_STATUS_FROM_CHAIN[request.account.status],
        payee: request.account.payee,
        amount: request.account.amount,
        reference: bytes(request.account.reference),
        expiresAt: request.account.expiresAt,
      },
      delegation: delegation.state,
      sourceAmount: state.sourceAmount,
      payment: {
        amount: payment.amount,
        destinationOwner: payment.to,
        reference: payment.reference,
      },
    };
  }

  async #payInstruction(
    state: PaymentState,
    args: { amount: bigint; memo: Uint8Array; reference: Uint8Array; request: OpenRequest | null },
  ): Promise<Instruction> {
    const { accounts } = state;
    return leash.getPayInstruction({
      agentKey: this.#signer,
      principal: accounts.principal,
      agent: accounts.agent,
      ...(state.payee ? { payeeEntry: state.payeeEntry } : {}),
      ...(args.request
        ? { request: args.request.address, requestRentReceiver: args.request.account.rentPayer }
        : {}),
      delegation: accounts.delegation,
      subscriptionAuthority: accounts.subscriptionAuthority,
      sourceTokenAccount: accounts.source,
      destinationTokenAccount: state.destination,
      mint: accounts.mint,
      tokenProgram: accounts.tokenProgram,
      subscriptionsProgram: SUBSCRIPTIONS_PROGRAM_ADDRESS,
      subscriptionsEventAuthority: await findSubscriptionsEventAuthorityPda(),
      eventAuthority: await findLeashEventAuthorityPda(),
      program: LEASH_PROGRAM_ADDRESS,
      args: { amount: args.amount, reference: args.reference, memo: args.memo },
    });
  }

  #withBudget(instructions: readonly Instruction[], units: number): Instruction[] {
    return [
      getSetComputeUnitLimitInstruction({ units }),
      getSetComputeUnitPriceInstruction({ microLamports: this.#priorityFee }),
      ...instructions,
    ];
  }

  async #transaction(instructions: readonly Instruction[], units: number) {
    const all = this.#withBudget(instructions, units);
    const message = buildTransactionMessage({
      feePayer: this.#signer,
      instructions: all,
      lifetime: await this.#chain.getLatestBlockhash(),
    });
    return { message, transaction: await signTransactionMessageWithSigners(message) };
  }

  /** Simulates with the maximum compute budget. `failure` is the Leash error, if any. */
  async #simulate(
    instructions: readonly Instruction[],
  ): Promise<{ failure: LeashFailure | null; unitsConsumed: bigint }> {
    const { message, transaction } = await this.#transaction(instructions, MAX_COMPUTE_UNITS);
    const result = await this.#chain.simulate(transaction);
    if (result.err === null || result.err === undefined) {
      return { failure: null, unitsConsumed: result.unitsConsumed };
    }
    const failure = findLeashFailure(result.err, message);
    if (failure === null) throw new TransactionFailedError(transactionErrorName(result.err));
    return { failure, unitsConsumed: result.unitsConsumed };
  }

  async #send(
    instructions: readonly Instruction[],
    unitsConsumed: bigint,
  ): Promise<TransactionRecord> {
    const units = Math.min(MAX_COMPUTE_UNITS, Math.ceil(Number(unitsConsumed) * 1.15));
    const { transaction } = await this.#transaction(instructions, units);
    return this.#chain.sendAndConfirm(transaction);
  }

  /** A failed send that is not a denial: a Leash error, a transaction error, or the network. */
  #classify(
    error: unknown,
    failure: LeashFailure | null,
    attempted: { to: string; amount: bigint },
  ) {
    if (failure) return toSdkError(failure, attempted);
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      if (isSolanaError(cause) && isTransactionDomainCode(cause.context.__code)) {
        return new TransactionFailedError(cause.message);
      }
    }
    return new LeashNetworkError(
      isSolanaError(error) ? `Solana error ${error.context.__code}` : "the RPC request failed",
    );
  }

  #parityMismatch(local: EvaluationResult, onChain: LeashFailure | "allowed") {
    this.#logger.warn("leash: PARITY MISMATCH between the SDK evaluator and the program", {
      local,
      onChain: onChain === "allowed" ? "allowed" : onChain.name,
    });
  }

  #result(
    signature: string,
    executed: LeashEventOf<"PaymentExecuted">,
    state: PaymentState,
  ): PaymentResult {
    return {
      signature,
      amount: BigInt(executed.amount),
      payee: executed.payee,
      payeeLabel:
        state.payee && state.payee.payee === executed.payee
          ? decodeLabel(bytes(state.payee.label))
          : null,
      purpose: executed.memo,
      requestNonce: executed.requestNonce === null ? null : BigInt(executed.requestNonce),
      reference: executed.reference,
      destination: executed.destination,
    };
  }
}
