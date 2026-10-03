import { expect, test } from "@playwright/test";
import { connect, installTestWallet } from "./wallet.ts";

// The sample data (no backend): the wallet connects, the pairing wizard reaches its review, and
// nothing can be signed, because sample data is read-only.

test("connect the wallet: the address shows, with copy", async ({ page }) => {
  const owner = await installTestWallet(page);
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await connect(page);
  await expect(page.getByText(`${owner.slice(0, 4)}…${owner.slice(-4)}`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Copy address ${owner}` })).toBeVisible();
  // Sample data stays read-only with a wallet too, and says why.
  await expect(page.getByText("Sample data is read-only").first()).toBeVisible();
  // The choice is remembered.
  await page.reload();
  await expect(page.getByText(`${owner.slice(0, 4)}…${owner.slice(-4)}`)).toBeVisible();
  await page.getByRole("button", { name: "Disconnect wallet" }).click();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
});

test("warn when the wallet is not on the app's cluster", async ({ page }) => {
  await installTestWallet(page, { chains: ["solana:mainnet"] });
  await page.goto("/app");
  await connect(page);
  await expect(page.getByText("Wallet not on localnet")).toBeVisible();
});

test("approve and freeze open nothing on sample data", async ({ page }) => {
  await installTestWallet(page);
  await page.goto("/app/approvals");
  await connect(page);
  await expect(page.getByRole("button", { name: /^Approve / }).first()).toBeDisabled();
  await page.goto("/app");
  await expect(page.getByRole("switch", { name: /Freeze all agents/ })).toBeDisabled();
});

test("the pairing wizard reaches its review", async ({ page }) => {
  await installTestWallet(page);
  const agentKey = "6sbzC1eH4FTujJXWj51eQe25cYvJJxwiNRWUjEXfDfmA";
  await page.goto(
    `/pair?agentKey=${agentKey}&label=Market%20agent&preset=research-assistant&cluster=localnet`,
  );
  await connect(page);
  await expect(page.getByTestId("fingerprint").first()).toHaveText(/^6sbzC1eH4FTu/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Market agent");
  await expect(page.getByLabel("Per payment, without asking (USDC)")).toHaveValue("1.00");
  await page.getByLabel("Per payment, without asking (USDC)").fill("0.50");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(
    page.getByText(
      "This agent can spend up to 5.00 USDC per day, only with Research API, at most 0.50 USDC per payment.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("It freezes itself after 3 blocked attempts within 10 min."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and pair" })).toBeDisabled();
});

test("a broken pairing link says what is wrong", async ({ page }) => {
  await page.goto("/pair?agentKey=not-a-key&label=x");
  await expect(page.getByText("This pairing link is not valid")).toBeVisible();
  await expect(
    page.getByText("The agent key in the link is not a valid Solana address."),
  ).toBeVisible();
});

test("a link for another cluster is refused", async ({ page }) => {
  await page.goto(
    "/pair?agentKey=6sbzC1eH4FTujJXWj51eQe25cYvJJxwiNRWUjEXfDfmA&label=A&cluster=devnet",
  );
  await expect(page.getByText("This link is for devnet")).toBeVisible();
});

test("the landing page: the promise, the story, keyboard first, and the way into the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Spending limits and an off switch for AI agents, enforced on Solana.",
    }),
  ).toBeVisible();
  for (const name of ["The 60-second story", "How it works", "Why Solana", "See it for yourself"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  // Every status comes with a word, not only a colour.
  for (const label of ["Paid", "Waiting for you", "Blocked", "Frozen"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // The first Tab lands on the skip link, which jumps to the content.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await page.getByRole("link", { name: "Open the control panel" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
