import type { AgentView, PrincipalView, RequestView } from "@leash/contracts";
import {
  buildApproveRequest,
  buildFreezeAgent,
  buildFreezePrincipal,
  buildOnboarding,
  buildRejectRequest,
  buildSetGuardian,
  buildUnfreezeAgent,
  buildUnfreezePrincipal,
  fetchAgentView,
  fetchPayees,
  fetchPrincipalView,
  fetchRequestView,
  findAgentPda,
  findPrincipalPda,
  type LeashChain,
  type PayeeInput,
  type PolicyState,
  readChainTime,
} from "@leash/sdk";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { relativeTime, shortAddress, usdc } from "../format.ts";
import { nameOf, safeText } from "../text.ts";
import { OwnerActionError } from "./errors.ts";

// Every change the owner makes in the app is planned here: re-read the accounts it depends on from
// RPC (T13, never from the indexer), check who may sign and whether the change still makes sense,
// and build the instructions with the SDK's owner builders. The plan carries the plain-language
// summary the owner reads before the wallet opens. The UI never enforces anything: these checks
// only spare the owner a failed transaction, and the program decides.

export type OwnerActionKind =
  | "freezeAgent"
  | "unfreezeAgent"
  | "resetStrikes"
  | "freezeAll"
  | "unfreezeAll"
  | "approve"
  | "reject"
  | "setGuardian"
  | "onboard";

/** One transaction the wallet signs; `purpose` names it while the owner waits. */
export type PlannedStep = { purpose: string; instructions: readonly Instruction[] };

