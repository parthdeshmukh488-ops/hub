import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  DemoStorylineSchema,
  encodeLabel,
  encodeMemo,
  type LeashEvent,
  type LeashEventOf,
  LeashEventSchema,
  referenceFromHex,
} from "@leash/contracts";
import { type Address, getBase58Decoder, none, type Option, some } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  DENIAL_REASON_FROM_CHAIN,
  FREEZE_REASON_FROM_CHAIN,
  policyFromView,
} from "../src/convert.ts";
import * as gen from "../src/generated/leash/index.ts";
import {
  decodeLeashEventData,
  decodeLeashEvents,
  EVENT_IX_TAG,
  isEventData,
  LEASH_PROGRAM_ADDRESS,
  transactionRecordFromRpc,
} from "../src/index.ts";

// Every event type through the generated codecs and back: the JSON the decoder produces must be
// exactly the contract JSON (02-contracts §6). The storyline covers eight types; the other ten
// are written here.

const require = createRequire(import.meta.url);
const storyline = DemoStorylineSchema.parse(
  JSON.parse(
    readFileSync(require.resolve("@leash/contracts/fixtures/demo-storyline.json"), "utf8"),
  ),
);

const invert = <K extends number, V extends string>(map: Record<K, V>) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [v, Number(k)])) as unknown as Record<
    V,
    K
  >;
const FREEZE_REASON_TO_CHAIN = invert(FREEZE_REASON_FROM_CHAIN);
const DENIAL_REASON_TO_CHAIN = invert(DENIAL_REASON_FROM_CHAIN);

const a = (value: string) => value as Address;
const optional = <T>(value: T | null): Option<T> => (value === null ? none() : some(value));

