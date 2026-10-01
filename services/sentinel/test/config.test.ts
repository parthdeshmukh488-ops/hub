import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.ts";

describe("sentinel.config.json", () => {
  it("is committed with exactly the defaults", () => {
    const file = JSON.parse(
      readFileSync(new URL("../sentinel.config.json", import.meta.url), "utf8"),
    );
    expect(parseConfig(file)).toEqual(DEFAULT_CONFIG);
    expect(file).toEqual(DEFAULT_CONFIG);
  });

  it("keeps the brief's thresholds and leaves Action links off", () => {
    expect(DEFAULT_CONFIG.actionLinks).toBe(false);
    expect(DEFAULT_CONFIG.rules.burstDenials).toMatchObject({ minDenials: 3, windowSecs: 300 });
    expect(DEFAULT_CONFIG.rules.spendSpike).toMatchObject({
      windowSecs: 600,
      baselineSecs: 3600,
      multiplier: 3,
      minAmount: "1000000",
    });
    expect(DEFAULT_CONFIG.rules.newPayeeSpend).toMatchObject({ windowSecs: 600, capPercent: 50 });
    expect(DEFAULT_CONFIG.rules.allowanceLow.remainingPercent).toBe(10);
  });

  it("fills in what a partial file leaves out", () => {
    const config = parseConfig({ actionLinks: true, rules: { burstDenials: { minDenials: 5 } } });
    expect(config.actionLinks).toBe(true);
    expect(config.rules.burstDenials).toEqual({ enabled: true, minDenials: 5, windowSecs: 300 });
    expect(config.rules.spendSpike).toEqual(DEFAULT_CONFIG.rules.spendSpike);
  });

  it("rejects typos and bad values with a readable message", () => {
    expect(() => parseConfig({ actionlinks: true })).toThrow(/Invalid sentinel.config.json/);
    expect(() => parseConfig({ rules: { spendSpike: { minAmount: "1.5" } } })).toThrow(/minAmount/);
    expect(() => parseConfig({ rules: { newPayeeSpend: { capPercent: 0 } } })).toThrow(
      /capPercent/,
    );
  });
});
