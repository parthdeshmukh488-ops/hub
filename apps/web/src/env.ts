import { ClusterSchema } from "@leash/contracts";
import { z } from "zod";

// The only file that reads process.env (CLAUDE.md). Next.js inlines NEXT_PUBLIC_* variables at
// build time only when they are read literally, so each one is listed by name.

const EnvSchema = z.object({
  NEXT_PUBLIC_DATA_SOURCE: z.enum(["fixtures", "indexer"]).default("fixtures"),
  NEXT_PUBLIC_LEASH_CLUSTER: ClusterSchema.default("localnet"),
  NEXT_PUBLIC_INDEXER_URL: z.url().optional(),
  NEXT_PUBLIC_INDEXER_WS_URL: z.url().optional(),
  NEXT_PUBLIC_RPC_URL: z.url().optional(),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
});

export type WebEnv = z.infer<typeof EnvSchema>;

const blankToUndefined = (value: string | undefined) => (value === "" ? undefined : value);

export const env: WebEnv = EnvSchema.parse({
  NEXT_PUBLIC_DATA_SOURCE: blankToUndefined(process.env.NEXT_PUBLIC_DATA_SOURCE),
  NEXT_PUBLIC_LEASH_CLUSTER: blankToUndefined(process.env.NEXT_PUBLIC_LEASH_CLUSTER),
  NEXT_PUBLIC_INDEXER_URL: blankToUndefined(process.env.NEXT_PUBLIC_INDEXER_URL),
  NEXT_PUBLIC_INDEXER_WS_URL: blankToUndefined(process.env.NEXT_PUBLIC_INDEXER_WS_URL),
  NEXT_PUBLIC_RPC_URL: blankToUndefined(process.env.NEXT_PUBLIC_RPC_URL),
  NEXT_PUBLIC_APP_URL: blankToUndefined(process.env.NEXT_PUBLIC_APP_URL),
});
