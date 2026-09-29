import Link from "next/link";
import type { ReactNode } from "react";
import { getDataSource } from "../../data/index.ts";
import { env } from "../../env.ts";

export default function AppLayout({ children }: { children: ReactNode }) {
  const source = getDataSource();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link href="/app" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-lg bg-brand text-canvas"
            >
              L
            </span>
            Leash
          </Link>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {source.kind === "fixtures" ? (
              <span className="rounded-full border border-line px-2.5 py-1 text-fg-muted">
                Sample data · read-only
              </span>
            ) : (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono">
                {env.NEXT_PUBLIC_LEASH_CLUSTER}
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
