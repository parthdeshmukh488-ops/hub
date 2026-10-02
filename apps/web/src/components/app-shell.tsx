import type { ReactNode } from "react";
import { Providers } from "../live/live-provider.tsx";
import { WalletProvider } from "../wallet/wallet-provider.tsx";
import { AppHeader } from "./app-header.tsx";

/** The owner app's frame: the wallet, the query cache with its live stream, the header. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <Providers>
        <div className="min-h-dvh">
          <AppHeader />
          <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{children}</main>
        </div>
      </Providers>
    </WalletProvider>
  );
}
