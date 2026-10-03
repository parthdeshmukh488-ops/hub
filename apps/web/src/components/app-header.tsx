"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRequests } from "../data/hooks.ts";
import { useLive } from "../live/live-provider.tsx";
import { ConnectButton } from "../wallet/connect-button.tsx";
import { cn } from "./cn.ts";
import { ThemeToggle } from "./theme-toggle.tsx";

const LINKS = [
  { href: "/app", label: "Overview" },
  { href: "/app/activity", label: "Activity" },
  { href: "/app/approvals", label: "Approvals" },
  { href: "/app/settings", label: "Settings" },
] as const;

const STATUS = {
  sample: { label: "Sample data", dot: "bg-fg-muted" },
  connecting: { label: "Connecting…", dot: "bg-approval" },
  live: { label: "Live", dot: "bg-ok" },
  reconnecting: { label: "Reconnecting…", dot: "bg-approval" },
} as const;

export function AppHeader() {
  const pathname = usePathname();
  const { status } = useLive();
  const requests = useRequests();
  const waiting = requests.data?.filter((request) => request.status === "pending").length ?? 0;
  const state = STATUS[status];

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <Link href="/app" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-lg bg-brand text-canvas"
          >
            L
          </span>
          Leash
        </Link>
        <nav
          aria-label="Main"
          className="order-last flex w-full gap-1 text-sm sm:order-none sm:w-auto"
        >
          {LINKS.map((link) => {
            const active =
              link.href === "/app" ? pathname === "/app" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-1.5 hover:bg-surface",
                  active ? "bg-surface font-medium text-fg" : "text-fg-muted",
                )}
              >
                {link.label}
                {link.href === "/app/approvals" && waiting > 0 && (
                  <span className="ml-1.5 rounded-full bg-approval-soft px-1.5 text-xs font-semibold text-approval">
                    {waiting}
                    <span className="sr-only"> waiting</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <p className="flex items-center gap-2 rounded-full border border-line px-2.5 py-1 text-xs text-fg-muted">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", state.dot, status === "live" && "animate-pulse")}
            />
            {state.label}
          </p>
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
