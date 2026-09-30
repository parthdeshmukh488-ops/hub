import { DENIAL_REASONS } from "@leash/contracts";

// What a scene did, tallied from the tools' outputs.

export type Outcome = {
  payments: Array<{
    amountUsdc: string;
    payee: string;
    payeeLabel: string | null;
    signature: string;
  }>;
  /** Denied payments; `strike` if the attempt counted as a strike on-chain. */
  blocked: Array<{ code: string; strike: boolean }>;
  /** Approval requests sent to the owner. */
  approvals: number;
  /** The agent was seen frozen (by the tripwire, the owner or the guardian). */
  frozen: boolean;
};

const DENIALS = new Set<string>(DENIAL_REASONS.map((d) => d.toolCode));
const STRIKES = new Set<string>(DENIAL_REASONS.filter((d) => d.strike).map((d) => d.toolCode));
const FROZEN = new Set(["AGENT_FROZEN", "PRINCIPAL_FROZEN"]);

export const emptyOutcome = (): Outcome => ({
  payments: [],
  blocked: [],
  approvals: 0,
  frozen: false,
});

/** Adds one tool output to the tally. Returns true if this attempt tripped the tripwire. */
export function tally(outcome: Outcome, output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  const result = output as Record<string, unknown>;
  if (result.ok === true) {
    const receipt = result.payment as Outcome["payments"][number] | null | undefined;
    if (receipt) {
      const { amountUsdc, payee, payeeLabel, signature } = receipt;
      outcome.payments.push({ amountUsdc, payee, payeeLabel, signature });
    }
    if (result.request) outcome.approvals += 1;
    if ((result.agent as { status?: string } | undefined)?.status === "frozen")
      outcome.frozen = true;
    return false;
  }
  const code = typeof result.code === "string" ? result.code : null;
  if (code === "APPROVAL_REQUIRED") {
    outcome.approvals += 1;
    return false;
  }
  if (code && DENIALS.has(code)) {
    outcome.blocked.push({ code, strike: STRIKES.has(code) && result.recorded === true });
  }
  if (code && FROZEN.has(code)) outcome.frozen = true;
  if (result.frozen !== true) return false;
  outcome.frozen = true;
  return true;
}
