import { fileURLToPath } from "node:url";
import {
  type Address,
  createKeyPairSignerFromPrivateKeyBytes,
  type Instruction,
  type KeyPairSigner,
  lamports,
  type TransactionSigner,
} from "@solana/kit";
import {
  AccountState,
  findAssociatedTokenPda,
  getMintEncoder,
  getTokenDecoder,
  getTokenEncoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { LiteSVM } from "litesvm";
import type { PolicyState } from "../evaluate/types.ts";
import type { TransactionRecord } from "../events.ts";
import {
  type AllowanceInput,
  buildOnboarding,
  type OnboardingPlan,
  type PayeeLimitsInput,
} from "../owner.ts";
import { findPayeePda, LEASH_PROGRAM_ADDRESS, SUBSCRIPTIONS_PROGRAM_ADDRESS } from "../pda.ts";
import { sendInstructions, sendPlan } from "../transactions.ts";
import { type LiteSvmChain, litesvmChain } from "./litesvm-chain.ts";
import { testKeySeed } from "./test-keys.ts";

// `createTestbed()`: one owner with one agent on an in-process LiteSVM that runs the committed
// binaries (artifacts/programs/leash.so and the audited subscriptions.so). It mirrors the
// program's own LiteSVM harness (programs/leash/tests/common/mod.rs), and it is built with the
// SDK's own onboarding, so every test that uses it also tests `buildOnboarding`.

/** 2026-10-02 10:00 UTC, the "now" of the policy vectors and the Rust harness. */
export const TESTBED_NOW = 1_790_935_200n;
/** One USDC in base units. */
export const USDC = 1_000_000n;
const SOL = 1_000_000_000n;

/** The demo policy (02-contracts §11, `research-assistant`). */
export const DEMO_POLICY: PolicyState = {
  maxPerPayment: USDC,
  maxPerRequest: 5n * USDC,
  payeeMode: "allowListOnly",
  velocityMaxPayments: 30,
  velocityWindowSecs: 60,
  tripwireMaxStrikes: 3,
  tripwireWindowSecs: 600,
  requestTtlSecs: 3_600,
  validUntil: 0n,
};

/** The merchant's limits in the demo preset: 2 USDC per payment, 3 USDC a day. */
export const DEMO_MERCHANT_LIMITS: PayeeLimitsInput = {
  maxPerPayment: 2n * USDC,
  periodLimit: 3n * USDC,
  periodSecs: 86_400,
};

export type TestbedOptions = {
  policy?: PolicyState;
  /** Give the principal a guardian. Default true. */
  guardian?: boolean;
  /** The merchant's allowlist entry; null leaves the merchant off the allowlist. */
  merchant?: PayeeLimitsInput | null;
  /** Default: 5 USDC a day, starting now, never expiring. */
  allowance?: AllowanceInput;
  /** The owner's USDC balance. Default 100 USDC. */
  ownerUsdc?: bigint;
  /** The cluster time at setup. Default `TESTBED_NOW`. */
  now?: bigint;
};

export type TestbedKeys = {
  owner: KeyPairSigner;
  agentKey: KeyPairSigner;
  guardian: KeyPairSigner;
  stranger: KeyPairSigner;
  merchant: KeyPairSigner;
  attacker: KeyPairSigner;
};

export type Testbed = {
  svm: LiteSVM;
  chain: LiteSvmChain;
  /** Deterministic test keys (seed = sha256("leash:test-key:" + name)), all funded with SOL except merchant and attacker. */
  keys: TestbedKeys;
  /** A USDC-like SPL Token mint (6 decimals). */
  mint: Address;
  tokenProgram: Address;
  onboarding: OnboardingPlan;
  accounts: {
    principal: Address;
    agent: Address;
    subscriptionAuthority: Address;
    delegation: Address;
    merchantEntry: Address;
    ownerTokenAccount: Address;
    merchantTokenAccount: Address;
    attackerTokenAccount: Address;
  };
  /** The cluster's Unix time. */
  now(): bigint;
  setTime(unixTimestamp: bigint): void;
  advance(seconds: bigint): void;
  /** The token balance of `owner`'s associated account for the mint (0 if it does not exist). */
  balanceOf(owner: Address): Promise<bigint>;
  /** Creates or overwrites `owner`'s associated token account with `amount`; returns its address. */
  setBalance(owner: Address, amount: bigint): Promise<Address>;
  /** Signs with the fee payer and every signer the instructions name, sends, confirms. */
  send(
    feePayer: TransactionSigner,
    instructions: readonly Instruction[],
  ): Promise<TransactionRecord>;
};

const artifact = (name: string) =>
  fileURLToPath(new URL(`../../../../artifacts/programs/${name}`, import.meta.url));

/** A funded owner, a paired agent with an allowance, and an allowlisted merchant. */
export async function createTestbed(options: TestbedOptions = {}): Promise<Testbed> {
  // No transaction history: the same admin instruction may be sent twice in a test, and LiteSVM
  // keeps one blockhash (see litesvm-chain.ts).
  const svm = new LiteSVM().withTransactionHistory(0n);
  svm.addProgramFromFile(LEASH_PROGRAM_ADDRESS, artifact("leash.so"));
  svm.addProgramFromFile(SUBSCRIPTIONS_PROGRAM_ADDRESS, artifact("subscriptions.so"));
  const chain = litesvmChain(svm);

  const setTime = (unixTimestamp: bigint) => {
    const clock = svm.getClock();
    clock.unixTimestamp = unixTimestamp;
    svm.setClock(clock);
  };
  setTime(options.now ?? TESTBED_NOW);

  const signer = async (name: string) =>
    createKeyPairSignerFromPrivateKeyBytes(await testKeySeed(name));
  const keys: TestbedKeys = {
    owner: await signer("owner"),
    agentKey: await signer("agentKey"),
    guardian: await signer("guardian"),
    stranger: await signer("stranger"),
    merchant: await signer("merchant"),
    attacker: await signer("attacker"),
  };
  for (const key of [keys.owner, keys.agentKey, keys.guardian, keys.stranger]) {
    svm.airdrop(key.address, lamports(100n * SOL));
  }

  const mint = (await signer("usdcMint")).address;
  const tokenProgram = TOKEN_PROGRAM_ADDRESS;
  const ownerUsdc = options.ownerUsdc ?? 100n * USDC;
  const put = (address: Address, programAddress: Address, data: Uint8Array) =>
    svm.setAccount({
      address,
      data,
      executable: false,
      lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress,
      space: BigInt(data.length),
    });
  put(
    mint,
    tokenProgram,
    new Uint8Array(
      getMintEncoder().encode({
        mintAuthority: keys.owner.address,
        supply: ownerUsdc,
        decimals: 6,
        isInitialized: true,
        freezeAuthority: null,
      }),
    ),
  );

  const tokenAccountOf = async (owner: Address) =>
    (await findAssociatedTokenPda({ owner, mint, tokenProgram }))[0];
  const setBalance = async (owner: Address, amount: bigint) => {
    const address = await tokenAccountOf(owner);
    const existing = svm.getAccount(address);
    const current = existing.exists ? getTokenDecoder().decode(existing.data) : null;
    put(
      address,
      tokenProgram,
      new Uint8Array(
        getTokenEncoder().encode({
          mint,
          owner,
          amount,
          // Keep the Subscription Authority's approval when overwriting the owner's account.
          delegate: current?.delegate ?? null,
          state: AccountState.Initialized,
          isNative: null,
          delegatedAmount: current?.delegatedAmount ?? 0n,
          closeAuthority: null,
        }),
      ),
    );
    return address;
  };
  const balanceOf = async (owner: Address) => {
    const account = svm.getAccount(await tokenAccountOf(owner));
    return account.exists ? getTokenDecoder().decode(account.data).amount : 0n;
  };

  const ownerTokenAccount = await setBalance(keys.owner.address, ownerUsdc);
  const merchantTokenAccount = await setBalance(keys.merchant.address, 0n);
  const attackerTokenAccount = await setBalance(keys.attacker.address, 0n);

  const merchantLimits = options.merchant === undefined ? DEMO_MERCHANT_LIMITS : options.merchant;
  const onboarding = await buildOnboarding(chain, {
    owner: keys.owner,
    agentKey: keys.agentKey.address,
    mint,
    label: "Research agent",
    policy: options.policy ?? DEMO_POLICY,
    allowance: options.allowance ?? {
      kind: "recurring",
      amountPerPeriod: 5n * USDC,
      periodLengthSecs: 86_400n,
    },
    payees:
      merchantLimits === null
        ? []
        : [{ payee: keys.merchant.address, label: "Research API", limits: merchantLimits }],
    guardian: options.guardian === false ? null : keys.guardian.address,
  });
  await sendPlan(chain, { feePayer: keys.owner, transactions: onboarding.transactions });

  return {
    svm,
    chain,
    keys,
    mint,
    tokenProgram,
    onboarding,
    accounts: {
      principal: onboarding.principal,
      agent: onboarding.agent,
      subscriptionAuthority: onboarding.subscriptionAuthority,
      delegation: onboarding.delegation,
      merchantEntry: await findPayeePda(onboarding.agent, keys.merchant.address),
      ownerTokenAccount,
      merchantTokenAccount,
      attackerTokenAccount,
    },
    now: () => svm.getClock().unixTimestamp,
    setTime,
    advance: (seconds) => setTime(svm.getClock().unixTimestamp + seconds),
    balanceOf,
    setBalance,
    send: (feePayer, instructions) => sendInstructions(chain, { feePayer, instructions }),
  };
}
