/**
 * `.env.example` is generated from ENV_VARS in packages/contracts/src/config.ts, so the
 * documented variables and the real ones cannot drift apart.
 *
 *   pnpm env:example   rewrite .env.example
 *   pnpm check:env     fail if .env.example is stale, or if any tracked .env.example names an
 *                      owner key (invariant I6: no server holds a key that can move owner funds)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ENV_VARS } from "@leash/contracts";

const FILE = ".env.example";

function render(): string {
  const lines = [
    "# Generated from ENV_VARS in packages/contracts/src/config.ts. Do not edit by hand:",
    "# change the list, then run `pnpm env:example`.",
    "# Keypair variables hold file paths, never secrets. Never commit a real .env file.",
    "",
  ];
  for (const v of ENV_VARS) {
    lines.push(`# ${v.description} (used by: ${v.usedBy.join(", ")})`);
    lines.push(`${v.name}=${v.example}`);
    lines.push("");
  }
  return lines.join("\n");
}

// Names that would mean a server holds an owner's signing key.
const OWNER_KEY = /OWNER.*(KEY|SECRET|SEED|MNEMONIC)|(KEY|SECRET|SEED|MNEMONIC).*OWNER/;

function ownerKeyViolations(): string[] {
  const files = execFileSync("git", ["ls-files", "-z", "--", "*.env.example", ".env.example"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => f.length > 0);
  const found: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const name = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
      if (name && OWNER_KEY.test(name)) found.push(`${file}: ${name}`);
    }
  }
  for (const v of ENV_VARS) if (OWNER_KEY.test(v.name)) found.push(`ENV_VARS: ${v.name}`);
  return found;
}

const mode = process.argv[2];
if (mode === "--write") {
  writeFileSync(FILE, render());
  console.log(`wrote ${FILE} (${ENV_VARS.length} variables)`);
} else if (mode === "--check") {
  const problems: string[] = [];
  let current = "";
  try {
    current = readFileSync(FILE, "utf8");
  } catch {
    problems.push(`${FILE} is missing: run pnpm env:example`);
  }
  if (current && current !== render()) problems.push(`${FILE} is stale: run pnpm env:example`);
  for (const v of ownerKeyViolations()) problems.push(`owner key variable (violates I6): ${v}`);
  if (problems.length > 0) {
    console.error(`check-env failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check-env: ok (${ENV_VARS.length} variables, no owner keys)`);
} else {
  console.error("usage: tsx scripts/env-example.ts --write | --check");
  process.exit(2);
}
