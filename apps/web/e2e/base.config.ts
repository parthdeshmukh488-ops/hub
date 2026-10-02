import { defineConfig, devices } from "@playwright/test";

/** What both browser suites share: Chromium (pre-installed), one worker, traces on failure. */
export const base = defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { trace: "retain-on-failure", viewport: { width: 1280, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
