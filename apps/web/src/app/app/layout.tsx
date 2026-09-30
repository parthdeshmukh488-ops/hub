import type { ReactNode } from "react";
import { AppHeader } from "../../components/app-header.tsx";
import { Providers } from "../../live/live-provider.tsx";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{children}</main>
      </div>
    </Providers>
  );
}
