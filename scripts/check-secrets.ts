/**
 * Fails if a tracked file looks like a secret: .env files (except .env.example), anything in
 * .keys/, *.keypair.json, 64-number keypair arrays, or PEM private keys (03-security §5).
 *
 * Run: pnpm check:secrets (CI runs it on every push).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file.length > 0);

const secretFileName = (file: string): boolean =>
  (/(^|\/)\.env(\.[^/]+)?$/.test(file) && !file.endsWith(".env.example")) ||
  /(^|\/)\.keys\//.test(file) ||
  /\.keypair\.json$/.test(file);

// A Solana keypair file is a JSON array of 64 byte values.
const KEYPAIR_ARRAY = /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const TEXT_FILE = /\.(json|jsonc|ts|tsx|js|mjs|cjs|md|txt|toml|ya?ml|rs|sh|env|example)$/;

const problems: string[] = [];
for (const file of files) {
  if (secretFileName(file)) {
    problems.push(`${file}: secret-looking file is tracked`);
    continue;
  }
  if (!TEXT_FILE.test(file)) continue;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  if (KEYPAIR_ARRAY.test(text)) problems.push(`${file}: contains a 64-byte keypair array`);
  if (PEM_PRIVATE_KEY.test(text)) problems.push(`${file}: contains a PEM private key`);
}

if (problems.length > 0) {
  console.error(`check-secrets failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`check-secrets: ok (${files.length} tracked files)`);