/** The on-chain bytes the program would emit for a JSON event (the inverse of the decoder). */
function emitted(event: LeashEvent): Uint8Array {
  const ts = BigInt(event.timestamp);
  const payload = ((): Uint8Array => {
    switch (event.type) {
      case "PrincipalInitialized":
        return new Uint8Array(
          gen.getPrincipalInitializedEventEncoder().encode({
            principal: a(event.principal ?? ""),
            owner: a(event.owner),
            guardian: optional(event.guardian === null ? null : a(event.guardian)),
            timestamp: ts,
          }),
        );
      case "GuardianChanged":
        return new Uint8Array(
          gen.getGuardianChangedEventEncoder().encode({
            principal: a(event.principal ?? ""),
            guardian: optional(event.guardian === null ? null : a(event.guardian)),
            timestamp: ts,
          }),
        );
      case "PrincipalFrozen":
        return new Uint8Array(
          gen.getPrincipalFrozenEventEncoder().encode({
            principal: a(event.principal ?? ""),
            by: a(event.by),
            timestamp: ts,
          }),
        );
      case "PrincipalUnfrozen":
        return new Uint8Array(
          gen
            .getPrincipalUnfrozenEventEncoder()
            .encode({ principal: a(event.principal ?? ""), timestamp: ts }),
        );
      case "AgentCreated":
        return new Uint8Array(
          gen.getAgentCreatedEventEncoder().encode({
            principal: a(event.principal ?? ""),
            agent: a(event.agent ?? ""),
            agentKey: a(event.agentKey),
            mint: a(event.mint),
            label: encodeLabel(event.label),
            policy: policyFromView(event.policy),
            timestamp: ts,
          }),
        );
      case "PolicyUpdated":
        return new Uint8Array(
          gen.getPolicyUpdatedEventEncoder().encode({
            agent: a(event.agent ?? ""),
            policy: policyFromView(event.policy),
            timestamp: ts,
          }),
        );
      case "AgentFrozen":
        return new Uint8Array(
          gen.getAgentFrozenEventEncoder().encode({
            agent: a(event.agent ?? ""),
            reason: FREEZE_REASON_TO_CHAIN[event.reason],
            by: a(event.by),
            timestamp: ts,
          }),
        );
      case "AgentUnfrozen":
        return new Uint8Array(
          gen.getAgentUnfrozenEventEncoder().encode({ agent: a(event.agent ?? ""), timestamp: ts }),
        );
      case "AgentClosed":
        return new Uint8Array(
          gen.getAgentClosedEventEncoder().encode({
            principal: a(event.principal ?? ""),
            agent: a(event.agent ?? ""),
            timestamp: ts,
          }),
        );
      case "PayeeAdded":
      case "PayeeUpdated": {
        const args = {
          agent: a(event.agent ?? ""),
          payee: a(event.payee),
          label: encodeLabel(event.label),
          limits: {
            maxPerPayment: BigInt(event.maxPerPayment),
            periodLimit: BigInt(event.periodLimit),
            periodSecs: event.periodSecs,
          },
          timestamp: ts,
        };
        return new Uint8Array(
          event.type === "PayeeAdded"
            ? gen.getPayeeAddedEventEncoder().encode(args)
            : gen.getPayeeUpdatedEventEncoder().encode(args),
        );
      }
      case "PayeeRemoved":
        return new Uint8Array(
          gen
            .getPayeeRemovedEventEncoder()
            .encode({ agent: a(event.agent ?? ""), payee: a(event.payee), timestamp: ts }),
        );
      case "PaymentExecuted":
        return new Uint8Array(
          gen.getPaymentExecutedEventEncoder().encode({
            principal: a(event.principal ?? ""),
            agent: a(event.agent ?? ""),
            payee: a(event.payee),
            destination: a(event.destination),
            mint: a(event.mint),
            amount: BigInt(event.amount),
            reference: referenceFromHex(event.reference),
            memo: encodeMemo(event.memo),
            delegation: a(event.delegation),
            requestNonce: optional(event.requestNonce === null ? null : BigInt(event.requestNonce)),
            paymentsCount: BigInt(event.paymentsCount),
            timestamp: ts,
          }),
        );
      case "PaymentDenied":
        return new Uint8Array(
          gen.getPaymentDeniedEventEncoder().encode({
            principal: a(event.principal ?? ""),
            agent: a(event.agent ?? ""),
            payee: a(event.payee),
            destination: a(event.destination),
            amount: BigInt(event.amount),
            reason: DENIAL_REASON_TO_CHAIN[event.reason],
            strikes: event.strikes,
            tripped: event.tripped,
            reference: referenceFromHex(event.reference),
            memo: encodeMemo(event.memo),
            timestamp: ts,
          }),
        );
      case "PaymentRequested":
        return new Uint8Array(
          gen.getPaymentRequestedEventEncoder().encode({
            agent: a(event.agent ?? ""),
            request: a(event.request),
            nonce: BigInt(event.nonce),
            payee: a(event.payee),
            amount: BigInt(event.amount),
            reference: referenceFromHex(event.reference),
            memo: encodeMemo(event.memo),
            expiresAt: BigInt(event.expiresAt),
            timestamp: ts,
          }),
        );
      case "RequestApproved":
      case "RequestExpired": {
        const args = {
          agent: a(event.agent ?? ""),
          request: a(event.request),
          nonce: BigInt(event.nonce),
          timestamp: ts,
        };
        return new Uint8Array(
          event.type === "RequestApproved"
            ? gen.getRequestApprovedEventEncoder().encode(args)
            : gen.getRequestExpiredEventEncoder().encode(args),
        );
      }
      case "RequestRejected":
        return new Uint8Array(
          gen.getRequestRejectedEventEncoder().encode({
            agent: a(event.agent ?? ""),
            request: a(event.request),
            nonce: BigInt(event.nonce),
            by: a(event.by),
            timestamp: ts,
          }),
        );
    }
  })();
  return new Uint8Array([...EVENT_IX_TAG, ...payload]);
}

const s = storyline.keys;
const researchAgent = storyline.events.find((e) => e.type === "AgentCreated");
if (researchAgent?.type !== "AgentCreated") throw new Error("storyline without an agent");
const principal = researchAgent.principal ?? "";
const agent = researchAgent.agent ?? "";
const base = {
  signature: storyline.events[0]?.signature ?? "",
  slot: 1,
  blockTime: 1_790_935_300,
  timestamp: 1_790_935_300,
};
const request = s.researchRequest0 ?? "";

