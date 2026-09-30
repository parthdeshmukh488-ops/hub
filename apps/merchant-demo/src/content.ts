import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The merchant's content lives in `content/` as JSON and Markdown (WS8 brief), validated on load.

const ResearchSchema = z.object({
  topic: z.string(),
  snippets: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        tags: z.array(z.string()),
        summary: z.string(),
        source: z.string(),
        published: z.iso.date(),
      }),
    )
    .min(1),
});

const DecimalSchema = z.string().regex(/^-?\d+\.\d+$/, "expected a decimal string");

const MarketSchema = z.object({
  currency: z.literal("EUR"),
  asOf: z.iso.date(),
  symbols: z
    .array(
      z.object({
        symbol: z.string().regex(/^[A-Z0-9-]+$/),
        name: z.string(),
        kind: z.enum(["model", "component"]),
        price: DecimalSchema,
        change7d: DecimalSchema,
        low30d: DecimalSchema,
        high30d: DecimalSchema,
        inStock: z.number().int().nonnegative(),
        retailers: z.array(z.string()).min(1),
      }),
    )
    .min(1),
});

export type Research = z.infer<typeof ResearchSchema>;
export type Snippet = Research["snippets"][number];
export type Market = z.infer<typeof MarketSchema>;

export type Content = {
  research: Research;
  market: Market;
  premiumReport: string;
  guide: string;
};

const file = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../content/${name}`, import.meta.url)), "utf8");

export function loadContent(): Content {
  return {
    research: ResearchSchema.parse(JSON.parse(file("research.json"))),
    market: MarketSchema.parse(JSON.parse(file("market.json"))),
    premiumReport: file("premium-report.md"),
    guide: file("ebike-guide.md"),
  };
}

/**
 * Snippets matching a free-text query, best first (ties keep the content order). An empty query
 * returns the first five, so a first call always yields something useful.
 */
export function searchResearch(research: Research, query: string, limit = 5): Snippet[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return research.snippets.slice(0, limit);
  const scored = research.snippets.map((snippet, index) => {
    const tags = new Set(snippet.tags);
    const text = `${snippet.title} ${snippet.summary}`.toLowerCase();
    const score = words.reduce(
      (sum, word) => sum + (tags.has(word) ? 3 : 0) + (text.includes(word) ? 1 : 0),
      0,
    );
    return { snippet, index, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.snippet);
}
