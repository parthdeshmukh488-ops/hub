import { DENIAL_REASONS, type RequestView } from "@leash/contracts";
import { LEASH_PROGRAM_ADDRESS, LeashNetworkError } from "@leash/sdk";
import { type Address, getSolanaErrorFromTransactionError } from "@solana/kit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerActionDialog } from "../src/components/owner-action-dialog.tsx";
import { RequestList } from "../src/components/request-list.tsx";
import { describeOwnerError, OwnerActionError } from "../src/lib/owner/errors.ts";
import type { OwnerPlan } from "../src/lib/owner/plans.ts";
import { StepFailedError } from "../src/lib/owner/send.ts";
import type { OwnerAction, OwnerActionState } from "../src/lib/owner/use-owner-action.ts";

// What the owner reads: the summaries before the wallet opens, and the error copy afterwards.

const OTHER_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/** A step of `program` that failed with custom error `code` (as the RPC reports it). */
function failed(code: number, program: Address = LEASH_PROGRAM_ADDRESS, sent = true) {
  const cause = getSolanaErrorFromTransactionError({ InstructionError: [0, { Custom: code }] });
  return new StepFailedError(
    { purpose: "test", instructions: [{ programAddress: program }] },
    0,
    sent,
    [],
    cause,
  );
}

describe("error copy", () => {
  it("every denial reads as the 02 §4 copy table says", () => {
    for (const denial of DENIAL_REASONS) {
      expect(describeOwnerError(failed(6000 + denial.code - 1), "devnet")).toBe(
        `${denial.ownerCopy}. Nothing changed.`,
      );
    }
  });

  it("the program's other errors have their own sentence", () => {
    // 6012 is Unauthorized, the first error after the twelve denials.
    expect(describeOwnerError(failed(6012), "devnet")).toMatch(/^The program refused your wallet/);
    expect(describeOwnerError(failed(6030), "devnet")).toMatch(/^Remove the agent's payees/);
    expect(describeOwnerError(failed(6031), "devnet")).toBe(
      "The Leash program refused it (MathOverflow). Nothing changed.",
    );
  });

  it("another program's custom error is not mistaken for a Leash denial", () => {
    expect(describeOwnerError(failed(6003, OTHER_PROGRAM), "devnet")).not.toMatch(/allowlist/);
  });

  it("no SOL for the fee", () => {
    const error = new StepFailedError(
      { purpose: "test", instructions: [] },
      0,
      true,
      [],
      getSolanaErrorFromTransactionError("InsufficientFundsForFee"),
    );
    expect(describeOwnerError(error, "devnet")).toBe(
      "Your wallet needs a little SOL on devnet to pay the network fee. Nothing changed.",
    );
  });

  it("the network, before and after sending", () => {
    const step = { purpose: "test", instructions: [] };
    const down = new LeashNetworkError("reading accounts failed");
    expect(describeOwnerError(new StepFailedError(step, 0, false, [], down), "devnet")).toBe(
      "Can't reach devnet right now. Nothing was sent.",
    );
    expect(describeOwnerError(new StepFailedError(step, 0, true, [], down), "devnet")).toMatch(
      /^Lost contact with devnet after sending/,
    );
  });

  it("a refused plan, a declined wallet, a half-done onboarding", () => {
    expect(describeOwnerError(new OwnerActionError("ALREADY", "Already frozen."), "devnet")).toBe(
      "Already frozen.",
    );
    const declined = Object.assign(new Error("User rejected the request."), { code: 4001 });
    expect(
      describeOwnerError(
        new StepFailedError({ purpose: "x", instructions: [] }, 1, false, ["sig1"], declined),
        "devnet",
      ),
    ).toBe(
      "You declined in your wallet. Nothing was sent. The first transaction went through; starting again picks up where this stopped.",
    );
  });
});

const plan: OwnerPlan = {
  kind: "approve",
  summary: 'Approve 2.00 USDC to <img src=x onerror="alert(1)"> for “<b>now</b>”.',
  details: ["Research agent asked for it; the reason is the agent's own words."],
  confirmLabel: "Approve",
  tone: "neutral",
  steps: [{ purpose: "approve the payment", instructions: [] }],
  agent: null,
};

const actionIn = (state: OwnerActionState): OwnerAction => ({
  state,
  start: () => undefined,
  confirm: () => undefined,
  close: () => undefined,
});

describe("the summary dialog", () => {
  it("shows the summary before the wallet, as text only (T18)", () => {
    const html = renderToStaticMarkup(
      <OwnerActionDialog action={actionIn({ phase: "review", plan })} />,
    );
    expect(html).toContain("Approve 2.00 USDC to &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Cancel</button>");
  });

  it("says what is happening while the wallet and the network work", () => {
    expect(
      renderToStaticMarkup(
        <OwnerActionDialog action={actionIn({ phase: "signing", plan, step: 0 })} />,
      ),
    ).toContain("Confirm in your wallet");
    const pending = renderToStaticMarkup(
      <OwnerActionDialog
        action={actionIn({ phase: "pending", plan, step: 0, signature: "5".repeat(88) })}
      />,
    );
    expect(pending).toContain("Waiting for the network to confirm");
    expect(pending).not.toContain(">Approve</button>");
  });

  it("links the confirmed transaction and states a failure in words", () => {
    const done = renderToStaticMarkup(
      <OwnerActionDialog
        action={actionIn({ phase: "confirmed", plan, signatures: ["4".repeat(88)] })}
      />,
    );
    expect(done).toContain("https://explorer.solana.com/tx/4444");
    const failedHtml = renderToStaticMarkup(
      <OwnerActionDialog
        action={actionIn({
          phase: "failed",
          plan,
          message: "This agent is paused. Nothing changed.",
        })}
      />,
    );
    expect(failedHtml).toContain('role="alert"');
    expect(failedHtml).toContain("This agent is paused. Nothing changed.");
  });
});

describe("the request list's buttons", () => {
  const request: RequestView = {
    address: "EWTv1oLL4Si5PuWUyPVWzHFtV8waGoXTDheGgMn47toZ",
    agent: "EGj9J72oCLK1nhAMoAdWQoBisLF6usjd8u8essiAM7ch",
    nonce: "0",
    payee: "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9",
    amount: "1500000",
    reference: "0".repeat(64),
    memo: "<script>alert(1)</script>",
    status: "pending",
    createdAt: 1_000,
    expiresAt: 5_000,
    approvedAt: null,
    rentPayer: "EGj9J72oCLK1nhAMoAdWQoBisLF6usjd8u8essiAM7ch",
  };
  const names = new Map([[request.payee, "Research API"]]);
  const actions = (disabledReason: string | null) => ({
    disabledReason,
    onApprove: () => undefined,
    onReject: () => undefined,
  });

  it("approve and reject a pending request; the memo stays text", () => {
    const html = renderToStaticMarkup(
      <RequestList requests={[request]} names={names} now={2_000} actions={actions(null)} />,
    );
    expect(html).toContain('aria-label="Approve 1.50 USDC to Research API"');
    expect(html).toContain('aria-label="Reject 1.50 USDC to Research API"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('disabled=""');
  });

  it("an approved request can only be withdrawn; an expired one has no buttons", () => {
    const approved = renderToStaticMarkup(
      <RequestList
        requests={[{ ...request, status: "approved" }]}
        names={names}
        now={2_000}
        actions={actions(null)}
      />,
    );
    expect(approved).toContain("Reject");
    expect(approved).not.toContain("Approve 1.50");
    const expired = renderToStaticMarkup(
      <RequestList requests={[request]} names={names} now={5_000} actions={actions(null)} />,
    );
    expect(expired).not.toContain("<button");
  });

  it("without a wallet the buttons say why they are disabled", () => {
    const html = renderToStaticMarkup(
      <RequestList
        requests={[request]}
        names={names}
        now={2_000}
        actions={actions("Connect your wallet to make changes")}
      />,
    );
    expect(html).toContain('title="Connect your wallet to make changes"');
    expect(html).toContain('disabled=""');
  });
});
