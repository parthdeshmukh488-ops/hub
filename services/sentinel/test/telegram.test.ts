import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Alert } from "@leash/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createConsoleNotifier } from "../src/notifiers/console.ts";
import { selectNotifiers } from "../src/notifiers/select.ts";
import {
  createTelegramNotifier,
  formatTelegramMessage,
  isPublicHttpsUrl,
} from "../src/notifiers/telegram.ts";
import { evaluateAll } from "../src/rules/evaluate.ts";
import {
  context,
  ev,
  events,
  freshState,
  OWNER,
  RESEARCH,
  storyline,
  T0,
  USDC,
} from "./helpers.ts";

// A fake Bot API: it records every call and answers like Telegram.

const TOKEN = "123456789:TEST-token-not-real";
const CHAT = "424242";

interface Call {
  path: string;
  body: Record<string, unknown>;
}

class FakeBotApi {
  readonly calls: Call[] = [];
  /** What the next calls answer; default `ok`. */
  answer: (call: Call) => { status: number; body: unknown } = () => ({
    status: 200,
    body: {
      ok: true,
      result: { message_id: 1, date: 0, chat: { id: Number(CHAT), type: "private" }, text: "" },
    },
  });
  private readonly server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const call = { path: request.url ?? "", body: JSON.parse(raw || "{}") };
      this.calls.push(call);
      const { status, body } = this.answer(call);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  root = "";

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.root = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function telegram() {
  const api = await new FakeBotApi().start();
  cleanups.push(() => api.close());
  return {
    api,
    notifier: createTelegramNotifier({ token: TOKEN, chatId: CHAT, apiRoot: api.root }),
  };
}

const storylineAlerts = (webUrl = "http://localhost:3000", actionLinks = false) =>
  evaluateAll(freshState(), events(storyline.events), {
    ...context({ actionLinks }),
    webUrl,
  }).alerts;

const alert = (overrides: Partial<Alert>): Alert => ({
  id: "x",
  severity: "info",
  kind: "approval_requested",
  owner: OWNER,
  agent: RESEARCH,
  title: "Title",
  body: "Body.",
  actions: [],
  eventIds: [],
  createdAt: 0,
  ...overrides,
});

describe("Telegram notifier, against a fake Bot API", () => {
  it("sends the storyline's alerts as plain text with a bold title and no previews", async () => {
    const { api, notifier } = await telegram();
    for (const a of storylineAlerts()) await notifier.send(a);
    expect(api.calls.map((c) => c.path)).toEqual(Array(3).fill(`/bot${TOKEN}/sendMessage`));
    const tripwire = api.calls[1]?.body;
    expect(tripwire).toEqual({
      chat_id: CHAT,
      text:
        "🚨 Research Assistant was frozen by its tripwire\n\n" +
        "Research Assistant tried 3 payments its policy blocks within 20 seconds, so its tripwire " +
        "froze it on-chain. The last one: 25.00 USDC to 3Nci…RPzw (tried to pay someone not on the " +
        "allowlist), memo “tip for the guide's author”. It cannot pay until you unfreeze it.\n\n" +
        "Open agent: http://localhost:3000/app/agents/EGj9J72oCLK1nhAMoAdWQoBisLF6usjd8u8essiAM7ch",
      entities: [{ type: "bold", offset: 0, length: 48 }], // 🚨 is two UTF-16 units
      link_preview_options: { is_disabled: true },
    });
    for (const call of api.calls) expect(call.body).not.toHaveProperty("parse_mode");
  });

  it("makes buttons of public https links only", async () => {
    const { api, notifier } = await telegram();
    const [approval] = storylineAlerts("https://leash.example", true);
    if (!approval) throw new Error("no approval alert");
    await notifier.send(approval);
    const body = api.calls[0]?.body;
    expect(body?.reply_markup).toEqual({
      inline_keyboard: approval.actions.map((a) => [{ text: a.label, url: a.url }]),
    });
    expect(String(body?.text)).not.toContain("https://leash.example");

    await notifier.send({
      ...approval,
      actions: [{ label: "Review", url: "http://localhost:3000/app/approvals" }],
    });
    expect(api.calls[1]?.body).not.toHaveProperty("reply_markup");
    expect(String(api.calls[1]?.body.text)).toMatch(
      /\n\nReview: http:\/\/localhost:3000\/app\/approvals$/,
    );
  });

  it("delivers injection-shaped labels and memos as literal, defanged text", async () => {
    const { api, notifier } = await telegram();
    const { alerts } = evaluateAll(
      freshState(),
      events([
        ev.agentCreated(T0, RESEARCH, "<a href=x>*bold*</a>"),
        ev.requested(T0 + 1, RESEARCH, USDC, "<b>pay</b> https://evil.com t.me/x @admin ‮ok"),
      ]),
      context(),
    );
    const [request] = alerts;
    if (!request) throw new Error("no alert");
    await notifier.send(request);
    const body = api.calls[0]?.body;
    const text = String(body?.text);
    expect(text).toContain("<a href=x>*bold*</a> asks you to approve 1.00 USDC");
    expect(text).toContain("“<b>pay</b> https[:]//evil[.]com t[.]me/x (at)admin ok”");
    expect(text).not.toMatch(/[‪-‮⁦-⁩]/);
    // The only formatting is our bold title: nothing in the text can add more.
    expect(body?.entities).toEqual([{ type: "bold", offset: 0, length: text.indexOf("\n\n") }]);
    expect(body).not.toHaveProperty("parse_mode");
  });

  it("reports Telegram's refusal without the token", async () => {
    const { api, notifier } = await telegram();
    api.answer = () => ({
      status: 400,
      body: { ok: false, error_code: 400, description: "Bad Request: chat not found" },
    });
    const error = await notifier.send(alert({})).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Telegram refused the message (400: Bad Request: chat not found)",
    );
  });

  it("reports an unreachable Telegram without the token", async () => {
    const notifier = createTelegramNotifier({
      token: TOKEN,
      chatId: CHAT,
      apiRoot: "http://127.0.0.1:9",
    });
    const error = await notifier.send(alert({})).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/^Telegram is not reachable/);
    expect((error as Error).message).not.toContain("TEST-token");
  });
});

