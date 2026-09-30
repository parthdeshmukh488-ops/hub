import { SEEDS } from "@leash/contracts";
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
} from "@solana/kit";
import {
  findAgentPda as generatedAgentPda,
  findPayeeEntryPda as generatedPayeePda,
  findPrincipalPda as generatedPrincipalPda,
  LEASH_PROGRAM_ADDRESS,
} from "./generated/leash/index.ts";
import {
  findRecurringDelegationPda as generatedRecurringDelegationPda,
  findSubscriptionAuthorityPda as generatedSubscriptionAuthorityPda,
  findEventAuthorityPda as generatedSubscriptionsEventAuthority,
  SUBSCRIPTIONS_PROGRAM_ADDRESS,
} from "./generated/subscriptions/index.ts";

// Every address Leash derives (01-onchain-program §4, 02-contracts §2.3). Consumers use these;
// nobody re-derives PDAs locally (04-conventions §2.5).

export { LEASH_PROGRAM_ADDRESS, SUBSCRIPTIONS_PROGRAM_ADDRESS };

const text = (seed: string) => new TextEncoder().encode(seed);
const address = getAddressEncoder();

/** The owner's `Principal`: `["principal", owner]`. */
export async function findPrincipalPda(owner: Address): Promise<Address> {
  const [pda] = await generatedPrincipalPda({ owner });
  return pda;
}

/** An agent's `Agent` account, also its Subscriptions delegatee: `["agent", principal, agentKey]`. */
export async function findAgentPda(principal: Address, agentKey: Address): Promise<Address> {
  const [pda] = await generatedAgentPda({ principal, agentKey });
  return pda;
}

/** An allowlist entry: `["payee", agent, payee]`, where `payee` is the wallet. */
export async function findPayeePda(agent: Address, payee: Address): Promise<Address> {
  const [pda] = await generatedPayeePda({ agent, payee });
  return pda;
}

/** A payment request: `["request", agent, nonce as u64 LE]`. */
export async function findRequestPda(agent: Address, nonce: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: LEASH_PROGRAM_ADDRESS,
    seeds: [text(SEEDS.request), address.encode(agent), getU64Encoder().encode(nonce)],
  });
  return pda;
}

/** Leash's event authority (Anchor `#[event_cpi]`): `["__event_authority"]`. */
export async function findLeashEventAuthorityPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: LEASH_PROGRAM_ADDRESS,
    seeds: [text(SEEDS.leashEventAuthority)],
  });
  return pda;
}

/** The owner's Subscription Authority for `mint`: `["SubscriptionAuthority", owner, mint]`. */
export async function findSubscriptionAuthorityPda(
  owner: Address,
  mint: Address,
): Promise<Address> {
  const [pda] = await generatedSubscriptionAuthorityPda({ user: owner, tokenMint: mint });
  return pda;
}

/** Subscriptions' event authority: `["event_authority"]` under Subscriptions. */
export async function findSubscriptionsEventAuthorityPda(): Promise<Address> {
  const [pda] = await generatedSubscriptionsEventAuthority();
  return pda;
}

/** Seeds of a delegation from `owner` to an Agent PDA; the first one has nonce 0. */
export type DelegationSeeds = {
  subscriptionAuthority: Address;
  owner: Address;
  /** The Agent PDA. */
  agent: Address;
  nonce?: bigint;
};

/**
 * A Subscriptions delegation (fixed or recurring: both use the same seeds):
 * `["delegation", subscriptionAuthority, owner, agent, nonce as u64 LE]`.
 */
export async function findDelegationPda(seeds: DelegationSeeds): Promise<Address> {
  const [pda] = await generatedRecurringDelegationPda({
    subscriptionAuthority: seeds.subscriptionAuthority,
    delegator: seeds.owner,
    delegatee: seeds.agent,
    nonce: seeds.nonce ?? 0n,
  });
  return pda;
}
