import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { AddressSchema } from "@leash/contracts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { z } from "zod";

// Command-line flags. `--guardian` is watch-only: it names whose principals to watch and never
// signs anything. Freezing (build step 4) needs SENTINEL_GUARDIAN_KEYPAIR.

export interface Args {
  guardian: string | null;
  config: string | null;
}

export const USAGE = `Usage: sentinel [--guardian <address>] [--config <path>]

  --guardian <address>  Watch the principals whose guardian is this address (watch-only).
                        Without it, the address of SENTINEL_GUARDIAN_KEYPAIR is used.
  --config <path>       Rule thresholds (default: sentinel.config.json next to package.json).`;

/** Parses the flags; throws a readable error with the usage on anything unknown. */
export function parseCliArgs(argv: readonly string[]): Args {
  let values: { guardian?: string; config?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { guardian: { type: "string" }, config: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
  if (values.guardian !== undefined && !AddressSchema.safeParse(values.guardian).success) {
    throw new Error(`--guardian is not a Solana address: ${values.guardian}\n\n${USAGE}`);
  }
  return { guardian: values.guardian ?? null, config: values.config ?? null };
}

const KeypairFileSchema = z.array(z.number().int().min(0).max(255)).length(64);

/** The public address of a keypair file (a 64-byte JSON array, as `solana-keygen` writes). */
export async function keypairAddress(path: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read SENTINEL_GUARDIAN_KEYPAIR at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const bytes = KeypairFileSchema.safeParse(parsed);
  // Never print the file's content: it is a secret key.
  if (!bytes.success) throw new Error(`SENTINEL_GUARDIAN_KEYPAIR at ${path} is not a keypair file`);
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes.data));
  return signer.address;
}

/**
 * Whose principals to watch: the `--guardian` flag, else the keypair's address. Both given must
 * agree, or freezes would be signed by a key other than the one being watched for.
 */
export async function resolveGuardian(
  flag: string | null,
  keypairPath: string | undefined,
): Promise<string> {
  const fromKeypair = keypairPath ? await keypairAddress(keypairPath) : null;
  if (flag && fromKeypair && flag !== fromKeypair) {
    throw new Error(
      `--guardian ${flag} differs from the address of SENTINEL_GUARDIAN_KEYPAIR (${fromKeypair}). ` +
        "Drop one of them.",
    );
  }
  const guardian = flag ?? fromKeypair;
  if (!guardian) {
    throw new Error(
      "Sentinel needs to know whose principals to watch. Pass --guardian <address> (watch-only), " +
        "or set SENTINEL_GUARDIAN_KEYPAIR to the guardian's keypair file.\n\n" +
        USAGE,
    );
  }
  return guardian;
}
