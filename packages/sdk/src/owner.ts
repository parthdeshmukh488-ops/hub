import { encodeLabel } from "@leash/contracts";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { LeashChain } from "./chain.ts";
import { readChainTime } from "./chain.ts";
import { policyToChain } from "./convert.ts";
import type { PolicyState } from "./evaluate/types.ts";
import * as leash from "./generated/leash/index.ts";
import * as subscriptions from "./generated/subscriptions/index.ts";
import {
  findAgentPda,
  findDelegationPda,
  findLeashEventAuthorityPda,
  findPayeePda,
  findPrincipalPda,
  findSubscriptionAuthorityPda,
  LEASH_PROGRAM_ADDRESS,
} from "./pda.ts";
import { type PlannedTransaction, packTransactions } from "./transactions.ts";

// Instruction builders for everything the owner (or the guardian) signs: onboarding and the admin
// instructions of 01-onchain-program §6. They build instructions only; the caller signs and sends
// them (a wallet, or `sendInstructions` / `sendPlan`).

/** Per-payee limits; 0 turns a limit off (01-onchain-program §4.6). */
export type PayeeLimitsInput = { maxPerPayment: bigint; periodLimit: bigint; periodSecs: number };

/** The allowance the owner grants through Subscriptions (the hard ceiling, I1). */
export type AllowanceInput =
  | {
      kind: "recurring";
      amountPerPeriod: bigint;
      periodLengthSecs: bigint;
      /** Default: the cluster's current time. */
      startTs?: bigint;
      /** 0n or absent = never. */
      expiryTs?: bigint;
    }
  | { kind: "fixed"; amount: bigint; expiryTs?: bigint };

export type PayeeInput = { payee: Address; label: string; limits: PayeeLimitsInput };

/**
 * Subscriptions' sentinel for "the Subscription Authority is created in this same slot", used
 * when authority and delegation are created in one transaction (`UNKNOWN_INIT_ID` upstream).
 */
export const UNKNOWN_SUBSCRIPTION_AUTHORITY_INIT_ID = -9_223_372_036_854_775_808n;

/** SPL Token and Token-2022. */
const TOKEN_PROGRAMS: readonly Address[] = [
  TOKEN_PROGRAM_ADDRESS,
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address,
];

const leashAccounts = async () => ({
  eventAuthority: await findLeashEventAuthorityPda(),
  program: LEASH_PROGRAM_ADDRESS,
});

// ------------------------------------------------------------------------------------ onboarding

export type OnboardingInput = {
  owner: TransactionSigner;
  agentKey: Address;
  mint: Address;
  /** At most 32 bytes of UTF-8. */
  label: string;
  policy: PolicyState;
  allowance: AllowanceInput;
  payees?: readonly PayeeInput[];
  /** Only used when the principal is created; change it later with `buildSetGuardian`. */
  guardian?: Address | null;
};

export type OnboardingPlan = {
  principal: Address;
  agent: Address;
  subscriptionAuthority: Address;
  delegation: Address;
  /** Send in order. Empty when everything already exists. */
  transactions: PlannedTransaction[];
};

/**
 * Everything an owner signs to put an agent on a leash: the principal, the agent, the Subscriptions
 * authority and a delegation whose delegatee is the Agent PDA (nonce 0), and the allowlist.
 * Skips what already exists, so it can resume a half-finished onboarding. The authority and the
 * delegation always share a transaction.
 */
export async function buildOnboarding(
  chain: LeashChain,
  input: OnboardingInput,
): Promise<OnboardingPlan> {
  const owner = input.owner.address;
  const principal = await findPrincipalPda(owner);
  const agent = await findAgentPda(principal, input.agentKey);
  const subscriptionAuthority = await findSubscriptionAuthorityPda(owner, input.mint);
  const delegation = await findDelegationPda({ subscriptionAuthority, owner, agent });
  const payees = input.payees ?? [];
  const payeeEntries = await Promise.all(payees.map((p) => findPayeePda(agent, p.payee)));

  const [mintAccount, principalAccount, agentAccount, ...entryAccounts] = await chain.getAccounts([
    input.mint,
    principal,
    agent,
    ...payeeEntries,
  ]);
  if (!mintAccount?.exists || !TOKEN_PROGRAMS.includes(mintAccount.programAddress)) {
    throw new Error(`${input.mint} is not a token mint`);
  }

  const groups: { purpose: string; instructions: Instruction[] }[] = [];
  if (!principalAccount?.exists) {
    groups.push({
      purpose: "create the principal",
      instructions: [
        leash.getInitializePrincipalInstruction({
          owner: input.owner,
          principal,
          guardian: input.guardian ?? null,
          ...(await leashAccounts()),
        }),
      ],
    });
  }
  if (!agentAccount?.exists) {
    groups.push({
      purpose: "create the agent",
      instructions: [
        leash.getCreateAgentInstruction({
          owner: input.owner,
          principal,
          agent,
          mint: input.mint,
          agentKey: input.agentKey,
          label: encodeLabel(input.label),
          policy: policyToChain(input.policy),
          ...(await leashAccounts()),
        }),
      ],
    });
  }
  const allowance = await buildAllowance(chain, {
    owner: input.owner,
    agent,
    mint: input.mint,
    tokenProgram: mintAccount.programAddress,
    allowance: input.allowance,
  });
  if (allowance.instructions.length > 0) {
    groups.push({ purpose: "grant the allowance", instructions: allowance.instructions });
  }
  for (const [i, payee] of payees.entries()) {
    if (entryAccounts[i]?.exists) continue;
    groups.push({
      purpose: `allowlist ${payee.label}`,
      instructions: [await buildAddPayee({ owner: input.owner, agent, ...payee })],
    });
  }
  return {
    principal,
    agent,
    subscriptionAuthority,
    delegation,
    transactions: packTransactions(input.owner, groups),
  };
}

