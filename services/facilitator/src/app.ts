import { getConnInfo } from "@hono/node-server/conninfo";
import { decompileTransactionMessage, getCompiledTransactionMessageDecoder } from "@solana/kit";
import type { x402Facilitator } from "@x402/core/facilitator";
import { isPaymentPayloadV2, isPaymentRequirementsV2 } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { decodeTransactionFromPayload, MEMO_PROGRAM_ADDRESS } from "@x402/svm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { Logger } from "./logger.ts";
import type { RateLimiter } from "./rate-limit.ts";

// The x402 v2 facilitator HTTP interface (`POST /verify`, `POST /settle`, `GET /supported`) around
// the official scheme, plus `GET /health`. Verification itself is entirely `@x402/svm`'s.

export type AppOptions = {
  facilitator: x402Facilitator;
  log: Logger;
  cluster: string;
  /** The fee payer's address, reported by /health. */
  feePayer: string;
  webOrigin: string;
  rateLimiter: RateLimiter;
  /** The client a request counts against. Default: the socket's remote address. */
  clientOf?: (c: Context) => string;
};

type FacilitatorRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

/** Programs a standard (static-path) payment may contain; anything else is a smart wallet. */
const STATIC_PROGRAMS = new Set<string>([
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  MEMO_PROGRAM_ADDRESS,
]);

/** Which verification path a payment takes, for the logs: "static" or "smartWallet". */
export function verificationPath(
  payload: PaymentPayload,
): "static" | "smartWallet" | "undecodable" {
  try {
    const transaction = decodeTransactionFromPayload(payload.payload as { transaction: string });
    const message = decompileTransactionMessage(
      getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
    );
    const programs = ([...message.instructions] as { programAddress: string }[]).map(
      (ix) => ix.programAddress,
    );
    return programs.every((p) => STATIC_PROGRAMS.has(p)) ? "static" : "smartWallet";
  } catch {
    return "undecodable";
  }
}

function parseRequest(body: unknown): FacilitatorRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { paymentPayload, paymentRequirements } = body as Record<string, unknown>;
  // The official guards type networks as plain strings; the payment types want CAIP-2.
  return isPaymentPayloadV2(paymentPayload) && isPaymentRequirementsV2(paymentRequirements)
    ? {
        paymentPayload: paymentPayload as PaymentPayload,
        paymentRequirements: paymentRequirements as PaymentRequirements,
      }
    : null;
}

const defaultClientOf = (c: Context): string => {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
};

export function createApp(options: AppOptions): Hono {
  const { facilitator, log, rateLimiter } = options;
  const clientOf = options.clientOf ?? defaultClientOf;
  const app = new Hono();
  app.use("*", cors({ origin: options.webOrigin }));
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "facilitator",
      cluster: options.cluster,
      feePayer: options.feePayer,
      networks: facilitator.getSupported().kinds.map((kind) => kind.network),
    }),
  );
  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  const handle =
    (kind: "verify" | "settle") =>
    async (c: Context): Promise<Response> => {
      const client = clientOf(c);
      if (!rateLimiter.allow(client)) {
        log.warn({ event: kind, client }, "rate limited");
        return c.json({ error: "rate_limited" }, 429);
      }
      const request = parseRequest(await c.req.json().catch(() => null));
      if (request === null) return c.json({ error: "invalid_request" }, 400);
      const { paymentPayload, paymentRequirements } = request;
      const context = {
        event: kind,
        client,
        network: paymentRequirements.network,
        payTo: paymentRequirements.payTo,
        amount: paymentRequirements.amount,
        verificationPath: verificationPath(paymentPayload),
      };
      // How long the official scheme took (its RPC calls; for settle also the confirmation).
      const started = performance.now();
      const ms = () => Math.round(performance.now() - started);
      try {
        if (kind === "verify") {
          const result = await facilitator.verify(paymentPayload, paymentRequirements);
          log.info(
            {
              ...context,
              isValid: result.isValid,
              invalidReason: result.invalidReason,
              payer: result.payer,
              ms: ms(),
            },
            "verify",
          );
          return c.json(result);
        }
        const result = await facilitator.settle(paymentPayload, paymentRequirements);
        log.info(
          {
            ...context,
            success: result.success,
            errorReason: result.errorReason,
            transaction: result.transaction,
            payer: result.payer,
            ms: ms(),
          },
          "settle",
        );
        return c.json(result);
      } catch (error) {
        // An unsupported scheme or network: the official facilitator throws.
        log.warn({ ...context, err: error }, `${kind} refused`);
        return c.json({ error: error instanceof Error ? error.message : "refused" }, 400);
      }
    };
  app.post("/verify", handle("verify"));
  app.post("/settle", handle("settle"));
  return app;
}
