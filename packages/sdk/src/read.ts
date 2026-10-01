import {
  type AgentView,
  type AllowanceView,
  decodeLabel,
  decodeMemo,
  type PayeeView,
  type PrincipalView,
  type RequestView,
  referenceToHex,
} from "@leash/contracts";
import {
  type Address,
  type EncodedAccount,
  getAddressEncoder,
  type MaybeEncodedAccount,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { allowanceAt, type DecodedDelegation, decodeDelegation } from "./allowance.ts";
import { type LeashChain, readChainTime } from "./chain.ts";
import {
  AGENT_STATUS_FROM_CHAIN,
  FREEZE_REASON_FROM_CHAIN,
  policyToView,
  REQUEST_STATUS_FROM_CHAIN,
  timeOrNull,
} from "./convert.ts";
import {
  AGENT_DISCRIMINATOR,
  type Agent,
  getAgentDecoder,
  getPayeeDecoder,
  getPaymentRequestDecoder,
  getPrincipalDecoder,
  PAYEE_DISCRIMINATOR,
  PAYMENT_REQUEST_DISCRIMINATOR,
  type Payee,
  type PaymentRequest,
  PRINCIPAL_DISCRIMINATOR,
  type Principal,
} from "./generated/leash/index.ts";
import {
  findDelegationPda,
  findPrincipalPda,
  findSubscriptionAuthorityPda,
  LEASH_PROGRAM_ADDRESS,
} from "./pda.ts";

// Build step 3: chain accounts → the contract views of 02-contracts §5. The mappers are pure; the
// `fetch*` functions read through a `LeashChain`.

/** `Pubkey::default()`, the program's "none" for optional keys. */
const DEFAULT_ADDRESS = "11111111111111111111111111111111";
const addressOrNull = (value: Address): string | null => (value === DEFAULT_ADDRESS ? null : value);
const bytes = (value: ReadonlyUint8Array) => new Uint8Array(value);

/** Byte offsets of the fields the list queries filter on (discriminator 8, version 1, bump 1). */
export const ACCOUNT_OFFSETS = {
  agentOwner: 42,
  payeeAgent: 10,
  requestAgent: 10,
} as const;

export function principalToView(address: Address, principal: Principal): PrincipalView {
  return {
    address,
    owner: principal.owner,
    guardian: addressOrNull(principal.guardian),
    frozen: principal.frozen,
    frozenAt: timeOrNull(principal.frozenAt),
    frozenBy: principal.frozen ? principal.frozenBy : null,
    agentCount: principal.agentCount,
    createdAt: Number(principal.createdAt),
  };
}

export function agentToView(
  address: Address,
  agent: Agent,
  allowance: AllowanceView | null,
): AgentView {
  const { stats } = agent;
  return {
    address,
    principal: agent.principal,
    owner: agent.owner,
    agentKey: agent.agentKey,
    mint: agent.mint,
    label: decodeLabel(bytes(agent.label)),
    status: AGENT_STATUS_FROM_CHAIN[agent.status],
    freezeReason: FREEZE_REASON_FROM_CHAIN[agent.freezeReason],
    frozenAt: timeOrNull(agent.frozenAt),
    payeeCount: agent.payeeCount,
    openRequests: agent.openRequests,
    policy: policyToView(agent.policy),
    stats: {
      paymentsCount: Number(stats.paymentsCount),
      totalPaid: stats.totalPaid.toString(),
      deniedCount: Number(stats.deniedCount),
      lastPaymentAt: timeOrNull(stats.lastPaymentAt),
      velocityCount: stats.velocityCount,
      velocityWindowStart: timeOrNull(stats.velocityWindowStart),
      strikes: stats.strikes,
      strikeWindowStart: timeOrNull(stats.strikeWindowStart),
      requestNonce: stats.requestNonce.toString(),
    },
    allowance,
    createdAt: Number(agent.createdAt),
    updatedAt: Number(agent.updatedAt),
  };
}

export function payeeToView(address: Address, payee: Payee): PayeeView {
  return {
    address,
    agent: payee.agent,
    payee: payee.payee,
    label: decodeLabel(bytes(payee.label)),
    maxPerPayment: payee.maxPerPayment.toString(),
    periodLimit: payee.periodLimit.toString(),
    periodSecs: payee.periodSecs,
    periodStart: timeOrNull(payee.periodStart),
    spentInPeriod: payee.spentInPeriod.toString(),
    totalPaid: payee.totalPaid.toString(),
    paymentsCount: Number(payee.paymentsCount),
    createdAt: Number(payee.createdAt),
  };
}

export function requestToView(address: Address, request: PaymentRequest): RequestView {
  return {
    address,
    agent: request.agent,
    nonce: request.nonce.toString(),
    payee: request.payee,
    amount: request.amount.toString(),
    reference: referenceToHex(bytes(request.reference)),
    memo: decodeMemo(bytes(request.memo)),
    status: REQUEST_STATUS_FROM_CHAIN[request.status],
    createdAt: Number(request.createdAt),
    expiresAt: Number(request.expiresAt),
    approvedAt: timeOrNull(request.approvedAt),
    rentPayer: request.rentPayer,
  };
}

/** Decodes a Leash account of one type, or null when it is missing, foreign or another type. */
function decodeLeash<T>(
  account: MaybeEncodedAccount | undefined,
  discriminator: ReadonlyUint8Array,
  decode: (data: ReadonlyUint8Array) => T,
): T | null {
  if (!account?.exists || account.programAddress !== LEASH_PROGRAM_ADDRESS) return null;
  const matches = discriminator.every((byte, i) => account.data[i] === byte);
  return matches ? decode(account.data) : null;
}

/** The owner's principal, or null if they have not onboarded. */
export async function fetchPrincipalView(
  chain: LeashChain,
  owner: Address,
): Promise<PrincipalView | null> {
  const address = await findPrincipalPda(owner);
  const [account] = await chain.getAccounts([address]);
  const principal = decodeLeash(account, PRINCIPAL_DISCRIMINATOR, (data) =>
    getPrincipalDecoder().decode(data),
  );
  return principal && principalToView(address, principal);
}

/**
 * The agent's view, with its allowance computed at `now` (default: the cluster's time). The
 * allowance comes from `delegation`, by default the nonce-0 delegation onboarding creates; it is
 * null when that account is missing or not a delegation to this agent.
 */
export async function fetchAgentView(
  chain: LeashChain,
  agent: Address,
  options: { now?: bigint; delegation?: Address } = {},
): Promise<AgentView | null> {
  const [account] = await chain.getAccounts([agent]);
  const decoded = decodeLeash(account, AGENT_DISCRIMINATOR, (data) =>
    getAgentDecoder().decode(data),
  );
  if (decoded === null) return null;
  const now = options.now ?? (await readChainTime(chain));
  const delegation = await fetchAgentDelegation(chain, agent, decoded, options.delegation);
  return agentToView(agent, decoded, delegation && allowanceAt(delegation, now));
}

/** The Subscriptions delegation that funds `agent`, decoded, or null (missing or foreign). */
export async function fetchAgentDelegation(
  chain: LeashChain,
  agentAddress: Address,
  agent: Pick<Agent, "owner" | "mint">,
  delegation?: Address,
): Promise<DecodedDelegation | null> {
  const address =
    delegation ??
    (await findDelegationPda({
      subscriptionAuthority: await findSubscriptionAuthorityPda(agent.owner, agent.mint),
      owner: agent.owner,
      agent: agentAddress,
    }));
  const [account] = await chain.getAccounts([address]);
  if (!account?.exists) return null;
  try {
    const decoded = decodeDelegation(address, new Uint8Array(account.data));
    const matches =
      decoded.delegator === agent.owner &&
      decoded.delegatee === agentAddress &&
      decoded.mint === agent.mint;
    return matches ? decoded : null;
  } catch {
    return null;
  }
}

const addressBytes = (value: Address) => getAddressEncoder().encode(value);

async function listLeashAccounts<T>(
  chain: LeashChain,
  discriminator: ReadonlyUint8Array,
  offset: number,
  value: Address,
  decode: (account: EncodedAccount) => T,
): Promise<T[]> {
  const accounts = await chain.getProgramAccounts(LEASH_PROGRAM_ADDRESS, [
    { memcmp: { offset: 0, bytes: discriminator } },
    { memcmp: { offset, bytes: addressBytes(value) } },
  ]);
  return accounts.map(decode);
}

/** Every agent of `owner`, with allowances at `now` (default: the cluster's time), oldest first. */
export async function fetchAgentViews(
  chain: LeashChain,
  owner: Address,
  options: { now?: bigint } = {},
): Promise<AgentView[]> {
  const now = options.now ?? (await readChainTime(chain));
  const agents = await listLeashAccounts(
    chain,
    AGENT_DISCRIMINATOR,
    ACCOUNT_OFFSETS.agentOwner,
    owner,
    (account) => ({ address: account.address, agent: getAgentDecoder().decode(account.data) }),
  );
  const views = await Promise.all(
    agents.map(async ({ address, agent }) => {
      const delegation = await fetchAgentDelegation(chain, address, agent);
      return agentToView(address, agent, delegation && allowanceAt(delegation, now));
    }),
  );
  return views.sort((a, b) => a.createdAt - b.createdAt || a.address.localeCompare(b.address));
}

/** The agent's allowlist, oldest entry first. */
export async function fetchPayees(chain: LeashChain, agent: Address): Promise<PayeeView[]> {
  const payees = await listLeashAccounts(
    chain,
    PAYEE_DISCRIMINATOR,
    ACCOUNT_OFFSETS.payeeAgent,
    agent,
    (account) => payeeToView(account.address, getPayeeDecoder().decode(account.data)),
  );
  return payees.sort((a, b) => a.createdAt - b.createdAt || a.payee.localeCompare(b.payee));
}

/**
 * One payment request by its address, or null when it is missing (rejected, executed and expired
 * requests are closed), foreign or another type. Solana Actions get only the request's address.
 */
export async function fetchRequestView(
  chain: LeashChain,
  request: Address,
): Promise<RequestView | null> {
  const [account] = await chain.getAccounts([request]);
  const decoded = decodeLeash(account, PAYMENT_REQUEST_DISCRIMINATOR, (data) =>
    getPaymentRequestDecoder().decode(data),
  );
  return decoded && requestToView(request, decoded);
}

/** The agent's open payment requests (pending or approved; expired ones included), by nonce. */
export async function fetchOpenRequests(chain: LeashChain, agent: Address): Promise<RequestView[]> {
  const requests = await listLeashAccounts(
    chain,
    PAYMENT_REQUEST_DISCRIMINATOR,
    ACCOUNT_OFFSETS.requestAgent,
    agent,
    (account) => requestToView(account.address, getPaymentRequestDecoder().decode(account.data)),
  );
  return requests.sort((a, b) => (BigInt(a.nonce) < BigInt(b.nonce) ? -1 : 1));
}

/** Everything `leash_status` reports (the `LeashAgentPort` of @leash/tools), read at `now`. */
export type AgentStatusSnapshot = {
  principal: PrincipalView;
  agent: AgentView;
  payees: PayeeView[];
  /** Unix seconds (the cluster's time). */
  now: number;
};

/** Principal, agent and allowlist of `agent` at the cluster's time, or null if it is not paired. */
export async function readAgentStatus(
  chain: LeashChain,
  agent: Address,
  options: { delegation?: Address } = {},
): Promise<AgentStatusSnapshot | null> {
  const now = await readChainTime(chain);
  const agentView = await fetchAgentView(chain, agent, { ...options, now });
  if (agentView === null) return null;
  const principal = await fetchPrincipalView(chain, agentView.owner as Address);
  if (principal === null) return null;
  return { principal, agent: agentView, payees: await fetchPayees(chain, agent), now: Number(now) };
}
