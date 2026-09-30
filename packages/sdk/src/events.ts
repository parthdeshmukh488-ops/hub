import {
  decodeLabel,
  decodeMemo,
  denialInfo,
  type LeashEvent,
  LeashEventSchema,
  referenceToHex,
} from "@leash/contracts";
import {
  type Address,
  containsBytes,
  getBase58Encoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { DENIAL_REASON_FROM_CHAIN, FREEZE_REASON_FROM_CHAIN, policyToView } from "./convert.ts";
import {
  getAgentClosedEventDecoder,
  getAgentCreatedEventDecoder,
  getAgentFrozenEventDecoder,
  getAgentUnfrozenEventDecoder,
  getGuardianChangedEventDecoder,
  getPayeeAddedEventDecoder,
  getPayeeRemovedEventDecoder,
  getPayeeUpdatedEventDecoder,
  getPaymentDeniedEventDecoder,
  getPaymentExecutedEventDecoder,
  getPaymentRequestedEventDecoder,
  getPolicyUpdatedEventDecoder,
  getPrincipalFrozenEventDecoder,
  getPrincipalInitializedEventDecoder,
  getPrincipalUnfrozenEventDecoder,
  getRequestApprovedEventDecoder,
  getRequestExpiredEventDecoder,
  getRequestRejectedEventDecoder,
  identifyLeashEvent,
  LeashEvent as LeashEventKind,
} from "./generated/leash/index.ts";
import { LEASH_PROGRAM_ADDRESS } from "./pda.ts";

// Decoding the Leash program's events (02-contracts §6). The program emits them with Anchor's
// `emit_cpi!`: a self-invocation whose data is the 8-byte event-CPI tag, the event's 8-byte
// discriminator, then the Borsh fields. Only such inner instructions of a successful
// transaction are events; the event authority's signature means no one else can make them.

/** Anchor's `EVENT_IX_TAG` (0x1d9acb512ea545e4), little-endian. */
export const EVENT_IX_TAG = new Uint8Array([228, 69, 165, 46, 81, 203, 154, 29]);

/** An inner instruction: the program it invoked and its data. */
export type InnerInstructionRecord = { programAddress: Address; data: ReadonlyUint8Array };

/** What event decoding needs from a transaction. */
export type TransactionRecord = {
  signature: string;
  slot: bigint | number;
  /** Unix seconds; null if the node doesn't know it (the event's own timestamp is used). */
  blockTime: bigint | number | null;
  /** Null for a successful transaction. A failed one's events were reverted. */
  err: unknown;
  /** Every inner instruction, in execution order. */
  innerInstructions: readonly InnerInstructionRecord[];
};

type EventBase = {
  id: string;
  signature: string;
  slot: number;
  blockTime: number;
  timestamp: number;
};

const bytes = (value: ReadonlyUint8Array) => new Uint8Array(value);
const seconds = (value: bigint) => Number(value);
const orNull = <T>(value: { __option: "Some"; value: T } | { __option: "None" }): T | null =>
  value.__option === "Some" ? value.value : null;

/** Whether inner-instruction data is a Leash event (starts with the event-CPI tag). */
export function isEventData(data: ReadonlyUint8Array): boolean {
  return data.length >= 16 && containsBytes(data, EVENT_IX_TAG, 0);
}

/** Options of event decoding. */
export type DecodeOptions = {
  /**
   * The principal of an agent. Agent-level events (policy, freeze, payees, requests) don't
   * carry it on-chain; with this lookup (the indexer knows it from `AgentCreated`) their JSON
   * gets it, and without it their `principal` is null, as 02-contracts §6 allows.
   */
  principalOf?: (agent: string) => string | null;
};

/**
 * Decodes one event from its inner-instruction data into the contract JSON. `base` supplies the
 * transaction fields. Throws if the data is not a Leash event.
 */
export function decodeLeashEventData(
  data: ReadonlyUint8Array,
  base: Omit<EventBase, "timestamp">,
  options: DecodeOptions = {},
): LeashEvent {
  if (!isEventData(data)) throw new Error("not Leash event data");
  const payload = data.slice(8);
  const at = (timestamp: bigint) => ({ ...base, timestamp: seconds(timestamp) });
  const json = ((): Record<string, unknown> => {
    switch (identifyLeashEvent(payload)) {
      case LeashEventKind.PrincipalInitialized: {
        const e = getPrincipalInitializedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "PrincipalInitialized",
          principal: e.principal,
          agent: null,
          owner: e.owner,
          guardian: orNull(e.guardian),
        };
      }
      case LeashEventKind.GuardianChanged: {
        const e = getGuardianChangedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "GuardianChanged",
          principal: e.principal,
          agent: null,
          guardian: orNull(e.guardian),
        };
      }
      case LeashEventKind.PrincipalFrozen: {
        const e = getPrincipalFrozenEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "PrincipalFrozen",
          principal: e.principal,
          agent: null,
          by: e.by,
        };
      }
      case LeashEventKind.PrincipalUnfrozen: {
        const e = getPrincipalUnfrozenEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "PrincipalUnfrozen",
          principal: e.principal,
          agent: null,
        };
      }
      case LeashEventKind.AgentCreated: {
        const e = getAgentCreatedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "AgentCreated",
          principal: e.principal,
          agent: e.agent,
          agentKey: e.agentKey,
          mint: e.mint,
          label: decodeLabel(bytes(e.label)),
          policy: policyToView(e.policy),
        };
      }
      case LeashEventKind.PolicyUpdated: {
        const e = getPolicyUpdatedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "PolicyUpdated",
          principal: null,
          agent: e.agent,
          policy: policyToView(e.policy),
        };
      }
      case LeashEventKind.AgentFrozen: {
        const e = getAgentFrozenEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "AgentFrozen",
          principal: null,
          agent: e.agent,
          reason: FREEZE_REASON_FROM_CHAIN[e.reason],
          by: e.by,
        };
      }
      case LeashEventKind.AgentUnfrozen: {
        const e = getAgentUnfrozenEventDecoder().decode(payload);
        return { ...at(e.timestamp), type: "AgentUnfrozen", principal: null, agent: e.agent };
      }
      case LeashEventKind.AgentClosed: {
        const e = getAgentClosedEventDecoder().decode(payload);
        return { ...at(e.timestamp), type: "AgentClosed", principal: e.principal, agent: e.agent };
      }
      case LeashEventKind.PayeeAdded:
      case LeashEventKind.PayeeUpdated: {
        const updated = identifyLeashEvent(payload) === LeashEventKind.PayeeUpdated;
        const e = updated
          ? getPayeeUpdatedEventDecoder().decode(payload)
          : getPayeeAddedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: updated ? "PayeeUpdated" : "PayeeAdded",
          principal: null,
          agent: e.agent,
          payee: e.payee,
          label: decodeLabel(bytes(e.label)),
          maxPerPayment: e.limits.maxPerPayment.toString(),
          periodLimit: e.limits.periodLimit.toString(),
          periodSecs: e.limits.periodSecs,
        };
      }
      case LeashEventKind.PayeeRemoved: {
        const e = getPayeeRemovedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "PayeeRemoved",
          principal: null,
          agent: e.agent,
          payee: e.payee,
        };
      }
      case LeashEventKind.PaymentExecuted: {
        const e = getPaymentExecutedEventDecoder().decode(payload);
        const nonce = orNull(e.requestNonce);
        return {
          ...at(e.timestamp),
          type: "PaymentExecuted",
          principal: e.principal,
          agent: e.agent,
          payee: e.payee,
          destination: e.destination,
          mint: e.mint,
          amount: e.amount.toString(),
          reference: referenceToHex(bytes(e.reference)),
          memo: decodeMemo(bytes(e.memo)),
          delegation: e.delegation,
          requestNonce: nonce === null ? null : nonce.toString(),
          paymentsCount: Number(e.paymentsCount),
        };
      }
      case LeashEventKind.PaymentDenied: {
        const e = getPaymentDeniedEventDecoder().decode(payload);
        const denial = denialInfo(DENIAL_REASON_FROM_CHAIN[e.reason]);
        return {
          ...at(e.timestamp),
          type: "PaymentDenied",
          principal: e.principal,
          agent: e.agent,
          payee: e.payee,
          destination: e.destination,
          amount: e.amount.toString(),
          reason: denial.name,
          reasonCode: denial.code,
          strike: denial.strike,
          strikes: e.strikes,
          tripped: e.tripped,
          reference: referenceToHex(bytes(e.reference)),
          memo: decodeMemo(bytes(e.memo)),
        };
      }
      case LeashEventKind.PaymentRequested: {
        const e = getPaymentRequestedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "PaymentRequested",
          principal: null,
          agent: e.agent,
          request: e.request,
          nonce: e.nonce.toString(),
          payee: e.payee,
          amount: e.amount.toString(),
          reference: referenceToHex(bytes(e.reference)),
          memo: decodeMemo(bytes(e.memo)),
          expiresAt: seconds(e.expiresAt),
        };
      }
      case LeashEventKind.RequestApproved: {
        const e = getRequestApprovedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "RequestApproved",
          principal: null,
          agent: e.agent,
          request: e.request,
          nonce: e.nonce.toString(),
        };
      }
      case LeashEventKind.RequestRejected: {
        const e = getRequestRejectedEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "RequestRejected",
          principal: null,
          agent: e.agent,
          request: e.request,
          nonce: e.nonce.toString(),
          by: e.by,
        };
      }
      case LeashEventKind.RequestExpired: {
        const e = getRequestExpiredEventDecoder().decode(payload);
        return {
          ...at(e.timestamp),
          type: "RequestExpired",
          principal: null,
          agent: e.agent,
          request: e.request,
          nonce: e.nonce.toString(),
        };
      }
    }
  })();
  if (json.principal === null && typeof json.agent === "string" && options.principalOf) {
    json.principal = options.principalOf(json.agent);
  }
  return LeashEventSchema.parse(json);
}

