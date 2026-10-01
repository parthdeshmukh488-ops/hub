import type { Env } from "../env.ts";
import { createConsoleNotifier } from "./console.ts";
import type { Notifier } from "./notifier.ts";
import { createTelegramNotifier } from "./telegram.ts";

/**
 * The console always (the terminal shows what was sent); Telegram too when both of its variables
 * are set. Only one of them is a mistake worth stopping for: the demo would stay silent.
 */
export function selectNotifiers(
  env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHAT_ID">,
  console: Notifier = createConsoleNotifier(),
): Notifier[] {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = env;
  if (token && chatId) return [console, createTelegramNotifier({ token, chatId })];
  if (token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is set but TELEGRAM_CHAT_ID is not. Send /start to the bot, then read " +
        "chat.id from https://api.telegram.org/bot<token>/getUpdates.",
    );
  }
  if (chatId) throw new Error("TELEGRAM_CHAT_ID is set but TELEGRAM_BOT_TOKEN is not.");
  return [console];
}