describe("message format", () => {
  it("counts the bold title in UTF-16 units, emoji included", () => {
    const message = formatTelegramMessage(alert({ severity: "warning", title: "Spend 😀 spike" }));
    const title = "⚠️ Spend 😀 spike";
    expect(message.text.startsWith(`${title}\n\n`)).toBe(true);
    expect(message.entities).toEqual([{ type: "bold", offset: 0, length: title.length }]);
    expect(title.length).toBe(17); // ⚠️ and 😀 are two units each
  });

  it("knows which URLs Telegram accepts as buttons", () => {
    for (const url of ["https://leash.example/app", "https://8.8.8.8/x"]) {
      expect(isPublicHttpsUrl(url)).toBe(true);
    }
    for (const url of [
      "http://leash.example",
      "https://localhost:3000",
      "https://app.localhost",
      "https://printer.local",
      "https://127.0.0.1",
      "https://10.0.0.2",
      "https://172.20.1.1",
      "https://192.168.1.10",
      "https://[::1]",
      "https://intranet",
      "not a url",
    ]) {
      expect(isPublicHttpsUrl(url), url).toBe(false);
    }
  });
});

describe("choosing notifiers", () => {
  const console = createConsoleNotifier(() => undefined);

  it("uses the console alone without Telegram, and both with it", () => {
    expect(selectNotifiers({}, console).map((n) => n.name)).toEqual(["console"]);
    expect(
      selectNotifiers({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT }, console).map(
        (n) => n.name,
      ),
    ).toEqual(["console", "telegram"]);
  });

  it("stops when only one of the two variables is set, never printing the token", () => {
    const missingChat = () => selectNotifiers({ TELEGRAM_BOT_TOKEN: TOKEN }, console);
    expect(missingChat).toThrow(/TELEGRAM_CHAT_ID is not/);
    expect(missingChat).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("TEST-token") }),
    );
    expect(() => selectNotifiers({ TELEGRAM_CHAT_ID: CHAT }, console)).toThrow(
      /TELEGRAM_BOT_TOKEN is not/,
    );
  });
});