/**
 * Every Leash event of a transaction, in execution order, as the contract JSON. An event's id is
 * `${signature}:${n}`, where `n` counts the transaction's Leash events from 0. A failed
 * transaction has no events.
 */
export function decodeLeashEvents(
  tx: TransactionRecord,
  options: DecodeOptions = {},
): LeashEvent[] {
  if (tx.err !== null && tx.err !== undefined) return [];
  const slot = Number(tx.slot);
  const events: LeashEvent[] = [];
  for (const instruction of tx.innerInstructions) {
    if (instruction.programAddress !== LEASH_PROGRAM_ADDRESS || !isEventData(instruction.data)) {
      continue;
    }
    const base = {
      id: `${tx.signature}:${events.length}`,
      signature: tx.signature,
      slot,
      blockTime: 0,
    };
    const event = decodeLeashEventData(instruction.data, base, options);
    events.push({
      ...event,
      blockTime: tx.blockTime === null ? event.timestamp : Number(tx.blockTime),
    });
  }
  return events;
}

/** The parts of a `getTransaction` response (encoding "json") that event decoding reads. */
export type RpcTransactionJson = {
  slot: bigint | number;
  blockTime: bigint | number | null;
  meta: {
    err: unknown;
    innerInstructions?:
      | readonly {
          index: number;
          instructions: readonly { programIdIndex: number; data: string }[];
        }[]
      | null;
    loadedAddresses?: { writable: readonly Address[]; readonly: readonly Address[] } | null;
  } | null;
  transaction: { message: { accountKeys: readonly Address[] }; signatures: readonly string[] };
};

/**
 * Adapts a `getTransaction(signature, { encoding: "json", maxSupportedTransactionVersion: 0 })`
 * response. Account indexes resolve against the static keys, then the loaded writable and
 * readonly addresses, as the runtime orders them.
 */
export function transactionRecordFromRpc(response: RpcTransactionJson): TransactionRecord {
  const signature = response.transaction.signatures[0];
  if (signature === undefined) throw new Error("transaction without a signature");
  const keys = [
    ...response.transaction.message.accountKeys,
    ...(response.meta?.loadedAddresses?.writable ?? []),
    ...(response.meta?.loadedAddresses?.readonly ?? []),
  ];
  const base58 = getBase58Encoder();
  const inner = [...(response.meta?.innerInstructions ?? [])].sort((a, b) => a.index - b.index);
  const innerInstructions = inner.flatMap((group) =>
    group.instructions.map((instruction) => {
      const programAddress = keys[instruction.programIdIndex];
      if (programAddress === undefined) throw new Error("inner instruction program out of range");
      return { programAddress, data: base58.encode(instruction.data) };
    }),
  );
  return {
    signature,
    slot: response.slot,
    blockTime: response.blockTime,
    err: response.meta?.err ?? null,
    innerInstructions,
  };
}
