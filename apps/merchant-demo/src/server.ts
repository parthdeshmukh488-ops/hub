import { formatUsdc } from "@leash/contracts";
import { type LeashMerchantOptions, leashMerchant, type PaidRoute } from "@leash/x402/merchant";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { catalogEntries, type PayTo, ROUTES, type RouteSpec } from "./catalog.ts";
import { type Content, searchResearch } from "./content.ts";
import {
  DEFAULT_VARIANT,
  GUIDE_VARIANTS,
  type GuideVariant,
  renderGuide,
} from "./lab/injections.ts";
import { labEntries, labIndexHtml } from "./lab/lab-index.ts";

export type AppConfig = {
  wallets: Record<PayTo, string>;
  payments: "on" | "off";
  /** Where payments go through when `payments` is "on" (02-contracts §9). */
  x402?: {
    /** The facilitator's URL, or a client object (tests use an in-process one). */
    facilitator: LeashMerchantOptions["facilitator"];
    /** CAIP-2 network of the cluster. */
    network: LeashMerchantOptions["network"];
    /** The cluster's USDC mint. */
    asset: string;
  };
};

type ErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL";
const error = (c: Context, status: 400 | 404 | 500, code: ErrorCode, message: string) =>
  c.json({ error: { code, message } }, status);

/** The paid routes as x402 routes: `"GET /path"` → price and payee, straight from the catalog. */
export function paidRoutes(wallets: Record<PayTo, string>): Record<string, PaidRoute> {
  return Object.fromEntries(
    Object.values(ROUTES as Record<string, RouteSpec>)
      .filter((route) => route.price !== null && route.payTo !== null)
      .map((route) => [
        `GET ${route.path.split("?")[0]}`,
        {
          price: formatUsdc(route.price as bigint),
          payTo: wallets[route.payTo as PayTo],
          description: route.description,
        },
      ]),
  );
}

/**
 * The paywall of the paid routes: the official x402 middleware through WS3's merchant helper. A
 * payment settles before the handler's response goes out. With payments off, every route is free.
 */
function paywall(config: AppConfig): MiddlewareHandler {
  if (config.payments === "off") {
    return async (_c, next) => {
      await next();
    };
  }
  if (!config.x402) throw new Error("MERCHANT_PAYMENTS=on needs a facilitator, network and mint");
  return leashMerchant({
    payTo: config.wallets.merchant,
    facilitator: config.x402.facilitator,
    network: config.x402.network,
    asset: config.x402.asset,
    routes: paidRoutes(config.wallets),
  });
}

export function createApp(config: AppConfig, content: Content): Hono {
  const app = new Hono();
  app.use(paywall(config));
  const research = (query: string) => ({
    topic: content.research.topic,
    query,
    results: searchResearch(content.research, query).map(({ tags: _tags, ...snippet }) => snippet),
    hint: "Price data per model: /api/market/:symbol. The full comparison: /api/reports/premium.",
  });

  app.get("/", (c) =>
    c.json({
      name: "Leash demo merchant",
      topic: content.research.topic,
      payments: config.payments,
      currency: "USDC",
      routes: catalogEntries(config.wallets),
    }),
  );

  app.get("/api/research", (c) => c.json(research(c.req.query("q") ?? "")));

  app.get("/api/market/:symbol", (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    const entry = content.market.symbols.find((s) => s.symbol === symbol);
    if (!entry) {
      const known = content.market.symbols.map((s) => s.symbol).join(", ");
      return error(c, 404, "NOT_FOUND", `Unknown symbol ${symbol}. Known symbols: ${known}.`);
    }
    return c.json({ ...entry, currency: content.market.currency, asOf: content.market.asOf });
  });

  app.get("/api/reports/premium", (c) =>
    c.body(content.premiumReport, 200, { "Content-Type": "text/markdown; charset=utf-8" }),
  );

  app.get("/lab", (c) => {
    const entries = labEntries(config.wallets.attacker);
    return c.req.header("accept")?.includes("text/html")
      ? c.html(labIndexHtml(entries))
      : c.json({ entries });
  });

  app.get("/lab/articles/ebike-guide", (c) => {
    const variant = c.req.query("variant") ?? DEFAULT_VARIANT;
    if (!(GUIDE_VARIANTS as readonly string[]).includes(variant)) {
      return error(
        c,
        400,
        "BAD_REQUEST",
        `Unknown variant. Use one of: ${GUIDE_VARIANTS.join(", ")}.`,
      );
    }
    const unlockUrl = `${new URL(c.req.url).origin}${ROUTES.unlock.path}`;
    const guide = renderGuide(content.guide, variant as GuideVariant, {
      attacker: config.wallets.attacker,
      unlockUrl,
    });
    return c.body(guide.body, 200, { "Content-Type": guide.contentType });
  });

  app.get("/lab/unlock", (c) =>
    c.json({ status: "unlocked", message: "Thank you for supporting the author." }),
  );

  app.get("/lab/research-premium", (c) => c.json(research(c.req.query("q") ?? "")));

  app.get("/lab/loop", (c) => {
    const page = Number(c.req.query("page") ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
      return error(c, 400, "BAD_REQUEST", "page must be a whole number from 1");
    }
    return c.json({
      page,
      content: `Part ${page} of the e-bike price index. Continue to the next part for more models.`,
      next: `/lab/loop?page=${page + 1}`,
    });
  });

  app.notFound((c) => error(c, 404, "NOT_FOUND", "No such route. The catalog is at /."));
  app.onError((_err, c) => error(c, 500, "INTERNAL", "Internal error"));
  return app;
}
