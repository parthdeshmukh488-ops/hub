import type { Alert } from "@leash/contracts";
import type { Notifier } from "./notifier.ts";

const MARK = { info: "INFO", warning: "WARNING", critical: "CRITICAL" } as const;

/** An alert as a few readable lines for a terminal. Alert text is already plain and defanged. */
export function formatAlert(alert: Alert): string {
  const lines = [`[${MARK[alert.severity]}] ${alert.title}`, `  ${alert.body}`];
  for (const action of alert.actions) lines.push(`  → ${action.label}: ${action.url}`);
  return `${lines.join("\n")}\n`;
}

/** Prints alerts to the terminal (development, and the fallback without Telegram). */
export function createConsoleNotifier(
  write: (text: string) => void = (text) => process.stdout.write(text),
): Notifier {
  return {
    name: "console",
    send: async (alert) => write(formatAlert(alert)),
  };
}