/**
 * The instructions that give `agent` an allowance: the owner's token account and Subscription
 * Authority when missing, then the delegation (Recurring or Fixed) with the Agent PDA as the
 * delegatee. Nothing if a delegation with this nonce already exists.
 */
export async function buildAllowance(
  chain: LeashChain,
  input: {
    owner: TransactionSigner;
    agent: Address;
    mint: Address;
    allowance: AllowanceInput;
    /** Default 0; a new nonce after revoking an allowance is not needed (revoke closes it). */
    nonce?: bigint;
    /** Default: the mint account's owner. */
    tokenProgram?: Address;
  },
): Promise<{ delegation: Address; instructions: Instruction[] }> {
  const owner = input.owner.address;
  const subscriptionAuthority = await findSubscriptionAuthorityPda(owner, input.mint);
  const nonce = input.nonce ?? 0n;
  const delegation = await findDelegationPda({
    subscriptionAuthority,
    owner,
    agent: input.agent,
    nonce,
  });
  const [mintAccount, authorityAccount, delegationAccount] = await chain.getAccounts([
    input.mint,
    subscriptionAuthority,
    delegation,
  ]);
  if (delegationAccount?.exists) return { delegation, instructions: [] };
  const tokenProgram =
    input.tokenProgram ?? (mintAccount?.exists ? mintAccount.programAddress : undefined);
  if (tokenProgram === undefined || !TOKEN_PROGRAMS.includes(tokenProgram)) {
    throw new Error(`${input.mint} is not a token mint`);
  }

  const instructions: Instruction[] = [];
  let initId: bigint;
  if (authorityAccount?.exists) {
    initId = subscriptions.getSubscriptionAuthorityDecoder().decode(authorityAccount.data).initId;
  } else {
    const [ownerTokenAccount] = await findAssociatedTokenPda({
      owner,
      mint: input.mint,
      tokenProgram,
    });
    const [ownerTokenAccountInfo] = await chain.getAccounts([ownerTokenAccount]);
    if (!ownerTokenAccountInfo?.exists) {
      instructions.push(
        getCreateAssociatedTokenIdempotentInstruction({
          payer: input.owner,
          owner,
          mint: input.mint,
          ata: ownerTokenAccount,
          tokenProgram,
        }),
      );
    }
    instructions.push(
      subscriptions.getInitSubscriptionAuthorityInstruction({
        owner: input.owner,
        subscriptionAuthority,
        tokenMint: input.mint,
        userAta: ownerTokenAccount,
        tokenProgram,
      }),
    );
    initId = UNKNOWN_SUBSCRIPTION_AUTHORITY_INIT_ID;
  }

  const accounts = {
    delegator: input.owner,
    subscriptionAuthority,
    delegationAccount: delegation,
    delegatee: input.agent,
  };
  const { allowance } = input;
  if (allowance.kind === "recurring") {
    instructions.push(
      subscriptions.getCreateRecurringDelegationInstruction({
        ...accounts,
        recurringDelegation: {
          nonce,
          amountPerPeriod: allowance.amountPerPeriod,
          periodLengthS: allowance.periodLengthSecs,
          startTs: allowance.startTs ?? (await readChainTime(chain)),
          expiryTs: allowance.expiryTs ?? 0n,
          expectedSubscriptionAuthorityInitId: initId,
        },
      }),
    );
  } else {
    instructions.push(
      subscriptions.getCreateFixedDelegationInstruction({
        ...accounts,
        fixedDelegation: {
          nonce,
          amount: allowance.amount,
          expiryTs: allowance.expiryTs ?? 0n,
          expectedSubscriptionAuthorityInitId: initId,
        },
      }),
    );
  }
  return { delegation, instructions };
}

/** Revokes an allowance: Subscriptions closes the delegation and refunds its rent to the owner. */
export function buildRevokeAllowance(input: {
  owner: TransactionSigner;
  delegation: Address;
}): Instruction {
  return subscriptions.getRevokeDelegationInstruction({
    authority: input.owner,
    delegationAccount: input.delegation,
  });
}

