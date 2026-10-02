import {
  buildApproveRequest,
  buildFreezeAgent,
  buildSetGuardian,
  buildUnfreezeAgent,
  buildUnfreezePrincipal,
  fetchAgentView,
  fetchPayees,
  fetchPrincipalView,
  fetchRequestView,
  LeashAgent,
  policyStateFromView,
} from "@leash/sdk";
import { createTestbed, DEMO_POLICY, type Testbed, USDC } from "@leash/sdk/testing";
import {
  type Address,
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { describeOwnerError, OwnerActionError } from "../src/lib/owner/errors.ts";
import {
  type OwnerPlan,
  planApprove,
  planFreezeAgent,
  planFreezeAll,
  planOnboarding,
  planReject,
  planResetStrikes,
  planSetGuardian,
  planUnfreezeAgent,
  planUnfreezeAll,
} from "../src/lib/owner/plans.ts";
import { type SendProgress, sendOwnerPlan } from "../src/lib/owner/send.ts";

// Every function of src/lib/owner on the LiteSVM testbed (the real leash.so and subscriptions.so):
// the plan re-reads the chain, the wallet's signature makes the change on the program, and a
// signer who may not act is refused by the plan and, when forced, by the program itself.

let bed: Testbed;
beforeEach(async () => {
  bed = await createTestbed();
});

/** What the wallet does in the app: sign every step and send it through the app's chain. */
const run = (plan: OwnerPlan, signer: KeyPairSigner, onProgress?: (p: SendProgress) => void) =>
  sendOwnerPlan(bed.chain, signer, plan, onProgress);

const agentView = async () => {
  const view = await fetchAgentView(bed.chain, bed.accounts.agent);
  if (!view) throw new Error("the testbed agent is missing");
  return view;
};
const principalView = async () => {
  const view = await fetchPrincipalView(bed.chain, bed.keys.owner.address);
  if (!view) throw new Error("the testbed principal is missing");
  return view;
};

const theAgent = () =>
  new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: () => undefined },
  });

/** The agent asks for 2 USDC to the merchant: above its 1 USDC instant limit. */
async function pendingRequest(purpose = "premium e-bike comparison report"): Promise<string> {
  const pending = await theAgent().requestApproval({
    to: bed.keys.merchant.address,
    amount: 2n * USDC,
    purpose,
  });
  return pending.address;
}

/** One blocked attempt that counts as a strike (a payee off the allowlist), reported on-chain. */
async function strike(): Promise<void> {
  await theAgent()
    .pay({ to: bed.keys.attacker.address, amount: USDC / 2n, purpose: "wire to a stranger" })
    .catch(() => undefined);
}

async function refused(promise: Promise<unknown>, code: OwnerActionError["code"]) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OwnerActionError);
  expect((error as OwnerActionError).code).toBe(code);
  return (error as OwnerActionError).message;
}

