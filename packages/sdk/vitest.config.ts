import { defineConfig } from "vitest/config";

// The evaluator, the allowance math, event decoding and the program-facing primitives must be
// fully covered (WS2 brief, 04-conventions §4). Generated code is not ours to cover.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/evaluate/**",
        "src/allowance.ts",
        "src/events.ts",
        "src/convert.ts",
        "src/pda.ts",
        "src/program-errors.ts",
      ],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
