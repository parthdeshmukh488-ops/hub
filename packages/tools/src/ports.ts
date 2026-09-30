import type { AgentView, PayeeView, PrincipalView } from "@leash/contracts";

// The two things the tools need from the rest of Leash. `@leash/sdk`'s `LeashAgent` implements
// `LeashAgentPort` and `@leash/x402`'s `leashFetch` implements `LeashFetchPort` (messages to WS2
// and WS3). Both throw only the SDK's typed errors: PaymentDeniedError, ApprovalNotPossibleError,
// NotPairedError, UnsupportedPaymentError, MerchantRejectedError, LeashNetworkError.

/** A payment that went through. `purpose` is the memo as stored on-chain. */
export type PaymentResult = {
  signature: string;
  /** Base units. */
  amount: bigint;
  /** The wallet that was paid (owner of the destination token account). */
  payee: string;
  /** The allowlist label, if the payee is on it. */
  payeeLabel: string | null;
  purpose: string;
  /** Set when the payment used an approved request. */
  requestNonce: bigint | null;
};

/** Everything `leash_status` reports, read at `now` (unix seconds). */
export type AgentStatusSnapshot = {
  principal: PrincipalView;
  agent: AgentView;
  payees: PayeeView[];
  now: number;
};

export type PendingRequest = { address: string; nonce: bigint; expiresAt: number };

export interface LeashAgentPort {
  status(): Promise<AgentStatusSnapshot>;
  /** Pays `amount` base units to `to`, using an approved request for that payee and amount if one exists. */
  pay(args: { to: string; amount: bigint; purpose: string }): Promise<PaymentResult>;
  requestApproval(args: { to: string; amount: bigint; purpose: string }): Promise<PendingRequest>;
}

export type FetchRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | undefined;
  /** The memo for a payment, already cut to 64 bytes. */
  purpose: string;
};

export type FetchResult = {
  status: number;
  contentType: string;
  body: string;
  payment: PaymentResult | null;
};

/** An HTTP fetch that pays x402 challenges through Leash (02-contracts §9). */
export type LeashFetchPort = (request: FetchRequest) => Promise<FetchResult>;