// ------------------------------------------------------------------------------- admin (owner)

/** `set_guardian`: null removes the guardian. */
export async function buildSetGuardian(input: {
  owner: TransactionSigner;
  guardian: Address | null;
}): Promise<Instruction> {
  return leash.getSetGuardianInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    guardian: input.guardian,
    ...(await leashAccounts()),
  });
}

export async function buildUpdatePolicy(input: {
  owner: TransactionSigner;
  agent: Address;
  policy: PolicyState;
}): Promise<Instruction> {
  return leash.getUpdatePolicyInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    policy: policyToChain(input.policy),
    ...(await leashAccounts()),
  });
}

export async function buildAddPayee(input: {
  owner: TransactionSigner;
  agent: Address;
  payee: Address;
  label: string;
  limits: PayeeLimitsInput;
}): Promise<Instruction> {
  return leash.getAddPayeeInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    payeeEntry: await findPayeePda(input.agent, input.payee),
    payee: input.payee,
    label: encodeLabel(input.label),
    limits: input.limits,
    ...(await leashAccounts()),
  });
}

export async function buildUpdatePayee(input: {
  owner: TransactionSigner;
  agent: Address;
  payee: Address;
  label: string;
  limits: PayeeLimitsInput;
}): Promise<Instruction> {
  return leash.getUpdatePayeeInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    payeeEntry: await findPayeePda(input.agent, input.payee),
    label: encodeLabel(input.label),
    limits: input.limits,
    ...(await leashAccounts()),
  });
}

export async function buildRemovePayee(input: {
  owner: TransactionSigner;
  agent: Address;
  payee: Address;
}): Promise<Instruction> {
  return leash.getRemovePayeeInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    payeeEntry: await findPayeePda(input.agent, input.payee),
    ...(await leashAccounts()),
  });
}

/** `freeze_agent`, signed by the owner or the guardian (I3). */
export async function buildFreezeAgent(input: {
  authority: TransactionSigner;
  owner: Address;
  agent: Address;
}): Promise<Instruction> {
  return leash.getFreezeAgentInstruction({
    authority: input.authority,
    principal: await findPrincipalPda(input.owner),
    agent: input.agent,
    ...(await leashAccounts()),
  });
}

/** `unfreeze_agent`: only the owner (I3). Also resets the strikes. */
export async function buildUnfreezeAgent(input: {
  owner: TransactionSigner;
  agent: Address;
}): Promise<Instruction> {
  return leash.getUnfreezeAgentInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    ...(await leashAccounts()),
  });
}

/** `freeze_principal`: every agent of the owner at once, signed by the owner or the guardian. */
export async function buildFreezePrincipal(input: {
  authority: TransactionSigner;
  owner: Address;
}): Promise<Instruction> {
  return leash.getFreezePrincipalInstruction({
    authority: input.authority,
    principal: await findPrincipalPda(input.owner),
    ...(await leashAccounts()),
  });
}

export async function buildUnfreezePrincipal(input: {
  owner: TransactionSigner;
}): Promise<Instruction> {
  return leash.getUnfreezePrincipalInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    ...(await leashAccounts()),
  });
}

export async function buildApproveRequest(input: {
  owner: TransactionSigner;
  agent: Address;
  request: Address;
}): Promise<Instruction> {
  return leash.getApproveRequestInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    request: input.request,
    ...(await leashAccounts()),
  });
}

/** `reject_request`, signed by the owner or the guardian. The rent goes back to `rentReceiver` (the request's `rentPayer`). */
export async function buildRejectRequest(input: {
  authority: TransactionSigner;
  owner: Address;
  agent: Address;
  request: Address;
  rentReceiver: Address;
}): Promise<Instruction> {
  return leash.getRejectRequestInstruction({
    authority: input.authority,
    principal: await findPrincipalPda(input.owner),
    agent: input.agent,
    request: input.request,
    rentReceiver: input.rentReceiver,
    ...(await leashAccounts()),
  });
}

/** `expire_request`: anyone may close an expired request; the rent goes back to its payer. */
export async function buildExpireRequest(input: {
  agent: Address;
  request: Address;
  rentReceiver: Address;
}): Promise<Instruction> {
  return leash.getExpireRequestInstruction({
    agent: input.agent,
    request: input.request,
    rentReceiver: input.rentReceiver,
    ...(await leashAccounts()),
  });
}

/** `close_agent`: the agent must have no payees and no open requests left. */
export async function buildCloseAgent(input: {
  owner: TransactionSigner;
  agent: Address;
}): Promise<Instruction> {
  return leash.getCloseAgentInstruction({
    owner: input.owner,
    principal: await findPrincipalPda(input.owner.address),
    agent: input.agent,
    ...(await leashAccounts()),
  });
}
