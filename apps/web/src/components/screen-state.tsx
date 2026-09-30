import type { ReactNode } from "react";
import { getDataSource } from "../data/index.ts";
import { env } from "../env.ts";

type QueryLike = { isPending: boolean; isError: boolean; error: unknown };

/** Loading and error states shared by every screen; renders `children` once data is there. */
export function ScreenState({ query, children }: { query: QueryLike; children: () => ReactNode }) {
  if (query.isPending) {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading…</span>
        <div className="h-24 animate-pulse rounded-2xl bg-surface" />
        <div className="h-48 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }
  if (query.isError) {
    const indexer = getDataSource().kind === "indexer";
    return (
      <div role="alert" className="space-y-2 rounded-2xl border border-blocked/40 bg-surface p-5">
        <p className="font-semibold">Can't load this right now</p>
        <p className="text-sm text-fg-muted">
          {query.error instanceof Error ? query.error.message : "Something went wrong."}
        </p>
        {indexer && (
          <p className="text-sm text-fg-muted">
            The app reads the indexer at{" "}
            <span className="font-mono">{env.NEXT_PUBLIC_INDEXER_URL}</span>. Start it with{" "}
            <span className="font-mono">pnpm --filter @leash/indexer start</span>.
          </p>
        )}
      </div>
    );
  }
  return <>{children()}</>;
}
