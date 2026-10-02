import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The whole system on LiteSVM, with real sockets: a loaded CI runner is slow.
    testTimeout: 120_000,
  },
});
