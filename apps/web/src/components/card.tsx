import type { ReactNode } from "react";
import { cn } from "./cn.ts";

/** A titled panel. `id` names the section for screen readers. */
export function Card({
  id,
  title,
  action,
  className,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-2xl border border-line bg-surface p-5", className)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
