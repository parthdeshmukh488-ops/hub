import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type DemoStoryline, DemoStorylineSchema } from "@leash/contracts";

/** The demo storyline from `@leash/contracts`, validated (a file is a boundary). */
export function loadStoryline(): DemoStoryline {
  const path = createRequire(import.meta.url).resolve(
    "@leash/contracts/fixtures/demo-storyline.json",
  );
  return DemoStorylineSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