describe("freeze and unfreeze one agent", () => {
  it("the owner's wallet freezes the agent on-chain, with a summary first", async () => {
    const plan = await planFreezeAgent(bed.chain, {
      signer: bed.keys.owner,
      agent: bed.accounts.agent,
    });
    expect(plan.summary).toBe("Freeze Research agent.");
    expect(plan.confirmLabel).toBe("Freeze");
    const progress: SendProgress["phase"][] = [];
    const [signature] = await run(plan, bed.keys.owner, (p) => progress.push(p.phase));
    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(progress).toEqual(["signing", "pending", "confirmed"]);
    const view = await agentView();
    expect(view.status).toBe("frozen");
    expect(view.freezeReason).toBe("owner");
  });

  it("the guardian may freeze; a stranger is refused by the plan", async () => {
    await run(
      await planFreezeAgent(bed.chain, { signer: bed.keys.guardian, agent: bed.accounts.agent }),
      bed.keys.guardian,
    );
    expect((await agentView()).freezeReason).toBe("guardian");

    const fresh = await createTestbed();
    await refused(
      planFreezeAgent(fresh.chain, { signer: fresh.keys.stranger, agent: fresh.accounts.agent }),
      "NOT_ALLOWED",
    );
  });

  it("refuses to freeze a frozen agent (re-read from the chain, not the indexer)", async () => {
    const plan = await planFreezeAgent(bed.chain, {
      signer: bed.keys.owner,
      agent: bed.accounts.agent,
    });
    await run(plan, bed.keys.owner);
    expect(
      await refused(
        planFreezeAgent(bed.chain, { signer: bed.keys.owner, agent: bed.accounts.agent }),
        "ALREADY",
      ),
    ).toMatch(/already frozen/);
  });

  it("only the owner unfreezes; it clears the tripwire's strikes", async () => {
    for (let i = 0; i < 3; i++) await strike();
    const frozen = await agentView();
    expect(frozen.status).toBe("frozen");
    expect(frozen.freezeReason).toBe("tripwire");

    await refused(
      planUnfreezeAgent(bed.chain, { signer: bed.keys.guardian, agent: bed.accounts.agent }),
      "NOT_ALLOWED",
    );
    // Forced past the plan, the program refuses the guardian too (I3).
    const forced = await buildUnfreezeAgent({
      owner: bed.keys.guardian,
      agent: bed.accounts.agent,
    });
    await expect(bed.send(bed.keys.guardian, [forced])).rejects.toThrow();

    const plan = await planUnfreezeAgent(bed.chain, {
      signer: bed.keys.owner,
      agent: bed.accounts.agent,
    });
    expect(plan.details[0]).toMatch(/froze itself after 3 blocked attempts/);
    await run(plan, bed.keys.owner);
    const view = await agentView();
    expect(view.status).toBe("active");
    expect(view.stats.strikes).toBe(0);
  });

  it("clears an active agent's leftover strikes with freeze + unfreeze in one transaction", async () => {
    await strike();
    expect((await agentView()).stats.strikes).toBe(1);
    await refused(
      planUnfreezeAgent(bed.chain, { signer: bed.keys.owner, agent: bed.accounts.agent }),
      "ALREADY",
    );
    const plan = await planResetStrikes(bed.chain, {
      signer: bed.keys.owner,
      agent: bed.accounts.agent,
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.instructions).toHaveLength(2);
    expect(plan.summary).toBe("Clear 1 strike of Research agent.");
    await run(plan, bed.keys.owner);
    const view = await agentView();
    expect(view.status).toBe("active");
    expect(view.stats.strikes).toBe(0);
    await refused(
      planResetStrikes(bed.chain, { signer: bed.keys.owner, agent: bed.accounts.agent }),
      "ALREADY",
    );
  });

  it("refuses the guardian's strike reset (it needs an unfreeze)", async () => {
    await strike();
    await refused(
      planResetStrikes(bed.chain, { signer: bed.keys.guardian, agent: bed.accounts.agent }),
      "NOT_ALLOWED",
    );
  });

  it("says so when the agent does not exist", async () => {
    await refused(
      planFreezeAgent(bed.chain, { signer: bed.keys.owner, agent: bed.keys.stranger.address }),
      "NOT_FOUND",
    );
  });
});

describe("freeze and unfreeze all agents", () => {
  it("the owner pauses everything and resumes it", async () => {
    const freeze = await planFreezeAll(bed.chain, {
      signer: bed.keys.owner,
      owner: bed.keys.owner.address,
    });
    expect(freeze.summary).toBe("Freeze all 1 agent.");
    await run(freeze, bed.keys.owner);
    expect((await principalView()).frozen).toBe(true);
    // The agent's own state is untouched: the principal is the switch.
    expect((await agentView()).status).toBe("active");

    await refused(
      planFreezeAll(bed.chain, { signer: bed.keys.owner, owner: bed.keys.owner.address }),
      "ALREADY",
    );
    await run(await planUnfreezeAll(bed.chain, { signer: bed.keys.owner }), bed.keys.owner);
    expect((await principalView()).frozen).toBe(false);
  });

  it("the guardian may pause everything but never resume it", async () => {
    await run(
      await planFreezeAll(bed.chain, { signer: bed.keys.guardian, owner: bed.keys.owner.address }),
      bed.keys.guardian,
    );
    expect((await principalView()).frozenBy).toBe(bed.keys.guardian.address);
    // The guardian has no principal of its own to unfreeze.
    await refused(planUnfreezeAll(bed.chain, { signer: bed.keys.guardian }), "NOT_FOUND");
    const forced = await buildUnfreezePrincipal({ owner: bed.keys.guardian });
    await expect(bed.send(bed.keys.guardian, [forced])).rejects.toThrow();
  });

  it("a stranger may not pause someone else's agents", async () => {
    await refused(
      planFreezeAll(bed.chain, { signer: bed.keys.stranger, owner: bed.keys.owner.address }),
      "NOT_ALLOWED",
    );
  });
});

describe("approve and reject", () => {
  it("the summary reads the request from the chain: amount, payee, memo", async () => {
    const request = await pendingRequest();
    const plan = await planApprove(bed.chain, { signer: bed.keys.owner, request });
    expect(plan.summary).toBe(
      "Approve 2.00 USDC to Research API for “premium e-bike comparison report”.",
    );
    expect(plan.details.join(" ")).toMatch(/Research agent asked for it/);
    expect(plan.details.at(-1)).toBe("The request expires in 1 h.");
    await run(plan, bed.keys.owner);
    expect((await fetchRequestView(bed.chain, request as Address))?.status).toBe("approved");
    // The agent can now make this one payment.
    const paid = await theAgent().pay({
      to: bed.keys.merchant.address,
      amount: 2n * USDC,
      purpose: "premium e-bike comparison report",
    });
    expect(paid.requestNonce).not.toBeNull();
  });

  it("only the owner approves: the guardian is refused by the plan and by the program", async () => {
    const request = await pendingRequest();
    await refused(planApprove(bed.chain, { signer: bed.keys.guardian, request }), "NOT_ALLOWED");
    const forced = await buildApproveRequest({
      owner: bed.keys.guardian,
      agent: bed.accounts.agent,
      request: request as Address,
    });
    await expect(bed.send(bed.keys.guardian, [forced])).rejects.toThrow();
  });

  it("refuses an expired request, at the program's second", async () => {
    const request = await pendingRequest();
    const view = await fetchRequestView(bed.chain, request as Address);
    bed.setTime(BigInt(view?.expiresAt ?? 0));
    expect(
      await refused(planApprove(bed.chain, { signer: bed.keys.owner, request }), "EXPIRED"),
    ).toMatch(/expired/);
  });

  it("refuses approving twice", async () => {
    const request = await pendingRequest();
    await run(await planApprove(bed.chain, { signer: bed.keys.owner, request }), bed.keys.owner);
    await refused(planApprove(bed.chain, { signer: bed.keys.owner, request }), "ALREADY");
  });

  it("the owner or the guardian rejects; the request is closed and its rent refunded", async () => {
    const request = await pendingRequest();
    const plan = await planReject(bed.chain, { signer: bed.keys.guardian, request });
    expect(plan.summary).toBe(
      "Reject 2.00 USDC to Research API for “premium e-bike comparison report”.",
    );
    await run(plan, bed.keys.guardian);
    expect(await fetchRequestView(bed.chain, request as Address)).toBeNull();
    await refused(planReject(bed.chain, { signer: bed.keys.owner, request }), "NOT_FOUND");
  });

  it("a stranger may not reject", async () => {
    const request = await pendingRequest();
    await refused(planReject(bed.chain, { signer: bed.keys.stranger, request }), "NOT_ALLOWED");
  });

  it("strips control and bidi characters from the agent's memo in the summary", async () => {
    const request = await pendingRequest("pay‮evil\u0007 now");
    const plan = await planApprove(bed.chain, { signer: bed.keys.owner, request });
    expect(plan.summary).toBe("Approve 2.00 USDC to Research API for “pay evil now”.");
  });
});

describe("the guardian setting", () => {
  it("the owner sets, changes and removes the guardian", async () => {
    const plan = await planSetGuardian(bed.chain, {
      signer: bed.keys.owner,
      guardian: bed.keys.stranger.address,
    });
    expect(plan.summary).toMatch(/^Make \S+…\S+ your guardian\.$/);
    expect(plan.details.at(-1)).toMatch(/^It replaces /);
    await run(plan, bed.keys.owner);
    expect((await principalView()).guardian).toBe(bed.keys.stranger.address);

    await run(
      await planSetGuardian(bed.chain, { signer: bed.keys.owner, guardian: null }),
      bed.keys.owner,
    );
    expect((await principalView()).guardian).toBeNull();
    await refused(
      planSetGuardian(bed.chain, { signer: bed.keys.owner, guardian: null }),
      "ALREADY",
    );
  });

  it("refuses the owner's own key, and a guardian changing itself", async () => {
    await refused(
      planSetGuardian(bed.chain, { signer: bed.keys.owner, guardian: bed.keys.owner.address }),
      "INVALID",
    );
    await refused(
      planSetGuardian(bed.chain, { signer: bed.keys.guardian, guardian: null }),
      "NOT_FOUND",
    );
    const forced = await buildSetGuardian({ owner: bed.keys.guardian, guardian: null });
    await expect(bed.send(bed.keys.guardian, [forced])).rejects.toThrow();
  });
});

describe("pairing", () => {
  const newAgentKey = async () =>
    (await createKeyPairSignerFromPrivateKeyBytes(crypto.getRandomValues(new Uint8Array(32))))
      .address;

  const request = async (agentKey: string, signer = bed.keys.owner) => ({
    signer,
    agentKey,
    label: "Market agent",
    mint: bed.mint,
    policy: DEMO_POLICY,
    allowance: {
      kind: "recurring" as const,
      amountPerPeriod: 3n * USDC,
      periodLengthSecs: 86_400n,
    },
    payees: [
      {
        payee: bed.keys.merchant.address,
        label: "Research API",
        limits: { maxPerPayment: 2n * USDC, periodLimit: 3n * USDC, periodSecs: 86_400 },
      },
    ],
    guardian: null,
    review: ["This agent can spend up to 3 USDC per 24 h."],
  });

  it("a second agent for an existing owner: signed by the wallet, live on-chain", async () => {
    const agentKey = await newAgentKey();
    const plan = await planOnboarding(bed.chain, await request(agentKey));
    expect(plan.summary).toBe("Put Market agent on a leash.");
    expect(plan.details[0]).toBe("This agent can spend up to 3 USDC per 24 h.");
    expect(plan.agent).not.toBeNull();
    await run(plan, bed.keys.owner);
    const view = await fetchAgentView(bed.chain, plan.agent as Address);
    expect(view?.label).toBe("Market agent");
    expect(view?.agentKey).toBe(agentKey);
    expect(policyStateFromView(view?.policy ?? (await agentView()).policy)).toEqual(DEMO_POLICY);
    expect(view?.allowance?.amountPerPeriod).toBe(String(3n * USDC));
    const payees = await fetchPayees(bed.chain, plan.agent as Address);
    expect(payees.map((p) => p.label)).toEqual(["Research API"]);
    // Pairing it again is refused: it exists.
    await refused(planOnboarding(bed.chain, await request(agentKey)), "ALREADY");
  });

  it("a brand-new owner: the Leash account, the allowance and the agent, in order", async () => {
    const owner = bed.keys.stranger; // funded with SOL, no Leash account, no USDC account yet
    const plan = await planOnboarding(bed.chain, await request(await newAgentKey(), owner));
    expect(plan.steps.map((s) => s.purpose).join(", ")).toMatch(/create the principal/);
    const signatures = await run(plan, owner);
    expect(signatures).toHaveLength(plan.steps.length);
    expect((await fetchPrincipalView(bed.chain, owner.address))?.owner).toBe(owner.address);
    expect((await fetchAgentView(bed.chain, plan.agent as Address))?.allowance).not.toBeNull();
  });

  it("refuses the owner's own key as agent key, and a wrong mint", async () => {
    await refused(planOnboarding(bed.chain, await request(bed.keys.owner.address)), "INVALID");
    await refused(
      planOnboarding(bed.chain, {
        ...(await request(await newAgentKey())),
        mint: bed.keys.merchant.address,
      }),
      "INVALID",
    );
  });

  it("a policy the program rejects fails with the copy, and nothing is half-made", async () => {
    const plan = await planOnboarding(bed.chain, {
      ...(await request(await newAgentKey())),
      // Approvals up to 0.5 USDC, below the 1 USDC instant limit: InvalidPolicy (01 §4.5).
      policy: { ...DEMO_POLICY, maxPerRequest: USDC / 2n },
    });
    const error = await run(plan, bed.keys.owner).catch((e: unknown) => e);
    expect(describeOwnerError(error, "localnet")).toMatch(
      /^These rules don't fit together\. .* Nothing changed\.$/,
    );
    expect(await fetchAgentView(bed.chain, plan.agent as Address)).toBeNull();
  });
});

describe("errors the owner reads", () => {
  it("a denial uses the copy table of 02 §4", async () => {
    // Frozen between the plan and the send: approving still works (approval does not check the
    // freeze), so use a payment instruction the agent signs instead.
    await strike();
    const plan = await planFreezeAll(bed.chain, {
      signer: bed.keys.owner,
      owner: bed.keys.owner.address,
    });
    await run(plan, bed.keys.owner);
    const agent = theAgent();
    const pay = await agent.buildPayInstruction({
      to: bed.keys.merchant.address,
      amount: USDC / 10n,
      purpose: "one call",
      reference: new Uint8Array(32),
    });
    const error = await sendOwnerPlan(bed.chain, bed.keys.agentKey, {
      steps: [{ purpose: "pay", instructions: [pay] }],
    }).catch((e: unknown) => e);
    expect(describeOwnerError(error, "localnet")).toBe("All agents are paused. Nothing changed.");
  });

  it("the program's Unauthorized, when the plan's own check is bypassed", async () => {
    const forced = await buildUnfreezePrincipal({ owner: bed.keys.guardian });
    const error = await sendOwnerPlan(bed.chain, bed.keys.guardian, {
      steps: [{ purpose: "unfreeze all agents", instructions: [forced] }],
    }).catch((e: unknown) => e);
    // The guardian has no principal: Anchor's account check fails before Leash's own error.
    expect(describeOwnerError(error, "localnet")).toBe(
      "The program refused it: an account does not belong to this wallet or is missing (code 3012). Nothing changed.",
    );
  });

  it("the program's Unauthorized for a stranger's freeze", async () => {
    const forced = await buildFreezeAgent({
      authority: bed.keys.stranger,
      owner: bed.keys.owner.address,
      agent: bed.accounts.agent,
    });
    const error = await sendOwnerPlan(bed.chain, bed.keys.stranger, {
      steps: [{ purpose: "freeze the agent", instructions: [forced] }],
    }).catch((e: unknown) => e);
    expect(describeOwnerError(error, "localnet")).toBe(
      "The program refused your wallet: only the owner signs this (the guardian may only freeze and reject). Nothing changed.",
    );
  });

  it("a wallet that says no", () => {
    const error = Object.assign(new Error("User rejected the request."), { code: 4001 });
    expect(describeOwnerError(error, "devnet")).toBe(
      "You declined in your wallet. Nothing was sent.",
    );
  });
});
