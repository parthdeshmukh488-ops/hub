import { referenceToHex } from "@leash/contracts";
import {
  type LeashAgent,
  type LeashChain,
  LeashNetworkError,
  MerchantRejectedError,
  UnsupportedPaymentError,
} from "@leash/sdk";
import type { Network, SettleResponse } from "@x402/core/types";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { LeashExactSvmScheme } from "./scheme.ts";

// `leashFetch`: the official x402 fetch wrapper with the Leash scheme registered. It matches the
// `LeashFetchPort` of @leash/tools (packages/tools/src/ports.ts) and throws only the SDK's typed
// errors: PaymentDeniedError, UnsupportedPaymentError, MerchantRejectedError, LeashNetworkError.

export type LeashFetchRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | undefined;
  /** Stored on-chain as the payment's memo; at most 64 bytes of UTF-8. */
  purpose: string;
};

/** A settled x402 payment. The first six fields are @leash/tools' `PaymentResult`. */
export type LeashFetchPayment = {
  signature: string;
  amount: bigint;
  payee: string;
  payeeLabel: string | null;
  purpose: string;
  requestNonce: bigint | null;
  /** Lowercase hex: the approved request's reference, or sha256(memo). */
  reference: string;
  /** The text of the transaction's Memo instruction. */
  memo: string;
};

export type LeashFetchResult = {
  status: number;
  contentType: string;
  body: string;
  payment: LeashFetchPayment | null;
};

export type LeashFetchOptions = {
  agent: LeashAgent;
  chain: LeashChain;
  /** The CAIP-2 network the agent pays on (`CAIP2.devnet` or `CAIP2.localnet`). */
  network: Network;
  /** The underlying fetch. Default: the global one. */
  fetch?: typeof globalThis.fetch;
  priorityFeeMicroLamports?: bigint;
};

const PAYMENT_RESPONSE_HEADERS = ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"];

function settlementOf(response: Response): SettleResponse | null {
  for (const name of PAYMENT_RESPONSE_HEADERS) {
    const header = response.headers.get(name);
    if (!header) continue;
    try {
      return decodePaymentResponseHeader(header);
    } catch {
      return null;
    }
  }
  return null;
}

/** An HTTP fetch that pays x402 challenges through Leash (02-contracts §9). */
export function createLeashFetch(
  options: LeashFetchOptions,
): (request: LeashFetchRequest) => Promise<LeashFetchResult> {
  return async (request) => {
    const scheme = new LeashExactSvmScheme({ ...options, purpose: request.purpose });
    // Leash's on-chain policy is the spend control. The client's own default (known USDC mints
    // only, at most $1 a payment) would refuse localnet's mint and every approved larger payment.
    const client = new x402Client().register(options.network, scheme).setSpendControls(false);
    const paidFetch = wrapFetchWithPayment(options.fetch ?? globalThis.fetch, client);

    let response: Response;
    try {
      response = await paidFetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
    } catch (error) {
      // The wrapper rethrows the scheme's typed errors as plain ones: use the originals.
      if (scheme.lastError !== null) throw scheme.lastError;
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("Failed to parse payment requirements")) {
        throw new UnsupportedPaymentError("malformed payment requirements");
      }
      if (message.startsWith("Failed to create payment payload")) {
        throw new UnsupportedPaymentError("no payment option this agent can pay");
      }
      throw new LeashNetworkError("the merchant is unreachable");
    }

    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const offered = scheme.lastPayment;
    if (offered === null) return { status: response.status, contentType, body, payment: null };

    const settlement = settlementOf(response);
    if (!settlement?.success) {
      throw new MerchantRejectedError(settlement?.errorReason ?? `status ${response.status}`);
    }
    return {
      status: response.status,
      contentType,
      body,
      payment: {
        signature: settlement.transaction,
        amount: offered.amount,
        payee: offered.payTo,
        payeeLabel: offered.payeeLabel,
        purpose: offered.purpose,
        requestNonce: offered.requestNonce,
        reference: referenceToHex(offered.reference),
        memo: offered.memo,
      },
    };
  };
}
