import { styleText } from "node:util";
import { DENIAL_REASONS, parseUsdc } from "@leash/contracts";
import type { Outcome } from "./outcome.ts";
import { oneLine, plain, shortId } from "./sanitize.ts";

// The demo's screen (WS7 brief): one line per step (thinking → tool → result), payments green with
// the amount and an explorer link, blocks red with the reason and the strike count, a banner when
// the tripwire freezes the agent, and a summary. Every untrusted string goes through `plain`.

type Style = "green" | "red" | "yellow" | "cyan" | "dim" | "bold" | "magenta";

export type UiOptions = {
  write(line: string): void;
  /** Colours and clickable links (OSC 8). Off: plain text with full URLs, for logs and tests. */
  color: boolean;
  explorer(signature: string): string;
};

export type Ui = ReturnType<typeof createUi>;

const OWNER_COPY = new Map<string, string>(DENIAL_REASONS.map((d) => [d.toolCode, d.ownerCopy]));
/** Denials that count as strikes; the others carry the window's count but are not one. */
const STRIKE_CODES = new Set<string>(DENIAL_REASONS.filter((d) => d.strike).map((d) => d.toolCode));

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** An HTTP status of 400 or above. */
const failed = (status: unknown) => typeof status === "number" && status >= 400;

function size(chars: number): string {
  return chars >= 1_000 ? `${(chars / 1_000).toFixed(1)} k chars` : `${chars} chars`;
}

