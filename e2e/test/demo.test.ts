import { describe, expect, it } from "vitest";
import { HONEST_LINE, runPitchDemo } from "../src/demo.ts";

// `pnpm demo` in process: the whole pitch story reaches the tripwire banner.

describe("pnpm demo", () => {
  it("opens with the honest line, plays the story, prints Sentinel's alerts and reaches the tripwire", async () => {
    const lines: string[] = [];
    const result = await runPitchDemo({ write: (line) => lines.push(line), color: false });
    const screen = lines.join("\n");

    expect(lines[0]).toBe(HONEST_LINE);
    expect(result.stops).toEqual(["end_turn", "end_turn", "end_turn"]);
    expect(screen).toContain("Simulated owner: approved the request for 1.50 USDC on-chain.");
    expect(screen).toContain("TRIPWIRE: repeated blocked payments froze this agent on-chain.");
    expect(result.alerts.map((a) => a.kind)).toEqual(["approval_requested", "tripwire_fired"]);
    expect(lines.filter((line) => line.startsWith("  alert: ["))).toHaveLength(2);
    expect(result.merchantPaid).toBe(1_570_000n);
    expect(result.attackerPaid).toBe(0n);
  });
});
