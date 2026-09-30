import { defineConfig } from "vitest/config";

// 04-conventions §4: the policy evaluator, the allowance math, event decoding and the
// program-facing primitives are fully covered; reads, owner builders, LeashAgent and the testbed
// keep meaningful coverage (LiteSVM suites on the real binaries). Generated code is not ours.
const FULL = { branches: 100, functions: 100, lines: 100, statements: 100 };

export default defineConfig({
  test: {
    // LiteSVM suites run real transactions; each file builds its own chains.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**"],
      thresholds: {
        branches: 95,
        functions: 98,
        lines: 98,
        statements: 98,
        "src/evaluate/**": FULL,
        "src/allowance.ts": FULL,
        "src/events.ts": FULL,
        "src/convert.ts": FULL,
        "src/pda.ts": FULL,
        "src/program-errors.ts": FULL,
      },
    },
  },
});
