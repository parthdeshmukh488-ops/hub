import type { AgentView } from "@leash/contracts";

/** An agent as stored: the view without the allowance, which depends on the time it is read. */
export type AgentRecord = Omit<AgentView, "allowance">;

/**
 * A Subscriptions delegation as stored (JSON encodings). Chain mode fills it from the account;
 * fixture mode from the storyline's `accounts` plus every `PaymentExecuted`.
 */
export type DelegationRecord =
  | {
      kind: "recurring";
      address: string;
      agent: string;
      owner: string;
      mint: string;
      amountPerPeriod: string;
      periodLengthSecs: number;
      currentPeriodStart: number;
      pulledInPeriod: string;
      expiresAt: number | null;
    }
  | {
      kind: "fixed";
      address: string;
      agent: string;
      owner: string;
      mint: string;
      amountRemaining: string;
      expiresAt: number | null;
    };

/** The address of an allowlist entry (a PDA), known before its `PayeeAdded` event. */
export type PayeeEntryFact = { address: string; agent: string; payee: string };

/** Account facts a source reports next to events ("events give history; accounts give truth"). */
export type AccountFacts = {
  delegations: DelegationRecord[];
  payeeEntries: PayeeEntryFact[];
};
