import type { LeashEvent } from "@leash/contracts";
import { describeEvent, type NameBook } from "./events.ts";
import { usdc } from "./format.ts";

const HEADER = [
  "time_utc",
  "type",
  "agent",
  "counterparty",
  "amount_usdc",
  "summary",
  "detail",
  "memo",
  "signature",
];

/**
 * One CSV field. Memos and labels are written by agents and payees, so a value that a
 * spreadsheet would run as a formula (=, +, -, @, tab, CR) is prefixed with a quote.
 */
export function csvField(value: string): string {
  const inert = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${inert.replaceAll('"', '""')}"`;
}

/** The activity log as CSV (RFC 4180, CRLF line ends), newest first as shown. */
export function eventsToCsv(events: readonly LeashEvent[], names: NameBook): string {
  const rows = events.map((event) => {
    const d = describeEvent(event, names);
    const counterparty = "payee" in event ? (names.get(event.payee) ?? event.payee) : "";
    return [
      new Date(event.timestamp * 1000).toISOString(),
      event.type,
      event.agent ? (names.get(event.agent) ?? event.agent) : "",
      counterparty,
      d.amount === null ? "" : usdc(d.amount),
      d.title,
      d.detail ?? "",
      d.memo ?? "",
      event.signature,
    ];
  });
  return `${[HEADER, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
