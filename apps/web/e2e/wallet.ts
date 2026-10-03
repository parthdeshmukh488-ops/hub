import { testKeySeed } from "@leash/sdk/testing";
import type { Page } from "@playwright/test";
import { createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder } from "@solana/kit";
import { fakeWalletScript } from "./fake-wallet.ts";

/** Installs the fake wallet, signing with the deterministic test key `name`, before the app loads. */
export async function installTestWallet(
  page: Page,
  options: { key?: string; chains?: string[] } = {},
): Promise<string> {
  const seed = await testKeySeed(options.key ?? "owner");
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  await page.addInitScript({
    content: fakeWalletScript({
      seed,
      publicKey: new Uint8Array(getAddressEncoder().encode(signer.address)),
      address: signer.address,
      chains: options.chains ?? ["solana:localnet", "solana:devnet"],
    }),
  });
  return signer.address;
}

/** Connects the fake wallet through the header's picker. */
export async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Leash Test Wallet" }).click();
}
