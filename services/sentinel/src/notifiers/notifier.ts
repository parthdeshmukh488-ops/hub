import type { Alert } from "@leash/contracts";

/** Where alerts go: the console in development, Telegram for the owner's phone. */
export interface Notifier {
  readonly name: string;
  /** Delivers one alert. Rejects on failure; Sentinel logs it and carries on. */
  send(alert: Alert): Promise<void>;
}