/** The ten event types the storyline does not contain. */
const extra: LeashEvent[] = [
  {
    ...base,
    id: `${base.signature}:0`,
    type: "GuardianChanged",
    principal,
    agent: null,
    guardian: s.guardian ?? null,
  },
  {
    ...base,
    id: `${base.signature}:0`,
    type: "PrincipalFrozen",
    principal,
    agent: null,
    by: s.owner ?? "",
  },
  { ...base, id: `${base.signature}:0`, type: "PrincipalUnfrozen", principal, agent: null },
  {
    ...base,
    id: `${base.signature}:0`,
    type: "PolicyUpdated",
    principal: principal,
    agent,
    policy: researchAgent.policy,
  },
  { ...base, id: `${base.signature}:0`, type: "AgentUnfrozen", principal: principal, agent },
  { ...base, id: `${base.signature}:0`, type: "AgentClosed", principal, agent },
  {
    ...base,
    id: `${base.signature}:0`,
    type: "PayeeUpdated",
    principal: principal,
    agent,
    payee: s.merchant ?? "",
    label: "Research API — ünï",
    maxPerPayment: "0",
    periodLimit: "18446744073709551615",
    periodSecs: 4_294_967_295,
  },
  {
    ...base,
    id: `${base.signature}:0`,
    type: "PayeeRemoved",
    principal: principal,
    agent,
    payee: s.merchant ?? "",
  },
  {
    ...base,
    id: `${base.signature}:0`,
    type: "RequestRejected",
    principal: principal,
    agent,
    request,
    nonce: "18446744073709551615",
    by: s.guardian ?? s.owner ?? "",
  },
  {
    ...base,
    id: `${base.signature}:0`,
    type: "RequestExpired",
    principal: principal,
    agent,
    request,
    nonce: "0",
  },
].map((event) => LeashEventSchema.parse(event));

/** Each agent's principal, as the indexer knows it from `AgentCreated`. */
const principals = new Map(
  storyline.events.flatMap((e) =>
    e.type === "AgentCreated" && e.agent && e.principal ? [[e.agent, e.principal]] : [],
  ),
);
const principalOf = (a: string) => principals.get(a) ?? null;

/** A decoder input with the event's own transaction fields. */
const decode = (event: LeashEvent) =>
  decodeLeashEventData(
    emitted(event),
    { id: event.id, signature: event.signature, slot: event.slot, blockTime: event.blockTime },
    { principalOf },
  );

describe("decodeLeashEventData", () => {
  it.each(storyline.events.map((e) => [e.type, e.id, e] as const))(
    "storyline %s (%s) decodes to its exact JSON",
    (_type, _id, event) => {
      expect(decode(event)).toEqual(event);
    },
  );

  it.each(extra.map((e) => [e.type, e] as const))(
    "%s decodes to its exact JSON",
    (_type, event) => {
      expect(decode(event)).toEqual(event);
    },
  );

  it("covers all 18 event types between the storyline and the extra cases", () => {
    const types = new Set([...storyline.events, ...extra].map((e) => e.type));
    expect(types.size).toBe(18);
  });

  it("leaves an agent-level event's principal null without a lookup", () => {
    const frozen = storyline.events.find((e) => e.type === "AgentFrozen");
    if (!frozen) throw new Error("storyline without a freeze");
    const decoded = decodeLeashEventData(emitted(frozen), {
      id: frozen.id,
      signature: frozen.signature,
      slot: frozen.slot,
      blockTime: frozen.blockTime,
    });
    expect(decoded).toEqual({ ...frozen, principal: null });
  });

  it("derives the denial's code and strike flag from its reason", () => {
    const denied = storyline.events.find(
      (e): e is LeashEventOf<"PaymentDenied"> => e.type === "PaymentDenied",
    );
    if (!denied) throw new Error("storyline without a denial");
    const decoded = decode({ ...denied, reason: "velocityExceeded", reasonCode: 9, strike: false });
    expect(decoded).toMatchObject({ reason: "velocityExceeded", reasonCode: 9, strike: false });
  });

  it("rejects data that is not an event", () => {
    const event = storyline.events[0];
    if (!event) throw new Error("empty storyline");
    const data = emitted(event);
    const untagged = data.slice(8);
    expect(isEventData(untagged)).toBe(false);
    expect(isEventData(data.slice(0, 15))).toBe(false);
    expect(() =>
      decodeLeashEventData(untagged, {
        id: event.id,
        signature: event.signature,
        slot: 1,
        blockTime: 1,
      }),
    ).toThrow(/not Leash event data/);
  });
});

