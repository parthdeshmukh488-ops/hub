/**
 * Creates the demo keypairs in .keys/ and prints their addresses (WS0 step 4).
 *
 *   pnpm keys          create the missing keys, then list all of them
 *   pnpm keys --help
 *
 * Never overwrites a key. .keys/ is gitignored, and `pnpm check:secrets` fails if a key is ever
 * committed.
 */
import { existsSync, mkdirSync } from "node:fs";
import { relative } from "node:path";
import {
  createKeypair,
  DEMO_KEYS,
  KEYS_DIR,
  keyPath,
  REPO_ROOT,
  readKeypairAddress,
} from "./lib/keypairs.ts";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: pnpm keys

Creates the missing demo keypairs in .keys/ and prints every address:
${DEMO_KEYS.map((k) => `  .keys/${k.name}.json  ${k.role}`).join("\n")}

Existing files are never overwritten; a file that is not a valid keypair is reported as an error.`);
  process.exit(0);
}

mkdirSync(KEYS_DIR, { recursive: true });
let failed = false;
const addresses = new Map<string, string>();
for (const key of DEMO_KEYS) {
  const path = keyPath(key.name);
  const shown = relative(REPO_ROOT, path).replaceAll("\\", "/");
  try {
    const existed = existsSync(path);
    const address = existed ? readKeypairAddress(path) : createKeypair(path);
    addresses.set(key.name, address);
    console.log(
      `${existed ? "kept   " : "created"}  ${shown.padEnd(24)} ${address}  (${key.role})`,
    );
  } catch (error) {
    failed = true;
    console.error(`error    ${shown}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const envLines = DEMO_KEYS.flatMap((key) => {
  const address = addresses.get(key.name);
  return key.env && address ? [`${key.env}=${address}`] : [];
});
const owner = addresses.get("owner-demo");
if (owner) envLines.push(`AGENT_OWNER=${owner}`);
if (envLines.length > 0) {
  console.log("\nFor your .env files (addresses only, never secrets):");
  for (const line of envLines) console.log(`  ${line}`);
}
process.exit(failed ? 1 : 0);
