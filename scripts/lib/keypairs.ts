/**
 * Demo keypairs in .keys/ (WS0 step 4), shared by `keys.ts` and `devnet-check.ts`.
 *
 * Files use the Solana CLI format: a JSON array of 64 numbers, the ed25519 seed then the public
 * key. `solana-keygen pubkey`, the Solana CLI and every SDK read them.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DemoKey = {
  name: string;
  role: string;
  /** The environment variable that takes this wallet's address, if any. */
  env?: string;
};

/** The demo keys, in the order scripts list them. */
export const DEMO_KEYS: readonly DemoKey[] = [
  { name: "owner-demo", role: "demo owner wallet: funds the allowance, signs policy changes" },
  { name: "agent", role: "demo agent key: signs pay, request_payment, report_denied_attempt" },
  { name: "merchant", role: "demo merchant wallet: receives payments", env: "MERCHANT_PAY_TO" },
  {
    name: "attacker",
    role: "the wallet the adversarial lab tries to get paid",
    env: "LAB_ATTACKER_WALLET",
  },
  { name: "guardian", role: "Sentinel's guardian key: can only freeze and reject" },
  { name: "facilitator", role: "x402 facilitator fee payer: pays SOL fees only" },
];

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const KEYS_DIR = join(REPO_ROOT, ".keys");

/** The path of a demo key's file. */
export function keyPath(name: string): string {
  return join(KEYS_DIR, `${name}.json`);
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet), the encoding of Solana addresses. */
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = "";
  while (n > 0n) {
    out = `${ALPHABET.charAt(Number(n % 58n))}${out}`;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** The ed25519 public key of a 32-byte seed. */
function publicKeyOf(seed: Uint8Array): Uint8Array {
  // PKCS#8 wrapper for a raw ed25519 seed (RFC 8410).
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const jwk = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({
    format: "jwk",
  });
  if (typeof jwk.x !== "string") throw new Error("ed25519 public key export failed");
  return Buffer.from(jwk.x, "base64url");
}

/** Reads a keypair file and returns its address, after checking both halves agree. */
export function readKeypairAddress(path: string): string {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  ) {
    throw new Error(`${path} is not a Solana keypair (a JSON array of 64 bytes)`);
  }
  const bytes = Uint8Array.from(parsed as number[]);
  const publicKey = bytes.subarray(32);
  if (!Buffer.from(publicKeyOf(bytes.subarray(0, 32))).equals(Buffer.from(publicKey))) {
    throw new Error(`${path} is corrupt: its public half does not match its secret half`);
  }
  return base58(publicKey);
}

/**
 * Writes a new keypair file and returns its address. Fails if the file exists, so a key is never
 * overwritten. Permissions are owner-only where the OS supports them.
 */
export function createKeypair(path: string): string {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  if (typeof jwk.d !== "string" || typeof jwk.x !== "string") {
    throw new Error("ed25519 key generation failed");
  }
  const seed = Buffer.from(jwk.d, "base64url");
  const publicKey = Buffer.from(jwk.x, "base64url");
  writeFileSync(path, `${JSON.stringify([...seed, ...publicKey])}\n`, { mode: 0o600, flag: "wx" });
  return base58(publicKey);
}
