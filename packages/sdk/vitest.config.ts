import { defineConfig } from "vitest/config";

// The evaluator and the allowance math must be fully covered (WS2 brief, 04-conventions §4).
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/evaluate/**", "src/allowance.ts"],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
