import type { ReactNode } from "react";
import { AppShell } from "../../components/app-shell.tsx";

export default function PairLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
