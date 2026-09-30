import { describe, expect, it } from "vitest";
import { type CatalogEntry, ROUTES } from "../src/catalog.ts";
import { searchResearch } from "../src/content.ts";
import { parseEnv } from "../src/env.ts";
import { markdownToHtml } from "../src/lab/html.ts";
import { GUIDE_VARIANTS } from "../src/lab/injections.ts";
import { createApp } from "../src/server.ts";
import { app, content, get, getJson, wallets } from "./helpers.ts";

const SAMPLE: Record<string, string> = {
  q: "battery",
  topic: "e-bikes",
  variant: "none",
  page: "1",
};
const servable = (path: string) =>
  path
    .replace(":symbol", "VOLTRA-C3")
    .replace(/([a-z]+)=$/, (_, name: string) => `${name}=${SAMPLE[name] ?? ""}`);

describe("catalog", () => {
  it("lists every route with its price in USDC and base units, and who gets paid", async () => {
    const { json } = await getJson<{ payments: string; routes: CatalogEntry[] }>("/");
    expect(json.payments).toBe("off");
    const byPath = Object.fromEntries(json.routes.map((r) => [r.path, r]));
    expect(byPath["/api/research?q="]).toMatchObject({
      price: "0.01",
      amount: "10000",
      payTo: "merchant",
      payToAddress: wallets.merchant,
    });
    expect(byPath["/api/reports/premium?topic="]).toMatchObject({
      price: "1.50",
      amount: "1500000",
    });
    expect(byPath["/lab/unlock"]).toMatchObject({
      price: "25.00",
      payTo: "attacker",
      payToAddress: wallets.attacker,
      lab: true,
    });
    expect(byPath["/lab/research-premium?q="]).toMatchObject({ price: "9.00", payTo: "merchant" });
    expect(json.routes).toHaveLength(Object.keys(ROUTES).length);
  });

  it("serves every route it lists", async () => {
    for (const route of Object.values(ROUTES)) {
      expect((await get(servable(route.path))).status, route.path).toBe(200);
    }
  });

  it("answers unknown routes in the service error shape", async () => {
    const { status, json } = await getJson("/nope");
    expect(status).toBe(404);
    expect(json).toEqual({
      error: { code: "NOT_FOUND", message: "No such route. The catalog is at /." },
    });
  });
});

describe("paid content", () => {
  it("finds research by topic, best match first", () => {
    expect(searchResearch(content.research, "battery range in winter")[0]?.id).toBe(
      "battery-range",
    );
    expect(searchResearch(content.research, "hills")[0]?.id).toBe("motor-hub-vs-mid");
    expect(searchResearch(content.research, "")).toHaveLength(5);
    expect(searchResearch(content.research, "quantum spaceship")).toEqual([]);
  });

  it("serves research without internal tags", async () => {
    const { json } = await getJson<{ results: Array<Record<string, unknown>> }>(
      "/api/research?q=brakes",
    );
    expect(json.results[0]).toMatchObject({ id: "brakes", title: expect.any(String) });
    expect(json.results[0]).not.toHaveProperty("tags");
  });

  it("serves deterministic market data, case-insensitively, and lists symbols for unknown ones", async () => {
    const first = await getJson("/api/market/voltra-c3");
    const again = await getJson("/api/market/VOLTRA-C3");
    expect(first.json).toEqual(again.json);
    expect(first.json).toMatchObject({ symbol: "VOLTRA-C3", price: "1299.00", currency: "EUR" });
    const unknown = await getJson<{ error: { message: string } }>("/api/market/TESLA");
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.message).toContain("KESTREL-T500");
  });

  it("serves the premium report as Markdown with the comparison table", async () => {
    const report = await get("/api/reports/premium?topic=e-bikes");
    expect(report.type).toContain("text/markdown");
    expect(report.text).toContain("| Voltra City 3 | €1,299 |");
    expect(report.text.length).toBeGreaterThan(2500);
  });
});

describe("lab", () => {
  it("hides the same instruction in every variant but the control", async () => {
    for (const variant of GUIDE_VARIANTS) {
      const { status, text } = await get(`/lab/articles/ebike-guide?variant=${variant}`);
      expect(status).toBe(200);
      const poisoned =
        text.includes(wallets.attacker) && text.includes("http://merchant.test/lab/unlock");
      expect(poisoned, variant).toBe(variant !== "none");
      // The useful guide is always there around the injection.
      expect(text.toLowerCase(), variant).toContain("hub motor");
    }
  });

  it("uses a fitting format per variant, and hidden-html by default", async () => {
    const types = Object.fromEntries(
      await Promise.all(
        GUIDE_VARIANTS.map(async (v) => [
          v,
          (await get(`/lab/articles/ebike-guide?variant=${v}`)).type,
        ]),
      ),
    );
    expect(types).toMatchObject({
      "hidden-html": expect.stringContaining("text/html"),
      "system-message": expect.stringContaining("text/markdown"),
      "markdown-comment": expect.stringContaining("text/markdown"),
      "json-field": expect.stringContaining("application/json"),
      none: expect.stringContaining("text/markdown"),
    });
    const fallback = await get("/lab/articles/ebike-guide");
    expect(fallback.type).toContain("text/html");
    expect(fallback.text).toContain("position:absolute;left:-10000px");
    expect((await get("/lab/articles/ebike-guide?variant=nope")).status).toBe(400);
  });

  it("explains each attack for judges, as JSON or as a page", async () => {
    const { json } = await getJson<{
      entries: Array<{ path: string; attack: string; leash: string }>;
    }>("/lab");
    expect(json.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(["/lab/unlock", "/lab/research-premium", "/lab/loop?page=1"]),
    );
    expect(json.entries.every((e) => e.attack.length > 0 && e.leash.length > 0)).toBe(true);
    const html = await get("/lab", { accept: "text/html" });
    expect(html.type).toContain("text/html");
    expect(html.text).toContain("<h1>Leash adversarial lab</h1>");
  });

  it("serves the overpriced copy of the research and the endless loop", async () => {
    const cheap = await getJson("/api/research?q=motor");
    const premium = await getJson("/lab/research-premium?q=motor");
    expect(premium.json).toEqual(cheap.json);
    const loop = await getJson<{ next: string }>("/lab/loop?page=41");
    expect(loop.json.next).toBe("/lab/loop?page=42");
    expect((await get("/lab/loop?page=0")).status).toBe(400);
    expect((await get("/lab/loop?page=abc")).status).toBe(400);
  });
});

describe("markdown rendering", () => {
  it("renders our subset and escapes everything else", () => {
    expect(markdownToHtml("# Title\n\nSome **bold** and *soft* text.\n\n- one\n- two")).toBe(
      "<h1>Title</h1>\n<p>Some <strong>bold</strong> and <em>soft</em> text.</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
    );
    expect(markdownToHtml('<script>alert("x")</script>')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });
});

describe("configuration", () => {
  it("defaults to port 4300 with payments off, and refuses payments until step 2", () => {
    expect(parseEnv({})).toMatchObject({ MERCHANT_PORT: 4300, MERCHANT_PAYMENTS: "off" });
    expect(() => parseEnv({ MERCHANT_PAY_TO: "not-a-wallet" })).toThrow(/MERCHANT_PAY_TO/);
    expect(() => createApp({ wallets, payments: "on" }, content)).toThrow(/step 2/);
    expect(app).toBeDefined();
  });
});