export type OwnerPlan = {
  kind: OwnerActionKind;
  /** One sentence, read before the wallet opens: "Approve 1.50 USDC to Research API for “…”". */
  summary: string;
  /** What else the owner should know, one sentence each. */
  details: string[];
  /** The button that opens the wallet: "Approve", "Freeze". */
  confirmLabel: string;
  /** Stopping things is the safe direction; the dialog colours the others neutral. */
  tone: "freeze" | "neutral";
  /** In order; one wallet prompt each. */
  steps: PlannedStep[];
  /** The agent this plan is about (the new one for onboarding). */
  agent: string | null;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function loadAgent(chain: LeashChain, address: string): Promise<AgentView> {
  const agent = await fetchAgentView(chain, address as Address);
  if (!agent) throw new OwnerActionError("NOT_FOUND", "This agent no longer exists on-chain.");
  return agent;
}

async function loadPrincipal(chain: LeashChain, owner: string): Promise<PrincipalView> {
  const principal = await fetchPrincipalView(chain, owner as Address);
  if (!principal) {
    throw new OwnerActionError(
      "NOT_FOUND",
      "This wallet has no Leash account yet: pair an agent first.",
    );
  }
  return principal;
}

function requireOwner(principal: PrincipalView, signer: TransactionSigner, what: string): void {
  if (signer.address !== principal.owner) {
    throw new OwnerActionError(
      "NOT_ALLOWED",
      `Only the owner (${shortAddress(principal.owner)}) can ${what}. The connected wallet is ${shortAddress(signer.address)}.`,
    );
  }
}

function requireOwnerOrGuardian(
  principal: PrincipalView,
  signer: TransactionSigner,
  what: string,
): void {
  if (signer.address !== principal.owner && signer.address !== principal.guardian) {
    throw new OwnerActionError(
      "NOT_ALLOWED",
      `Only the owner or the guardian can ${what}. The connected wallet is ${shortAddress(signer.address)}.`,
    );
  }
}

const agentName = (agent: AgentView) => nameOf(agent.label, agent.address);

// ------------------------------------------------------------------------------- freeze, unfreeze

/** `freeze_agent`: the owner or the guardian stops one agent (I3). */
export async function planFreezeAgent(
  chain: LeashChain,
  input: { signer: TransactionSigner; agent: string },
): Promise<OwnerPlan> {
  const agent = await loadAgent(chain, input.agent);
  const principal = await loadPrincipal(chain, agent.owner);
  requireOwnerOrGuardian(principal, input.signer, "freeze this agent");
  if (agent.status === "frozen") {
    throw new OwnerActionError("ALREADY", `${agentName(agent)} is already frozen.`);
  }
  return {
    kind: "freezeAgent",
    summary: `Freeze ${agentName(agent)}.`,
    details: ["It stops paying anyone at once, on-chain.", "Only you, the owner, can unfreeze it."],
    confirmLabel: "Freeze",
    tone: "freeze",
    steps: [
      {
        purpose: "freeze the agent",
        instructions: [
          await buildFreezeAgent({
            authority: input.signer,
            owner: principal.owner as Address,
            agent: agent.address as Address,
          }),
        ],
      },
    ],
    agent: agent.address,
  };
}

/** `unfreeze_agent`: only the owner (I3). It also clears the strikes. */
export async function planUnfreezeAgent(
  chain: LeashChain,
  input: { signer: TransactionSigner; agent: string },
): Promise<OwnerPlan> {
  const agent = await loadAgent(chain, input.agent);
  const principal = await loadPrincipal(chain, agent.owner);
  requireOwner(principal, input.signer, "unfreeze an agent");
  if (agent.status !== "frozen") {
    throw new OwnerActionError("ALREADY", `${agentName(agent)} is not frozen.`);
  }
  const details = [
    agent.freezeReason === "tripwire"
      ? `It froze itself after ${plural(agent.stats.strikes, "blocked attempt")}. Check its activity before you let it pay again.`
      : "It can pay again within its rules.",
    "Its strikes are cleared.",
  ];
  if (principal.frozen) details.push("All agents are still paused until you unfreeze them all.");
  return {
    kind: "unfreezeAgent",
    summary: `Unfreeze ${agentName(agent)}.`,
    details,
    confirmLabel: "Unfreeze",
    tone: "neutral",
    steps: [
      {
        purpose: "unfreeze the agent",
        instructions: [
          await buildUnfreezeAgent({ owner: input.signer, agent: agent.address as Address }),
        ],
      },
    ],
    agent: agent.address,
  };
}

/**
 * Clears an active agent's leftover strikes: `unfreeze_agent` leaves an active agent's strikes
 * alone (01 §6), so freeze and unfreeze run in one transaction, as `pnpm owner:unfreeze` does.
 * The agent is never left frozen: both instructions succeed or neither does.
 */
export async function planResetStrikes(
  chain: LeashChain,
  input: { signer: TransactionSigner; agent: string },
): Promise<OwnerPlan> {
  const agent = await loadAgent(chain, input.agent);
  const principal = await loadPrincipal(chain, agent.owner);
  requireOwner(principal, input.signer, "clear an agent's strikes");
  if (agent.status === "frozen") {
    throw new OwnerActionError(
      "ALREADY",
      `${agentName(agent)} is frozen: unfreezing it clears its strikes.`,
    );
  }
  if (agent.stats.strikes === 0) {
    throw new OwnerActionError("ALREADY", `${agentName(agent)} has no strikes to clear.`);
  }
  return {
    kind: "resetStrikes",
    summary: `Clear ${plural(agent.stats.strikes, "strike")} of ${agentName(agent)}.`,
    details: [
      "The tripwire starts counting from zero again.",
      "One transaction freezes and unfreezes the agent; it keeps running.",
    ],
    confirmLabel: "Clear strikes",
    tone: "neutral",
    steps: [
      {
        purpose: "clear the strikes",
        instructions: [
          await buildFreezeAgent({
            authority: input.signer,
            owner: principal.owner as Address,
            agent: agent.address as Address,
          }),
          await buildUnfreezeAgent({ owner: input.signer, agent: agent.address as Address }),
        ],
      },
    ],
    agent: agent.address,
  };
}

/** `freeze_principal`: every agent of `owner` at once, by the owner or the guardian (I3). */
export async function planFreezeAll(
  chain: LeashChain,
  input: { signer: TransactionSigner; owner: string },
): Promise<OwnerPlan> {
  const principal = await loadPrincipal(chain, input.owner);
  requireOwnerOrGuardian(principal, input.signer, "freeze all agents");
  if (principal.frozen) throw new OwnerActionError("ALREADY", "All agents are already frozen.");
  return {
    kind: "freezeAll",
    summary: `Freeze all ${plural(principal.agentCount, "agent")}.`,
    details: [
      "None of them can pay anyone until you unfreeze them all.",
      "Each agent keeps its own state: one you froze before stays frozen afterwards.",
    ],
    confirmLabel: "Freeze all",
    tone: "freeze",
    steps: [
      {
        purpose: "freeze all agents",
        instructions: [
          await buildFreezePrincipal({
            authority: input.signer,
            owner: principal.owner as Address,
          }),
        ],
      },
    ],
    agent: null,
  };
}

/** `unfreeze_principal`: only the owner. */
export async function planUnfreezeAll(
  chain: LeashChain,
  input: { signer: TransactionSigner },
): Promise<OwnerPlan> {
  const principal = await loadPrincipal(chain, input.signer.address);
  requireOwner(principal, input.signer, "unfreeze all agents");
  if (!principal.frozen) throw new OwnerActionError("ALREADY", "Your agents are not paused.");
  return {
    kind: "unfreezeAll",
    summary: `Unfreeze all ${plural(principal.agentCount, "agent")}.`,
    details: ["They can pay again within their rules.", "An agent frozen on its own stays frozen."],
    confirmLabel: "Unfreeze all",
    tone: "neutral",
    steps: [
      {
        purpose: "unfreeze all agents",
        instructions: [await buildUnfreezePrincipal({ owner: input.signer })],
      },
    ],
    agent: null,
  };
}

// --------------------------------------------------------------------------- approve and reject

type RequestContext = {
  request: RequestView;
  agent: AgentView;
  principal: PrincipalView;
  /** "1.50 USDC to Research API". */
  what: string;
  /** " for “weekly market report”", or "". */
  forMemo: string;
};

async function loadRequest(chain: LeashChain, address: string): Promise<RequestContext> {
  const request = await fetchRequestView(chain, address as Address);
  if (!request) {
    throw new OwnerActionError(
      "NOT_FOUND",
      "This request is no longer open: it was paid, rejected or expired.",
    );
  }
  const agent = await loadAgent(chain, request.agent);
  const principal = await loadPrincipal(chain, agent.owner);
  const payees = await fetchPayees(chain, agent.address as Address);
  const payee = nameOf(payees.find((p) => p.payee === request.payee)?.label, request.payee);
  const memo = safeText(request.memo, 64);
  return {
    request,
    agent,
    principal,
    what: `${usdc(request.amount)} USDC to ${payee}`,
    forMemo: memo ? ` for “${memo}”` : "",
  };
}

/** `approve_request`: only the owner, a pending request that has not expired (01 §6.1). */
export async function planApprove(
  chain: LeashChain,
  input: { signer: TransactionSigner; request: string },
): Promise<OwnerPlan> {
  const context = await loadRequest(chain, input.request);
  const { request, agent, principal } = context;
  requireOwner(principal, input.signer, "approve a payment");
  if (request.status === "approved") {
    throw new OwnerActionError("ALREADY", "This request is already approved.");
  }
  const now = Number(await readChainTime(chain));
  // The program's is_expired is `now >= expires_at`.
  if (now >= request.expiresAt) {
    throw new OwnerActionError("EXPIRED", "This request has expired. The agent has to ask again.");
  }
  return {
    kind: "approve",
    summary: `Approve ${context.what}${context.forMemo}.`,
    details: [
      `${agentName(agent)} asked for it; the reason is the agent's own words.`,
      "The agent can then make exactly this payment, once. It still counts against the allowance.",
      `The request expires ${relativeTime(request.expiresAt, now)}.`,
    ],
    confirmLabel: "Approve",
    tone: "neutral",
    steps: [
      {
        purpose: "approve the payment",
        instructions: [
          await buildApproveRequest({
            owner: input.signer,
            agent: agent.address as Address,
            request: request.address as Address,
          }),
        ],
      },
    ],
    agent: agent.address,
  };
}

/** `reject_request`: the owner or the guardian; also withdraws an approval not yet used. */
export async function planReject(
  chain: LeashChain,
  input: { signer: TransactionSigner; request: string },
): Promise<OwnerPlan> {
  const context = await loadRequest(chain, input.request);
  const { request, agent, principal } = context;
  requireOwnerOrGuardian(principal, input.signer, "reject a payment");
  return {
    kind: "reject",
    summary: `Reject ${context.what}${context.forMemo}.`,
    details: [
      request.status === "approved"
        ? `This withdraws your approval before ${agentName(agent)} pays.`
        : `${agentName(agent)} is told no; nothing is paid.`,
      "The request is closed and its rent goes back to whoever paid it.",
    ],
    confirmLabel: "Reject",
    tone: "freeze",
    steps: [
      {
        purpose: "reject the payment",
        instructions: [
          await buildRejectRequest({
            authority: input.signer,
            owner: principal.owner as Address,
            agent: agent.address as Address,
            request: request.address as Address,
            rentReceiver: request.rentPayer as Address,
          }),
        ],
      },
    ],
    agent: agent.address,
  };
}

// ------------------------------------------------------------------------------------- guardian

/** `set_guardian`: only the owner; null removes the guardian. */
export async function planSetGuardian(
  chain: LeashChain,
  input: { signer: TransactionSigner; guardian: string | null },
): Promise<OwnerPlan> {
  const principal = await loadPrincipal(chain, input.signer.address);
  requireOwner(principal, input.signer, "change the guardian");
  if (input.guardian === principal.guardian) {
    throw new OwnerActionError(
      "ALREADY",
      input.guardian === null
        ? "There is no guardian to remove."
        : "This is already your guardian.",
    );
  }
  if (input.guardian === principal.owner) {
    throw new OwnerActionError("INVALID", "The guardian must be another key than your own wallet.");
  }
  const remove = input.guardian === null;
  return {
    kind: "setGuardian",
    summary: remove
      ? "Remove your guardian."
      : `Make ${shortAddress(input.guardian ?? "")} your guardian.`,
    details: remove
      ? ["Nothing but your own wallet can freeze your agents any more."]
      : [
          "The guardian (Sentinel) can freeze your agents and reject requests, nothing else.",
          "It can never unfreeze, pay or change a rule.",
          ...(principal.guardian ? [`It replaces ${shortAddress(principal.guardian)}.`] : []),
        ],
    confirmLabel: remove ? "Remove guardian" : "Set guardian",
    tone: "neutral",
    steps: [
      {
        purpose: remove ? "remove the guardian" : "set the guardian",
        instructions: [
          await buildSetGuardian({
            owner: input.signer,
            guardian: (input.guardian as Address | null) ?? null,
          }),
        ],
      },
    ],
    agent: null,
  };
}

// ------------------------------------------------------------------------------------- pairing

export type OnboardingRequest = {
  signer: TransactionSigner;
  agentKey: string;
  label: string;
  mint: string;
  policy: PolicyState;
  /** A recurring allowance: `amountPerPeriod` every `periodLengthSecs`, from now. */
  allowance: {
    amountPerPeriod: bigint;
    periodLengthSecs: bigint;
    /** It expires this long after the cluster's current time; 0n = never. */
    durationSecs: bigint;
  };
  payees: readonly PayeeInput[];
  /** Only used when the owner's Leash account is created now. */
  guardian: string | null;
  /** The plain-language review the owner read, repeated in the summary's details. */
  review: readonly string[];
};

/**
 * Pairing: everything `buildOnboarding` signs (principal, agent, Subscriptions allowance,
 * allowlist), skipping what already exists. Refuses an agent key that is already paired with this
 * owner, and the owner's own key as agent key.
 */
export async function planOnboarding(
  chain: LeashChain,
  input: OnboardingRequest,
): Promise<OwnerPlan> {
  const owner = input.signer.address;
  if (input.agentKey === owner) {
    throw new OwnerActionError("INVALID", "The agent key must not be your own wallet.");
  }
  const agentAddress = await findAgentPda(await findPrincipalPda(owner), input.agentKey as Address);
  if (await fetchAgentView(chain, agentAddress)) {
    throw new OwnerActionError(
      "ALREADY",
      "This agent is already paired with your wallet. Open it from the overview.",
    );
  }
  let plan: Awaited<ReturnType<typeof buildOnboarding>>;
  try {
    plan = await buildOnboarding(chain, {
      owner: input.signer,
      agentKey: input.agentKey as Address,
      mint: input.mint as Address,
      label: input.label,
      policy: input.policy,
      allowance: {
        kind: "recurring",
        amountPerPeriod: input.allowance.amountPerPeriod,
        periodLengthSecs: input.allowance.periodLengthSecs,
        ...(input.allowance.durationSecs > 0n
          ? { expiryTs: (await readChainTime(chain)) + input.allowance.durationSecs }
          : {}),
      },
      payees: input.payees,
      guardian: (input.guardian as Address | null) ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("is not a token mint")) {
      throw new OwnerActionError("INVALID", "The token mint is not a token mint on this cluster.");
    }
    throw error;
  }
  const n = plan.transactions.length;
  return {
    kind: "onboard",
    summary: `Put ${nameOf(input.label, plan.agent)} on a leash.`,
    details: [
      ...input.review,
      n === 1
        ? "Your wallet asks you to sign once."
        : `Your wallet asks you to sign ${n} times, in order.`,
    ],
    confirmLabel: "Sign and pair",
    tone: "neutral",
    steps: plan.transactions.map((t) => ({ purpose: t.purpose, instructions: t.instructions })),
    agent: plan.agent,
  };
}
