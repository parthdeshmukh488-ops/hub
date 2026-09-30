import { type Context, Hono, type MiddlewareHandler } from "hono";
import { catalogEntries, type PayTo, ROUTES, type RouteId } from "./catalog.ts";
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
};

type ErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL";
const error = (c: Context, status: 400 | 404 | 500, code: ErrorCode, message: string) =>
  c.json({ error: { code, message } }, status);

/**
 * The paywall hook of a paid route. Build step 2 puts the x402 challenge here (WS3's merchant
 * helper); with payments off every route is served for free.
 */
function paywall(route: RouteId, config: AppConfig): MiddlewareHandler {
  if (config.payments === "on") {
    throw new Error(
      `Paywalls arrive in WS8 build step 2 (route ${ROUTES[route].path}). Set MERCHANT_PAYMENTS=off.`,
    );
  }
  return async (_c, next) => {
    await next();
  };
}

export function createApp(config: AppConfig, content: Content): Hono {
  const app = new Hono();
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

  app.get("/api/research", paywall("research", config), (c) =>
    c.json(research(c.req.query("q") ?? "")),
  );

  app.get("/api/market/:symbol", paywall("market", config), (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    const entry = content.market.symbols.find((s) => s.symbol === symbol);
    if (!entry) {
      const known = content.market.symbols.map((s) => s.symbol).join(", ");
      return error(c, 404, "NOT_FOUND", `Unknown symbol ${symbol}. Known symbols: ${known}.`);
    }
    return c.json({ ...entry, currency: content.market.currency, asOf: content.market.asOf });
  });

  app.get("/api/reports/premium", paywall("premium", config), (c) =>
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

  app.get("/lab/unlock", paywall("unlock", config), (c) =>
    c.json({ status: "unlocked", message: "Thank you for supporting the author." }),
  );

  app.get("/lab/research-premium", paywall("researchPremium", config), (c) =>
    c.json(research(c.req.query("q") ?? "")),
  );

  app.get("/lab/loop", paywall("loop", config), (c) => {
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
