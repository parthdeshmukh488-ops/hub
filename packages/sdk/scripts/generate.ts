// Generates the Codama clients in src/generated/. Never edit those files by hand: change the IDL
// and run `pnpm --filter @leash/sdk generate`.
//
// - src/generated/leash: from the Leash program's Anchor IDL (packages/contracts/idl/leash.json,
//   written by WS1).
// - src/generated/subscriptions: from the Codama IDL of the Solana Foundation Subscriptions
//   program, vendored in idl/subscriptions.json from github.com/solana-foundation/subscriptions at
//   tag program-v0.5.0 (commit 364a41976c33347d092902443bbec2def9227e75). The official
//   @solana/subscriptions package targets @solana/kit 7; generating our own keeps one kit version.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type AnchorIdl, rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot, type RootNode } from "codama";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const options = {
  kitImportStrategy: "rootOnly",
  importExtension: "ts",
  erasableSyntax: true,
  syncPackageJson: false,
} as const;

const leash = createFromRoot(
  rootNodeFromAnchor(readJson("../../contracts/idl/leash.json") as AnchorIdl),
);
await leash.accept(
  renderVisitor(packageDir, { ...options, generatedFolder: "src/generated/leash" }),
);

const subscriptions = createFromRoot(readJson("../idl/subscriptions.json") as RootNode);
await subscriptions.accept(
  renderVisitor(packageDir, { ...options, generatedFolder: "src/generated/subscriptions" }),
);

console.log("generated src/generated/leash and src/generated/subscriptions");
