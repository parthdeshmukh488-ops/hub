import { describe, expect, it } from "vitest";
import { emptyOutcome } from "../src/outcome.ts";
import { oneLine, plain, shortId } from "../src/sanitize.ts";
import { createUi } from "../src/ui.ts";

const SIG =
  "5Vr9xi5nUzSKeS3BFWELhDUeFD46gHgYBvJTJoKEHu4vfC5wE8fGhL4tH94aP74tLbBz154QeFPMADh41du4XaXD";
const ESC = "\u001b";

function screen(color = false, explorer = true) {
  const lines: string[] = [];
  const ui = createUi({
    write: (line) => lines.push(line),
    color,
    explorer: (signature) =>
      explorer ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : null,
  });
  return { ui, lines, text: () => lines.join("\n") };
}

describe("untrusted text on the terminal", () => {
  it("loses every control character and bidi override, and keeps newlines and tabs", () => {
    const hostile = `ok${ESC}[2J${ESC}]0;pwned\u0007\r\u0008 fine‮evil⁦\tand\nmore\u009b31m`;
    expect(plain(hostile)).toBe("ok[2J]0;pwned fineevil\tand\nmore31m");
    expect(oneLine("  a \n\n b\t c  ")).toBe("a b c");
    expect(oneLine("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
    expect(shortId(SIG)).toBe("5Vr9…XaXD");
    expect(shortId("short")).toBe("short");
  });

  it("never prints an escape sequence that came from a page, a label, a memo or the model", () => {
    const { ui, text } = screen(true);
    const attack = `${ESC}[2J${ESC}]8;;https://evil.example${ESC}\\click`;
    ui.say(`Final answer ${attack}`, true);
    ui.say(`Thinking out loud ${attack}`, false);
    ui.thinking(attack);
    ui.call("leash_pay", { to: attack, amountUsdc: attack, purpose: attack });
    ui.result("leash_pay", {
      ok: true,
      payment: {
        signature: SIG,
        amountUsdc: "1.00",
        payee: "p",
        payeeLabel: attack,
        requestNonce: null,
      },
    });
    ui.result("browse", { ok: false, error: attack });
    // The screen's own OSC 8 link is the only one, and it points at the explorer.
    // The hostile text survives only as inert characters, never as an escape sequence.
    expect(text()).not.toContain(`${ESC}[2J`);
    expect(text()).not.toContain(`${ESC}]8;;https://evil.example`);
    expect(text().match(new RegExp(`${ESC}\\]8;;https?://`, "g"))).toHaveLength(1);
    expect(text()).toContain(
      `${ESC}]8;;https://explorer.solana.com/tx/${SIG}?cluster=devnet${ESC}\\tx 5Vr9…XaXD${ESC}]8;;${ESC}\\`,
    );
  });
});

describe("the screen", () => {
  it("shows a payment without a link when no explorer can open it", () => {
    const payment = { signature: SIG, amountUsdc: "0.01", payee: "p", requestNonce: null };
    for (const color of [false, true]) {
      const { ui, text } = screen(color, false);
      ui.result("leash_pay", { ok: true, payment: { ...payment, payeeLabel: "Research API" } });
      expect(text()).toContain("tx 5Vr9…XaXD");
      expect(text()).not.toContain("explorer.solana.com");
      expect(text()).not.toContain(`${ESC}]8;;`);
    }
  });

  it("shows one line per call and per result, in words", () => {
    const { ui, lines } = screen();
    ui.call("leash_fetch", { url: "http://m.test/api/research?q=x", purpose: "Research" });
    ui.call("leash_fetch", { method: "POST", url: "http://m.test/a" });
    ui.call("leash_request_approval", { to: SIG, amountUsdc: "1.50", purpose: "Report" });
    ui.call("leash_status", {});
    ui.call("browse", { url: "http://m.test/" });
    ui.call("mystery", { a: 1 });
    ui.result("leash_fetch", {
      ok: true,
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "x".repeat(1_500),
      payment: null,
    });
    ui.result("leash_request_approval", {
      ok: true,
      request: { address: SIG, nonce: "1", expiresAt: 1, status: "pending" },
    });
    ui.result("browse", { ok: true, status: 402, contentType: "", body: "" });
    ui.result("browse", { ok: true, status: 200, contentType: "text/markdown", body: "hello" });
    ui.result("leash_status", {
      ok: true,
      agent: { label: "R", status: "frozen", freezeReason: "tripwire" },
      allowance: {
        remainingUsdc: "4.93",
        perPeriodUsdc: null,
        periodEndsAt: null,
        expiresAt: null,
      },
      limits: { maxPerPaymentUsdc: "1.00", maxPerRequestUsdc: "5.00" },
      payees: [],
      strikes: 3,
      tripwireMaxStrikes: 3,
    });
    ui.result("leash_pay", {
      ok: false,
      code: "NOT_PAIRED",
      message: "m",
      recorded: false,
      retryable: false,
    });
    ui.result("leash_pay", {
      ok: false,
      code: "VELOCITY_EXCEEDED",
      message: "m",
      recorded: false,
      retryable: false,
    });
    // A frozen agent's block carries the window's strikes, but is not a strike itself.
    ui.result("leash_pay", {
      ok: false,
      code: "AGENT_FROZEN",
      message: "m",
      recorded: true,
      strikes: 3,
      retryable: false,
    });
    ui.result("mystery", { ok: true });
    expect(lines).toEqual([
      "  → leash_fetch GET http://m.test/api/research?q=x · “Research”",
      "  → leash_fetch POST http://m.test/a",
      `  → leash_request_approval 1.50 USDC → 5Vr9…XaXD · “Report”`,
      "  → leash_status",
      "  → browse http://m.test/",
      '  → mystery {"a":1}',
      "    ✓ 200 text/html · 1.5 k chars · free",
      "    ⏸ approval requested (request 5Vr9…XaXD)",
      "    – 402 payment required: browse never pays",
      "    ✓ 200 text/markdown · 5 chars · free",
      "    ✓ frozen (tripwire) · 4.93 USDC left · strikes 3/3",
      "    ✗ NOT_PAIRED",
      "    ✗ BLOCKED: too many payments too fast",
      "    ✗ BLOCKED: this agent is paused · recorded on-chain",
      "    ✓",
    ]);
  });

  it("never prints ✓ for an HTTP status of 400 or above", () => {
    const { ui, lines } = screen();
    ui.result("leash_fetch", {
      ok: true,
      status: 500,
      contentType: "text/plain",
      body: "boom",
      payment: null,
    });
    ui.result("leash_fetch", {
      ok: true,
      status: 503,
      contentType: "text/plain",
      body: "",
      payment: {
        signature: SIG,
        amountUsdc: "0.01",
        payee: "p",
        payeeLabel: "Research API",
        requestNonce: null,
      },
    });
    ui.result("browse", { ok: true, status: 404, contentType: "text/html", body: "" });
    expect(lines).toEqual([
      "    ✗ the merchant answered 500 text/plain · not paid",
      `    ✗ the merchant answered 503 text/plain · paid 0.01 USDC → Research API · tx 5Vr9…XaXD https://explorer.solana.com/tx/${SIG}?cluster=devnet`,
      "    ✗ 404 text/html",
    ]);
    expect(lines.join("\n")).not.toContain("✓");
  });

  it("counts strikes against the tripwire once it knows the limit, and sums up a scene", () => {
    const { ui, lines } = screen();
    const blocked = {
      ok: false,
      code: "PAYEE_NOT_ALLOWED",
      message: "m",
      recorded: true,
      strikes: 1,
      retryable: false,
    };
    ui.result("leash_pay", blocked);
    ui.agentStatus({
      ok: true,
      agent: { label: "R", status: "active", freezeReason: null },
      allowance: { remainingUsdc: "5.00", perPeriodUsdc: "5.00", periodEndsAt: 1, expiresAt: null },
      limits: { maxPerPaymentUsdc: "1.00", maxPerRequestUsdc: "5.00" },
      payees: [],
      strikes: 0,
      tripwireMaxStrikes: 3,
    });
    ui.result("leash_pay", { ...blocked, strikes: 2 });
    ui.summary({
      ...emptyOutcome(),
      payments: [{ amountUsdc: "0.01", payee: "p", payeeLabel: null, signature: SIG }],
      blocked: [{ code: "PAYEE_NOT_ALLOWED", strike: true }],
    });
    ui.summary(emptyOutcome());
    expect(lines).toEqual([
      "    ✗ BLOCKED: tried to pay someone not on the allowlist · strike 1 · recorded on-chain",
      "  Agent: active · 5.00 of 5.00 USDC left · strikes 0/3",
      "    ✗ BLOCKED: tried to pay someone not on the allowlist · strike 2/3 · recorded on-chain",
      "",
      "  Summary: spent 0.01 USDC in 1 payment · 1 blocked (1 strike) · agent active",
      "",
      "  Summary: spent 0.00 USDC in 0 payments · 0 blocked · agent active",
    ]);
  });
});
