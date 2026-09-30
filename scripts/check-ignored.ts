/**
 * Fails if .gitignore hides a source file.
 *
 * CI only sees committed files, so a too-broad ignore rule makes CI fail while every local check
 * passes (it happened: a `data/` rule hid apps/web/src/data). Run with `pnpm check:ignored`.
 */
import { execFileSync } from "node:child_process";

const git = (args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Ignored on purpose: build output, caches, secrets and local state (files or whole folders). */
const EXPECTED = [
  /(^|\/)(node_modules|\.next|\.turbo|dist|coverage|target|test-ledger|\.anchor)\//,
  /(^|\/)next-env\.d\.ts$/,
  /\.tsbuildinfo$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)\.keys\//,
  /\.keypair\.json$/,
  /(^|\/)\.localnet\.json$/,
  /^data\/$/,
  /^(apps|services)\/[^/]+\/data\/$/,
  /\.db(-journal)?$/,
];

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|css|md|sql|rs|toml|ya?ml|html)$/;

// --directory lists a wholly ignored folder once (node_modules stays one line per folder).
const hidden = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"])
  .split("\n")
  .filter((path) => path !== "")
  .filter((path) => path.endsWith("/") || SOURCE_FILE.test(path))
  .filter((path) => !EXPECTED.some((pattern) => pattern.test(path)));

if (hidden.length > 0) {
  console.error(
    "check-ignored: these source paths are hidden by .gitignore and would never reach CI:",
  );
  for (const path of hidden)
    console.error(`  ${git(["check-ignore", "-v", "--no-index", path]).trim()}`);
  process.exit(1);
}
console.log("check-ignored: ok (no source file is ignored)");
