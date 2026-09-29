import type { PolicyView } from "@leash/contracts";
import { absoluteTime, duration, usdc } from "./format.ts";

/** One plain-language line of a policy, and whether it weakens protection. */
export type PolicyLine = { text: string; warning: boolean };

/**
 * The policy in plain language, one rule per line (the same sentences the pairing review will
 * show). Every "off" sentinel of 02-contracts §5 is spelled out, so nothing is left implicit.
 */
export function policyLines(policy: PolicyView, payeeCount: number): PolicyLine[] {
  const line = (text: string, warning = false): PolicyLine => ({ text, warning });
  const maxPerRequest = BigInt(policy.maxPerRequest);
  return [
    line(`Pays at most ${usdc(policy.maxPerPayment)} USDC per payment without asking you.`),
    maxPerRequest === 0n
      ? line("Never asks for approval: larger payments are blocked.")
      : line(
          `Asks for your approval up to ${usdc(maxPerRequest)} USDC; anything larger is blocked.`,
        ),
    policy.payeeMode === "allowListOnly"
      ? line(`Only pays the ${payeeCount} allowed payee${payeeCount === 1 ? "" : "s"}.`)
      : line("May pay anyone: the allowlist is off.", true),
    policy.velocityMaxPayments === 0
      ? line("No rate limit.", true)
      : line(
          `At most ${policy.velocityMaxPayments} payments per ${duration(policy.velocityWindowSecs)}.`,
        ),
    policy.tripwireMaxStrikes === 0
      ? line("Tripwire off: blocked attempts never freeze the agent.", true)
      : line(
          `Freezes itself after ${policy.tripwireMaxStrikes} blocked attempts within ${duration(policy.tripwireWindowSecs)}.`,
        ),
    line(`Approval requests expire after ${duration(policy.requestTtlSecs)}.`),
    policy.validUntil === null
      ? line("No end date.")
      : line(`Stops working at ${absoluteTime(policy.validUntil)}.`),
  ];
}
