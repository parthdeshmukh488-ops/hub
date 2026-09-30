import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_BOOT_SCRIPT } from "../lib/theme.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Leash", template: "%s · Leash" },
  description:
    "A spending firewall for AI agents on Solana: budgets, allowlists and an off switch.",
};

export const viewport: Viewport = { themeColor: "#f5f6f8" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script may set data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script with no outside input; it applies the saved theme before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
