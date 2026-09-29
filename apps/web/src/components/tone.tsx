import { Ban, CircleCheck, Hourglass, Info, type LucideIcon, Snowflake } from "lucide-react";
import type { Tone } from "../lib/status.ts";
import { cn } from "./cn.ts";

const TONES: Record<Tone, { icon: LucideIcon; text: string; soft: string }> = {
  ok: { icon: CircleCheck, text: "text-ok", soft: "bg-ok-soft" },
  blocked: { icon: Ban, text: "text-blocked", soft: "bg-blocked-soft" },
  approval: { icon: Hourglass, text: "text-approval", soft: "bg-approval-soft" },
  frozen: { icon: Snowflake, text: "text-frozen", soft: "bg-frozen-soft" },
  neutral: { icon: Info, text: "text-fg-muted", soft: "bg-surface-2" },
};

export function toneClasses(tone: Tone): { text: string; soft: string } {
  return TONES[tone];
}

/** The icon that always accompanies a tone colour (never colour alone). */
export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  const { icon: Icon, text } = TONES[tone];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", text, className)} />;
}

/** A status pill: icon + label, coloured by tone. */
export function StatusBadge({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  const { text, soft } = TONES[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        text,
        soft,
      )}
    >
      <ToneIcon tone={tone} className="size-3.5" />
      {label}
    </span>
  );
}
