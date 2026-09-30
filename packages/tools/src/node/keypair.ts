import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  type KeyPairSigner,
} from "@solana/kit";

/** A problem with the agent keypair file. The message never contains the file's content (T17). */
export class AgentKeyError extends Error {
  override readonly name = "AgentKeyError";
}

export type AgentKey = {
  signer: KeyPairSigner;
  /** The absolute path of the keypair file. */
  path: string;
  /** True if this call generated the key. */
  created: boolean;
};

/** `~/…` becomes the home directory; other relative paths resolve against `cwd`. */
export function resolveKeypairPath(path: string, cwd = process.cwd()): string {
  if (path === "~" || path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(cwd, path);
}

const isByteArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === 64 &&
  value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

async function parseKeyFile(text: string, file: string): Promise<KeyPairSigner> {
  const invalid = new AgentKeyError(
    `The agent keypair at ${file} is not a Solana CLI keypair file (a JSON array of 64 bytes).`,
  );
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalid;
  }
  if (!isByteArray(json)) throw invalid;
  const bytes = Uint8Array.from(json);
  try {
    // Checks that the public half matches the secret half.
    return await createKeyPairSignerFromBytes(bytes);
  } catch {
    throw invalid;
  } finally {
    bytes.fill(0);
  }
}

/** A new key, written like `solana-keygen new` does: 32 secret bytes, then the public key. */
async function createKeyFile(file: string): Promise<KeyPairSigner> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const bytes = new Uint8Array(64);
  bytes.set(seed);
  bytes.set(getAddressEncoder().encode(signer.address), 32);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // "wx": never overwrite a key that appeared in the meantime.
  writeFileSync(file, JSON.stringify(Array.from(bytes)), { mode: 0o600, flag: "wx" });
  seed.fill(0);
  bytes.fill(0);
  return signer;
}

/**
 * The agent key from a Solana CLI keypair file (02-contracts §13, `AGENT_KEYPAIR`). With `create`,
 * a missing file is generated with mode 0600 in a 0700 directory. The key is imported as a
 * non-extractable signer.
 */
export async function loadAgentKey(
  path: string,
  { create = false }: { create?: boolean } = {},
): Promise<AgentKey> {
  const file = resolveKeypairPath(path);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new AgentKeyError(`Cannot read the agent keypair at ${file}.`);
    }
    if (!create) throw new AgentKeyError(`No agent keypair at ${file}.`);
    return { signer: await createKeyFile(file), path: file, created: true };
  }
  return { signer: await parseKeyFile(text, file), path: file, created: false };
}
