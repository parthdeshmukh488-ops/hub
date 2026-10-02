import { defineConfig } from "@playwright/test";
import { base } from "./e2e/base.config.ts";
import { FIXTURE_PORT } from "./e2e/ports.ts";

// Browser smoke tests on the sample data (no backend, read-only): wallet connection and the
// pairing wizard up to its review.
export default defineConfig({
  ...base,
  testDir: "e2e",
  testMatch: "fixtures.spec.ts",
  use: { ...base.use, baseURL: `http://localhost:${FIXTURE_PORT}` },
  webServer: {
    command: `pnpm exec next dev --port ${FIXTURE_PORT}`,
    url: `http://localhost:${FIXTURE_PORT}/app`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_DATA_SOURCE: "fixtures", NEXT_PUBLIC_LEASH_CLUSTER: "localnet" },
  },
});
