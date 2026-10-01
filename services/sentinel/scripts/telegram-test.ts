import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DemoStorylineSchema } from "@leash/contracts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { loadEnv } from "../src/env.ts";
import { createTelegramNotifier } from "../src/notifiers/telegram.ts";
import { evaluateAll } from "../src/rules/evaluate.ts";
import { emptyOwnerState } from "../src/rules/state.ts";

// Sends the demo storyline's alerts to TELEGRAM_CHAT_ID: one command to check the bot token, the
// chat id and how the alerts look on a phone. Run it where Telegram is reachable (the laptop).

const env = loadEnv();
if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
  process.stderr.write("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (in the repo root's .env).\n");
  process.exit(1);
}
const path = createRequire(import.meta.url).resolve(
  "@leash/contracts/fixtures/demo-storyline.json",
);
const storyline = DemoStorylineSchema.parse(JSON.parse(readFileSync(path, "utf8")));
const owner = storyline.keys.owner;
if (!owner) throw new Error("the storyline has no owner");

const { alerts } = evaluateAll(
  emptyOwnerState(owner),
  storyline.events.map((event) => ({ kind: "event", event })),
  { config: DEFAULT_CONFIG, webUrl: env.SENTINEL_WEB_URL },
);
const telegram = createTelegramNotifier({
  token: env.TELEGRAM_BOT_TOKEN,
  chatId: env.TELEGRAM_CHAT_ID,
});
for (const alert of alerts) {
  await telegram.send(alert);
  process.stdout.write(`sent: ${alert.title}\n`);
}
