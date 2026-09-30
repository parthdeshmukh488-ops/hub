import { formatUsdc, type LeashStatusOutput } from "@leash/contracts";
import { rollWindow } from "@leash/sdk";
import type { AgentStatusSnapshot } from "./ports.ts";

const usdc = (baseUnits: string) => formatUsdc(BigInt(baseUnits));

/** Counter of a Leash window at `now` (0 once the window has ended, 01-onchain-program §7.2). */
function rolled(start: number | null, secs: number, counter: bigint, now: number): bigint {
  return rollWindow(BigInt(start ?? 0), secs, counter, BigInt(now)).counter;
}

/** `leash_status` (02-contracts §8) from the agent's current views. */
export function statusOutput(
  snapshot: AgentStatusSnapshot,
): Extract<LeashStatusOutput, { ok: true }> {
  const { principal, agent, payees, now } = snapshot;
  const { allowance, policy, stats } = agent;
  const paused = principal.frozen;

  return {
    ok: true,
    agent: {
      label: agent.label,
      status: paused || agent.status === "frozen" ? "frozen" : "active",
      freezeReason: paused
        ? principal.frozenBy === principal.owner
          ? "owner"
          : "guardian"
        : agent.freezeReason,
    },
    allowance: {
      remainingUsdc: allowance ? usdc(allowance.remaining) : "0.00",
      perPeriodUsdc: allowance?.amountPerPeriod ? usdc(allowance.amountPerPeriod) : null,
      periodEndsAt:
        allowance?.currentPeriodStart != null && allowance.periodLengthSecs != null
          ? allowance.currentPeriodStart + allowance.periodLengthSecs
          : null,
      expiresAt: allowance?.expiresAt ?? null,
    },
    limits: {
      maxPerPaymentUsdc: usdc(policy.maxPerPayment),
      maxPerRequestUsdc: usdc(policy.maxPerRequest),
    },
    payees: payees.map((payee) => {
      const limit = BigInt(payee.periodLimit);
      const spent = rolled(payee.periodStart, payee.periodSecs, BigInt(payee.spentInPeriod), now);
      return {
        label: payee.label,
        wallet: payee.payee,
        maxPerPaymentUsdc: payee.maxPerPayment === "0" ? null : usdc(payee.maxPerPayment),
        remainingInPeriodUsdc: limit === 0n ? null : formatUsdc(limit > spent ? limit - spent : 0n),
      };
    }),
    strikes:
      policy.tripwireMaxStrikes === 0
        ? 0
        : Number(
            rolled(stats.strikeWindowStart, policy.tripwireWindowSecs, BigInt(stats.strikes), now),
          ),
    tripwireMaxStrikes: policy.tripwireMaxStrikes,
  };
}
