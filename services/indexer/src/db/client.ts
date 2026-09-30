import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.ts";

export type Db = LibSQLDatabase<typeof schema>;

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Opens the libSQL database (creating the folder of a local file) and applies migrations. */
export async function openDatabase(url: string): Promise<{ db: Db; close: () => void }> {
  if (url.startsWith("file:") && !url.includes(":memory:")) {
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
