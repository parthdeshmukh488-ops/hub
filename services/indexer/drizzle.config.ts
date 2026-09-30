import { defineConfig } from "drizzle-kit";

// `pnpm --filter @leash/indexer db:generate` writes a new migration after a schema change.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
