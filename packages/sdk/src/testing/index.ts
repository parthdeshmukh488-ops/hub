import { TEST_KEY_SEED_PREFIX } from "@leash/contracts";
import {
  type Address,
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
} from "@solana/kit";

// Test utilities for every workstream (`@leash/sdk/testing`). Build step 5 adds the LiteSVM
// testbed here.

const encoder = new TextEncoder();

/**
 * The 32-byte ed25519 seed of a symbolic test key: sha256("leash:test-key:" + name).
 * The Rust tests (WS1) derive the same keys, so vectors name keys, not addresses.
 */
export async function testKeySeed(name: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${TEST_KEY_SEED_PREFIX}${name}`),
  );
  return new Uint8Array(digest);
}

/** The address of a symbolic test key (see `testKeySeed`). */
export async function testKeyAddress(name: string): Promise<Address> {
  const keyPair = await createKeyPairFromPrivateKeyBytes(await testKeySeed(name));
  return getAddressFromPublicKey(keyPair.publicKey);
}
