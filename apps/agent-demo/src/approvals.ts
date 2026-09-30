import { formatUsdc, type RequestView } from "@leash/contracts";
import { fetchOpenRequests, type LeashChain } from "@leash/sdk";
import type { Address } from "@solana/kit";
import { shortId } from "./sanitize.ts";
import type { Ui } from "./ui.ts";

// Waiting for the owner (storyline step 3): after the agent asked for approval, the demo waits
// until the owner decides on-chain (web app or Telegram), then tells the model what happened.

export type OwnerWaitOptions = {
  chain: LeashChain;
  /** The Agent PDA. */
  agent: Address;
  ui: Ui;
  /** Default 180 000. */
  timeoutMs?: number;
  /** Default 2 000. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
};

type Decision = "approved" | "declined";

const describe = (request: RequestView) =>
  `${formatUsdc(BigInt(request.amount))} USDC to ${shortId(request.payee)}`;

function noteFor(request: RequestView, decision: Decision | undefined): string {
  const what = `your payment request for ${describe(request)}`;
  if (decision === "approved") {
    return `The owner approved ${what}. The same payment (the same URL, or the same recipient and amount) now goes through.`;
  }
  if (decision === "declined") {
    return `The owner declined ${what}. Do not try to pay it another way.`;
  }
  return `The owner has not answered ${what} yet. Continue without it.`;
}

/** Waits for the owner's decision on the agent's pending requests; the note for the model, or null if none is pending. */
export function ownerDecisions(options: OwnerWaitOptions): () => Promise<string | null> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const clock = options.clock ?? Date.now;
  return async () => {
    const pending = (await fetchOpenRequests(options.chain, options.agent)).filter(
      (request) => request.status === "pending",
    );
    if (pending.length === 0) return null;
    for (const request of pending) {
      options.ui.waiting(
        `Waiting for the owner to approve ${describe(request)} (request ${shortId(request.address)})…`,
      );
    }
    const decided = new Map<string, Decision>();
    const deadline = clock() + (options.timeoutMs ?? 180_000);
    while (decided.size < pending.length && clock() < deadline) {
      await sleep(options.pollMs ?? 2_000);
      let open: RequestView[];
      try {
        open = await fetchOpenRequests(options.chain, options.agent);
      } catch {
        continue;
      }
      for (const request of pending) {
        if (decided.has(request.address)) continue;
        const now = open.find((candidate) => candidate.address === request.address);
        // Rejected and expired requests are closed; only an approved one stays open.
        if (!now) decided.set(request.address, "declined");
        else if (now.status === "approved") decided.set(request.address, "approved");
      }
    }
    for (const request of pending) {
      const decision = decided.get(request.address);
      options.ui.waiting(
        decision === "approved"
          ? `The owner approved ${describe(request)}.`
          : decision === "declined"
            ? `The owner declined ${describe(request)}.`
            : `No answer from the owner for ${describe(request)}.`,
      );
    }
    return `Update from Leash: ${pending.map((r) => noteFor(r, decided.get(r.address))).join(" ")}`;
  };
}
