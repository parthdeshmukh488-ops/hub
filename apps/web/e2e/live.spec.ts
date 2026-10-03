import { expect, test } from "@playwright/test";
import { connect, installTestWallet } from "./wallet.ts";

// The owner acts in the app on the real programs (LiteSVM): every click below ends in a
// transaction the fake wallet signs, and the screens update from the indexer's stream.

test.describe.configure({ mode: "serial" });

test("connect, approve the waiting request", async ({ page }) => {
  const owner = await installTestWallet(page);
  await page.goto("/app/approvals");
  await connect(page);
  await expect(page.getByText(`${owner.slice(0, 4)}…${owner.slice(-4)}`)).toBeVisible();

  await page.getByRole("button", { name: /^Approve 2\.00 USDC/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText(
    "Approve 2.00 USDC to Research API for “premium e-bike comparison report”.",
  );
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /on Solana Explorer/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  // The stream turns the request into an approved one.
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});

test("reject the approved request before the agent pays", async ({ page }) => {
  await installTestWallet(page);
  await page.goto("/app/approvals");
  await connect(page);
  await page.getByRole("button", { name: /^Reject 2\.00 USDC/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText(
    "Reject 2.00 USDC to Research API for “premium e-bike comparison report”.",
  );
  await expect(dialog.getByText(/withdraws your approval/)).toBeVisible();
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Nothing is waiting for your approval.")).toBeVisible();
});

test("freeze and unfreeze the agent from its page", async ({ page }) => {
  await installTestWallet(page);
  await page.goto("/app");
  await connect(page);
  await page.getByRole("link", { name: /Research agent/ }).click();
  const toggle = page.getByRole("switch", { name: /Freeze this agent/ });
  await expect(toggle).toBeEnabled();
  await toggle.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Freeze Research agent.");
  await dialog.getByRole("button", { name: "Freeze" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Frozen by you")).toBeVisible();
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(dialog.getByRole("heading")).toHaveText("Unfreeze Research agent.");
  await dialog.getByRole("button", { name: "Unfreeze" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(toggle).not.toBeChecked();
});

test("freeze all agents with the global switch, then resume", async ({ page }) => {
  await installTestWallet(page);
  await page.goto("/app");
  await connect(page);
  const all = page.getByRole("switch", { name: /Freeze all agents/ });
  await all.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Freeze all 1 agent.");
  await dialog.getByRole("button", { name: "Freeze all" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(all).toBeChecked();
  await expect(page.getByText("0 of 1 running")).toBeVisible();

  await all.click();
  await dialog.getByRole("button", { name: "Unfreeze all" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(all).not.toBeChecked();
});

test("a declined signature changes nothing and says so", async ({ page }) => {
  await installTestWallet(page);
  await page.goto("/app");
  await connect(page);
  await page.evaluate(() => {
    (
      window as unknown as { __leashTestWallet: { declineNext: boolean } }
    ).__leashTestWallet.declineNext = true;
  });
  await page.getByRole("switch", { name: /Freeze all agents/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Freeze all" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "You declined in your wallet. Nothing was sent.",
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("switch", { name: /Freeze all agents/ })).not.toBeChecked();
});

test("another wallet sees none of the owner's agents", async ({ page }) => {
  await installTestWallet(page, { key: "stranger" });
  await page.goto("/app");
  await connect(page);
  await expect(page.getByText("No Leash account yet")).toBeVisible();
});

test("set the guardian in settings", async ({ page }) => {
  await installTestWallet(page);
  await page.goto("/app/settings");
  await connect(page);
  const stranger = "2CRA29apbadu6uBhgV6tpUSeQ9ttF95jFvVvJHuvxusU";
  await page.getByLabel("New guardian address").fill(stranger);
  await page.getByRole("button", { name: "Change guardian" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Make 2CRA…xusU your guardian.");
  await dialog.getByRole("button", { name: "Set guardian" }).click();
  await expect(dialog.getByText("Done. It's on-chain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("2CRA…xusU")).toBeVisible();
});

test("pair a new agent from a pairing link, signed in the app", async ({ page }) => {
  await installTestWallet(page);
  const agentKey = "6sbzC1eH4FTujJXWj51eQe25cYvJJxwiNRWUjEXfDfmA";
  await page.goto(
    `/pair?agentKey=${agentKey}&label=Market%20agent&preset=research-assistant&cluster=localnet`,
  );
  await connect(page);
  await expect(page.getByTestId("fingerprint").first()).toContainText("6sbz");
  // The preset is filled in; every limit stays editable.
  await expect(page.getByLabel("Allowance (USDC)")).toHaveValue("5.00");
  await page.getByLabel("Allowance (USDC)").fill("3");
  await expect(page.getByLabel("Payee wallet")).not.toHaveValue("");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(
    page.getByText(
      "This agent can spend up to 3.00 USDC per day, only with Research API, at most 1.00 USDC per payment.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign and pair" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Put Market agent on a leash.");
  await dialog.getByRole("button", { name: "Sign and pair" }).click();
  // Success leads to the new agent's page, filled from the indexer.
  await page.waitForURL(/\/app\/agents\/[1-9A-HJ-NP-Za-km-z]+$/);
  await expect(page.getByRole("heading", { name: "Market agent" })).toBeVisible();
});