export function createUi(options: UiOptions) {
  const paint = (style: Style | Style[], value: string) =>
    options.color ? styleText(style, value, { validateStream: false }) : value;
  const link = (label: string, url: string) =>
    options.color ? `\u001b]8;;${url}\u001b\\${label}\u001b]8;;\u001b\\` : `${label} ${url}`;
  const line = (value = "") => options.write(value);
  /** The tripwire limit, learned from leash_status. */
  let maxStrikes: number | null = null;

  function describeCall(name: string, input: unknown): string {
    const args = record(input);
    const purpose = text(args.purpose) ? ` · “${oneLine(text(args.purpose), 60)}”` : "";
    switch (name) {
      case "leash_fetch":
        return `${text(args.method) || "GET"} ${oneLine(text(args.url), 90)}${purpose}`;
      case "leash_pay":
      case "leash_request_approval":
        return `${oneLine(text(args.amountUsdc), 20)} USDC → ${shortId(text(args.to))}${purpose}`;
      case "browse":
        return oneLine(text(args.url), 100);
      case "leash_status":
        return "";
      default:
        return oneLine(JSON.stringify(input) ?? "", 80);
    }
  }

  function payment(receipt: Record<string, unknown>, mark = "✓ "): string {
    const to = text(receipt.payeeLabel) || shortId(text(receipt.payee));
    const signature = text(receipt.signature);
    const tx = link(`tx ${shortId(signature)}`, options.explorer(signature));
    const approved = receipt.requestNonce ? " · approved request" : "";
    return (
      paint(
        "green",
        `${mark}paid ${oneLine(text(receipt.amountUsdc), 20)} USDC → ${oneLine(to, 40)}${approved} · `,
      ) + tx
    );
  }

  function denial(output: Record<string, unknown>): string {
    const code = text(output.code);
    if (code === "APPROVAL_REQUIRED") {
      return paint("yellow", "⏸ above the instant limit: approval request sent to the owner");
    }
    const copy = OWNER_COPY.get(code);
    if (!copy) return paint("red", `✗ ${code}`);
    const parts = [`✗ BLOCKED: ${copy.toLowerCase()}`];
    if (STRIKE_CODES.has(code) && typeof output.strikes === "number" && output.strikes > 0) {
      parts.push(
        maxStrikes ? `strike ${output.strikes}/${maxStrikes}` : `strike ${output.strikes}`,
      );
    }
    if (output.recorded === true) parts.push("recorded on-chain");
    return paint("red", parts.join(" · "));
  }

  function describeResult(name: string, value: unknown): string {
    const output = record(value);
    if (output.ok !== true) {
      return "code" in output
        ? denial(output)
        : paint("red", `✗ ${oneLine(text(output.error), 100)}`);
    }
    switch (name) {
      case "leash_fetch": {
        const status = `${output.status} ${oneLine(text(output.contentType).split(";")[0] ?? "", 30)}`;
        // A failed request never gets a ✓, paid or not.
        if (failed(output.status)) {
          const paid = output.payment ? ` · ${payment(record(output.payment), "")}` : " · not paid";
          return `${paint("red", `✗ the merchant answered ${status}`)}${paid}`;
        }
        return output.payment
          ? `${payment(record(output.payment))} · ${status}`
          : paint("dim", `✓ ${status} · ${size(text(output.body).length)} · free`);
      }
      case "leash_pay":
        return payment(record(output.payment));
      case "leash_request_approval":
        return paint(
          "yellow",
          `⏸ approval requested (request ${shortId(text(record(output.request).address))})`,
        );
      case "leash_status": {
        const agent = record(output.agent);
        const allowance = record(output.allowance);
        maxStrikes =
          typeof output.tripwireMaxStrikes === "number" ? output.tripwireMaxStrikes : null;
        const frozen =
          agent.status === "frozen" ? ` (${oneLine(text(agent.freezeReason), 20)})` : "";
        const of = allowance.perPeriodUsdc ? ` of ${text(allowance.perPeriodUsdc)}` : "";
        return `✓ ${text(agent.status)}${frozen} · ${text(allowance.remainingUsdc)}${of} USDC left · strikes ${output.strikes}/${output.tripwireMaxStrikes}`;
      }
      case "browse":
        if (output.status === 402) {
          return paint("yellow", "– 402 payment required: browse never pays");
        }
        if (failed(output.status)) {
          return paint(
            "red",
            `✗ ${output.status} ${oneLine(text(output.contentType).split(";")[0] ?? "", 30)}`,
          );
        }
        return paint(
          "dim",
          `✓ ${output.status} ${oneLine(text(output.contentType).split(";")[0] ?? "", 30)} · ${size(text(output.body).length)} · free`,
        );
      default:
        return "✓";
    }
  }

  return {
    header(title: string, facts: string[]) {
      line(
        paint("bold", `━━ ${title} ━━`) +
          paint("dim", ` ${facts.map((f) => plain(f)).join(" · ")}`),
      );
    },
    /** The agent's status before the scenes; also teaches the screen the tripwire limit. */
    agentStatus(output: unknown) {
      line(`  ${describeResult("leash_status", output).replace("✓ ", "Agent: ")}`);
    },
    scene(title: string, task: string) {
      line();
      line(paint(["bold", "magenta"], `▶ ${title}`));
      line(paint("dim", `  Task: ${oneLine(task, 400)}`));
    },
    notice(message: string) {
      line(paint("yellow", `  ⚠ ${oneLine(message, 300)}`));
    },
    thinking(value: string) {
      line(paint("dim", `  · ${oneLine(value)}`));
    },
    /** The model's words: one line between tool calls, in full when it is the answer. */
    say(value: string, final: boolean) {
      if (!final) {
        line(`  » ${oneLine(value)}`);
        return;
      }
      line();
      for (const paragraph of plain(value).trim().split("\n")) line(`  ${paragraph}`);
    },
    call(name: string, input: unknown) {
      const detail = describeCall(name, input);
      line(`  ${paint("cyan", `→ ${plain(name)}`)}${detail ? ` ${detail}` : ""}`);
    },
    result(name: string, output: unknown) {
      line(`    ${describeResult(name, output)}`);
    },
    tripwire() {
      const bar = "█".repeat(72);
      line(paint("red", `  ${bar}`));
      line(
        paint(["red", "bold"], "  TRIPWIRE: repeated blocked payments froze this agent on-chain."),
      );
      line(paint("red", "  No payment goes through until the owner unfreezes it."));
      line(paint("red", `  ${bar}`));
    },
    waiting(message: string) {
      line(paint("yellow", `  ⏸ ${oneLine(message, 200)}`));
    },
    error(message: string) {
      line(paint("red", `  ! ${oneLine(message, 200)}`));
    },
    summary(outcome: Outcome) {
      const spent = outcome.payments.reduce((sum, p) => sum + parseUsdc(p.amountUsdc), 0n);
      const strikes = outcome.blocked.filter((b) => b.strike).length;
      const parts = [
        `spent ${formatSpent(spent)} USDC in ${outcome.payments.length} payment${outcome.payments.length === 1 ? "" : "s"}`,
        `${outcome.blocked.length} blocked${strikes ? ` (${strikes} strike${strikes === 1 ? "" : "s"})` : ""}`,
        outcome.frozen ? paint("red", "agent frozen") : "agent active",
      ];
      line();
      line(`  ${paint("bold", "Summary:")} ${parts.join(" · ")}`);
    },
  };
}

function formatSpent(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const cents = (baseUnits % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${cents}`;
}
