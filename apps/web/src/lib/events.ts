import { denialInfo, type LeashEvent } from "@leash/contracts";
import { shortAddress } from "./format.ts";
import type { Tone } from "./status.ts";

/** How one event reads in a feed. `memo` is untrusted text: render it as text only (T18). */
export type EventDescription = {
  tone: Tone;
  title: string;
  detail: string | null;
  amount: string | null;
  memo: string | null;
};

/** Names the owner knows (payee and agent labels), keyed by address. */
export type NameBook = ReadonlyMap<string, string>;

function name(book: NameBook, address: string, unknown = "unknown wallet"): string {
  return book.get(address) ?? `${unknown} ${shortAddress(address)}`;
}

/** Plain-language description of any Leash event (02-contracts §6). */
export function describeEvent(event: LeashEvent, book: NameBook): EventDescription {
  const plain = (tone: Tone, title: string, detail: string | null = null): EventDescription => ({
    tone,
    title,
    detail,
    amount: null,
    memo: null,
  });

  switch (event.type) {
    case "PaymentExecuted":
      return {
        tone: "ok",
        title: `Paid ${name(book, event.payee)}`,
        detail: event.requestNonce === null ? null : "Approved by you",
        amount: event.amount,
        memo: event.memo || null,
      };
    case "PaymentDenied": {
      const strike = event.strike ? `Strike ${event.strikes}` : "Not a strike";
      return {
        tone: "blocked",
        title: `Blocked: ${denialInfo(event.reason).ownerCopy}`,
        detail: `To ${name(book, event.payee)} · ${event.tripped ? `${strike}, agent frozen` : strike}`,
        amount: event.amount,
        memo: event.memo || null,
      };
    }
    case "PaymentRequested":
      return {
        tone: "approval",
        title: `Asked to pay ${name(book, event.payee)}`,
        detail: "Waiting for your approval",
        amount: event.amount,
        memo: event.memo || null,
      };
    case "RequestApproved":
      return plain("neutral", "You approved a payment request");
    case "RequestRejected":
      return plain("neutral", "A payment request was rejected");
    case "RequestExpired":
      return plain("neutral", "A payment request expired");
    case "AgentFrozen":
      return plain(
        "frozen",
        event.reason === "tripwire" ? "Froze itself: tripwire" : "Agent frozen",
        event.reason === "tripwire"
          ? "Too many blocked attempts"
          : event.reason === "guardian"
            ? "By your guardian"
            : "By you",
      );
    case "AgentUnfrozen":
      return plain("neutral", "Agent unfrozen");
    case "PrincipalFrozen":
      return plain("frozen", "All agents frozen");
    case "PrincipalUnfrozen":
      return plain("neutral", "All agents unfrozen");
    case "AgentCreated":
      return plain("neutral", `Agent created: ${event.label}`);
    case "AgentClosed":
      return plain("neutral", "Agent closed");
    case "PolicyUpdated":
      return plain("neutral", "Spending rules updated");
    case "PayeeAdded":
      return plain("neutral", `Allowed payee: ${event.label}`);
    case "PayeeUpdated":
      return plain("neutral", `Limits changed for ${event.label}`);
    case "PayeeRemoved":
      return plain("neutral", `Removed payee ${name(book, event.payee, "wallet")}`);
    case "PrincipalInitialized":
      return plain("neutral", "Leash account created");
    case "GuardianChanged":
      return plain("neutral", event.guardian === null ? "Guardian removed" : "Guardian set");
  }
}

/** The label book built from events: agent labels and payee labels (latest wins). */
export function nameBookFrom(events: readonly LeashEvent[]): Map<string, string> {
  const book = new Map<string, string>();
  for (const event of events) {
    if (event.type === "AgentCreated" && event.agent) book.set(event.agent, event.label);
    if (event.type === "PayeeAdded" || event.type === "PayeeUpdated")
      book.set(event.payee, event.label);
  }
  return book;
}