describe("decodeLeashEvents", () => {
  // The tripwire report: PaymentDenied (:0) and AgentFrozen (:1) in one transaction.
  const shared = storyline.events.filter(
    (e) => storyline.events.filter((o) => o.signature === e.signature).length === 2,
  );
  const [first, second] = shared;
  if (!first || !second) throw new Error("storyline without a two-event transaction");
  const other = {
    programAddress: "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo" as Address,
    data: new Uint8Array([1, 2, 3]),
  };

  it("numbers a transaction's Leash events from 0 and skips other inner instructions", () => {
    const events = decodeLeashEvents(
      {
        signature: first.signature,
        slot: first.slot,
        blockTime: first.blockTime,
        err: null,
        innerInstructions: [
          other,
          { programAddress: LEASH_PROGRAM_ADDRESS, data: emitted(first) },
          { programAddress: LEASH_PROGRAM_ADDRESS, data: new Uint8Array([9, 9]) },
          { programAddress: LEASH_PROGRAM_ADDRESS, data: emitted(second) },
        ],
      },
      { principalOf },
    );
    expect(events).toEqual([first, second]);
  });

  it("ignores event-shaped data from another program", () => {
    const events = decodeLeashEvents({
      signature: first.signature,
      slot: first.slot,
      blockTime: first.blockTime,
      err: null,
      innerInstructions: [{ ...other, data: emitted(first) }],
    });
    expect(events).toEqual([]);
  });

  it("returns nothing for a failed transaction", () => {
    const events = decodeLeashEvents({
      signature: first.signature,
      slot: first.slot,
      blockTime: first.blockTime,
      err: { InstructionError: [0, { Custom: 6003 }] },
      innerInstructions: [{ programAddress: LEASH_PROGRAM_ADDRESS, data: emitted(first) }],
    });
    expect(events).toEqual([]);
  });

  it("falls back to the event's timestamp when the block time is unknown", () => {
    const [event] = decodeLeashEvents({
      signature: first.signature,
      slot: first.slot,
      blockTime: null,
      err: null,
      innerInstructions: [{ programAddress: LEASH_PROGRAM_ADDRESS, data: emitted(first) }],
    });
    expect(event?.blockTime).toBe(first.timestamp);
  });
});

describe("transactionRecordFromRpc", () => {
  const event = storyline.events[0];
  if (!event) throw new Error("empty storyline");
  const base58 = getBase58Decoder();
  const staticKeys = ["11111111111111111111111111111111", LEASH_PROGRAM_ADDRESS] as Address[];
  const loaded = {
    writable: ["SysvarC1ock11111111111111111111111111111111" as Address],
    readonly: [LEASH_PROGRAM_ADDRESS],
  };

  it("resolves program indexes through static and loaded keys, in inner-instruction order", () => {
    const record = transactionRecordFromRpc({
      slot: 5n,
      blockTime: 7n,
      meta: {
        err: null,
        loadedAddresses: loaded,
        innerInstructions: [
          { index: 2, instructions: [{ programIdIndex: 3, data: base58.decode(emitted(event)) }] },
          {
            index: 0,
            instructions: [{ programIdIndex: 1, data: base58.decode(new Uint8Array([1])) }],
          },
        ],
      },
      transaction: { message: { accountKeys: staticKeys }, signatures: [event.signature] },
    });
    expect(record.innerInstructions.map((i) => i.programAddress)).toEqual([
      LEASH_PROGRAM_ADDRESS,
      LEASH_PROGRAM_ADDRESS,
    ]);
    expect(record.innerInstructions[0]?.data).toEqual(new Uint8Array([1]));
    expect(decodeLeashEvents(record)).toHaveLength(1);
    expect(record).toMatchObject({
      signature: event.signature,
      slot: 5n,
      blockTime: 7n,
      err: null,
    });
  });

  it("handles a response without meta or inner instructions", () => {
    const record = transactionRecordFromRpc({
      slot: 1,
      blockTime: null,
      meta: null,
      transaction: { message: { accountKeys: staticKeys }, signatures: ["sig"] },
    });
    expect(record).toEqual({
      signature: "sig",
      slot: 1,
      blockTime: null,
      err: null,
      innerInstructions: [],
    });
  });

  it("refuses malformed responses", () => {
    const transaction = { message: { accountKeys: staticKeys }, signatures: [] as string[] };
    expect(() =>
      transactionRecordFromRpc({ slot: 1, blockTime: null, meta: null, transaction }),
    ).toThrow(/signature/);
    expect(() =>
      transactionRecordFromRpc({
        slot: 1,
        blockTime: null,
        meta: {
          err: null,
          innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 9, data: "" }] }],
        },
        transaction: { message: { accountKeys: staticKeys }, signatures: ["sig"] },
      }),
    ).toThrow(/out of range/);
  });
});
