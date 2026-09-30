import { parseUsdc, USDC_DECIMALS } from "@leash/contracts";
import { type FacilitatorClient, HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { MiddlewareHandler } from "hono";

// The merchant side (WS8): the official `@x402/hono` payment middleware, pointed at a facilitator
// that accepts Leash payments. Nothing Leash-specific happens here: a merchant is paid by a
// Leash agent exactly as by any other x402 client.

export type PaidRoute = {
  /** In token units, e.g. "0.01" for one cent of USDC. Converted exactly, never through floats. */
  price: string;
  /** This route's payee, when it is not the merchant's `payTo` (e.g. a lab route). */
  payTo?: string;
  description?: string;
  mimeType?: string;
};

export type LeashMerchantOptions = {
  /** The wallet that receives payments (the owner of the destination token account). */
  payTo: string;
  /** The facilitator: its URL, or a client object (e.g. an in-process one in tests). */
  facilitator: string | FacilitatorClient;
  /** CAIP-2, e.g. `CAIP2.devnet`. */
  network: Network;
  /** The token prices are paid in (the cluster's USDC). */
  asset: string;
  /** Decimals of `asset`. Default 6 (USDC). */
  decimals?: number;
  /** `"METHOD /path"` → price, as `@x402/hono` routes. */
  routes: Record<string, PaidRoute>;
  /** Seconds a payment payload stays valid. Default 60. */
  maxTimeoutSeconds?: number;
};

export type { FacilitatorClient };

/** Hono middleware that answers unpaid requests to `routes` with 402 and settles paid ones. */
export function leashMerchant(options: LeashMerchantOptions): MiddlewareHandler {
  const facilitator =
    typeof options.facilitator === "string"
      ? new HTTPFacilitatorClient({ url: options.facilitator })
      : options.facilitator;
  const server = new x402ResourceServer(facilitator).register(
    options.network,
    new ExactSvmScheme(),
  );
  const decimals = options.decimals ?? USDC_DECIMALS;
  const routes = Object.fromEntries(
    Object.entries(options.routes).map(([route, config]) => [
      route,
      {
        accepts: {
          scheme: "exact",
          payTo: config.payTo ?? options.payTo,
          network: options.network,
          price: { asset: options.asset, amount: parseUsdc(config.price, decimals).toString() },
          maxTimeoutSeconds: options.maxTimeoutSeconds ?? 60,
        },
        ...(config.description === undefined ? {} : { description: config.description }),
        ...(config.mimeType === undefined ? {} : { mimeType: config.mimeType }),
      },
    ]),
  );
  return paymentMiddleware(routes, server);
}
