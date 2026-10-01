import type { Alert } from "@leash/contracts";
import { Api, GrammyError } from "grammy";
import type { InlineKeyboardButton, MessageEntity } from "grammy/types";
import type { Notifier } from "./notifier.ts";

// Alerts to the owner's phone through a Telegram bot. The message is plain text: no
// `parse_mode`, so no label or memo can be read as markup, and nothing needs escaping. The title
// is bold through an entity. Untrusted text was already defanged by the rules (`untrusted()`).

const MARK = { info: "🔔", warning: "⚠️", critical: "🚨" } as const;

/** The message Telegram receives for an alert (the `sendMessage` parameters after `chat_id`). */
export interface TelegramMessage {
  text: string;
  entities: MessageEntity[];
  link_preview_options: { is_disabled: true };
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
}

/**
 * Telegram rejects URL buttons it cannot open (`localhost`, private addresses), and a rejected
 * button fails the whole message. Only public https URLs become buttons.
 */
export function isPublicHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (!host.includes(".")) return false; // single-label names and IPv6 literals
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a = 0, b = 0] = octets;
    const isPrivate =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    if (isPrivate) return false;
  }
  return true;
}

/** Formats an alert: bold title, body, then buttons for public links and text for the rest. */
export function formatTelegramMessage(alert: Alert): TelegramMessage {
  const title = `${MARK[alert.severity]} ${alert.title}`;
  const buttons = alert.actions.filter((action) => isPublicHttpsUrl(action.url));
  const inText = alert.actions.filter((action) => !isPublicHttpsUrl(action.url));
  const links = inText.map((action) => `${action.label}: ${action.url}`);
  const text = [title, alert.body, ...(links.length > 0 ? [links.join("\n")] : [])].join("\n\n");
  return {
    text,
    // Offsets and lengths are UTF-16 code units, as JavaScript's `length` counts them.
    entities: [{ type: "bold", offset: 0, length: title.length }],
    link_preview_options: { is_disabled: true },
    ...(buttons.length > 0
      ? {
          reply_markup: {
            inline_keyboard: buttons.map((action) => [{ text: action.label, url: action.url }]),
          },
        }
      : {}),
  };
}

export interface TelegramOptions {
  token: string;
  chatId: string;
  /** The Bot API root; tests point it at a fake. */
  apiRoot?: string;
}

/** Sends alerts to one chat. Errors never carry the token. */
export function createTelegramNotifier(options: TelegramOptions): Notifier {
  const api = new Api(options.token, options.apiRoot ? { apiRoot: options.apiRoot } : {});
  const redact = (text: string) => text.split(options.token).join("<token>");
  return {
    name: "telegram",
    send: async (alert) => {
      const message = formatTelegramMessage(alert);
      try {
        await api.sendMessage(options.chatId, message.text, {
          entities: message.entities,
          link_preview_options: message.link_preview_options,
          ...(message.reply_markup ? { reply_markup: message.reply_markup } : {}),
        });
      } catch (error) {
        const detail =
          error instanceof GrammyError
            ? `Telegram refused the message (${error.error_code}: ${error.description})`
            : `Telegram is not reachable (${error instanceof Error ? error.message : String(error)})`;
        throw new Error(redact(detail));
      }
    },
  };
}
