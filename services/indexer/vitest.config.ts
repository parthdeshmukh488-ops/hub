import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real sockets, a real database and LiteSVM chains: a loaded CI runner can take several times
    // longer than a laptop, and vitest's default is 5 s.
    testTimeout: 30_000,
  },
});
