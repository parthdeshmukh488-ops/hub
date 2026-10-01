import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real sockets: a loaded CI runner can take several times longer than a laptop.
    testTimeout: 30_000,
  },
});
