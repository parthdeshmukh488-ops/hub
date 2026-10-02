import { defineConfig } from "@playwright/test";
import { base } from "./e2e/base.config.ts";
import { LIVE_PORTS } from "./e2e/ports.ts";

// Browser tests of the owner's writes on the real programs: the LiteSVM testbed behind a JSON-RPC
// endpoint, the indexer in chain mode, the app in live mode (e2e/live-stack.ts).
export default defineConfig({
  ...base,
  testDir: "e2e",
  testMatch: "live.spec.ts",
  use: { ...base.use, baseURL: `http://localhost:${LIVE_PORTS.app}` },
  webServer: {
    command: "pnpm exec tsx e2e/live-stack.ts",
    url: `http://localhost:${LIVE_PORTS.app}/app`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
