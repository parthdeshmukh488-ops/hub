import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AGENT_STATUS_CODES,
  AgentStatsViewSchema,
  AgentViewSchema,
  DENIAL_REASONS,
  FREEZE_REASON_CODES,
  LEASH_ERRORS,
  LEASH_EVENT_TYPES,
  LeashEventSchema,
  PAYEE_MODE_CODES,
  PayeeLimitsSchema,
  PayeeViewSchema,
  PolicyViewSchema,
  PROGRAM_CONSTANTS,
  PROGRAM_IDS,
  PrincipalViewSchema,
  REQUEST_STATUS_CODES,
  RequestViewSchema,
  SEEDS,
} from "../src/index.ts";

// The committed IDL (WS1, `cargo run -p leash --example idl -- --write`) against this package:
// everything the SDK's generated client and event decoder rely on. Field names are compared
// after camelCasing, as Codama does.

const Field = z.object({ name: z.string(), type: z.unknown() });
const TypeDef = z.object({
  name: z.string(),
  type: z.union([
    z.object({ kind: z.literal("struct"), fields: z.array(Field) }),
    z.object({ kind: z.literal("enum"), variants: z.array(z.object({ name: z.string() })) }),
  ]),
});
const IdlSchema = z.object({
  address: z.string(),
  metadata: z.object({ name: z.literal("leash"), spec: z.string() }),
  instructions: z.array(
    z.object({
      name: z.string(),
      accounts: z.array(
        z.object({
          name: z.string(),
          writable: z.boolean().optional(),
          signer: z.boolean().optional(),
          optional: z.boolean().optional(),
        }),
      ),
    }),
  ),
  accounts: z.array(z.object({ name: z.string() })),
  events: z.array(z.object({ name: z.string() })),
  errors: z.array(z.object({ code: z.number(), name: z.string() })),
  types: z.array(TypeDef),
  constants: z.array(z.object({ name: z.string(), type: z.string(), value: z.string() })),
});

const idl = IdlSchema.parse(
  JSON.parse(readFileSync(new URL("../idl/leash.json", import.meta.url), "utf8")),
);

const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function typeDef(name: string) {
  const def = idl.types.find((t) => t.name === name);
  if (!def) throw new Error(`IDL has no type ${name}`);
  return def.type;
}

function fieldNames(name: string): string[] {
  const def = typeDef(name);
  if (def.kind !== "struct") throw new Error(`${name} is not a struct`);
  return def.fields.map((f) => camel(f.name));
}

function variants(name: string): string[] {
  const def = typeDef(name);
  if (def.kind !== "enum") throw new Error(`${name} is not an enum`);
  return def.variants.map((v) => v.name);
}

const without = (names: string[], drop: string[]) => names.filter((n) => !drop.includes(n));
const keys = (schema: { shape: object }) => Object.keys(schema.shape);
const sorted = (names: Iterable<string>) => [...names].sort();

describe("IDL errors", () => {
  it("equal LEASH_ERRORS, in order, from 6000", () => {
    expect(idl.errors.map((e) => e.name)).toEqual([...LEASH_ERRORS]);
    expect(idl.errors.map((e) => e.code)).toEqual(LEASH_ERRORS.map((_, i) => 6000 + i));
  });

  it("start with the denials in DenialReason order", () => {
    for (const denial of DENIAL_REASONS) {
      expect(idl.errors[denial.code - 1]?.name).toBe(denial.anchorError);
    }
  });
});

describe("IDL identity and constants", () => {
  it("is the program at PROGRAM_IDS.leash", () => {
    expect(idl.address).toBe(PROGRAM_IDS.leash);
  });

  it("publishes the program constants and seeds this package mirrors", () => {
    const constant = (name: string) => idl.constants.find((c) => c.name === name)?.value;
    const bytes = (text: string) => `[${[...Buffer.from(text, "utf8")].join(", ")}]`;
    expect(constant("MAX_OPEN_REQUESTS")).toBe(String(PROGRAM_CONSTANTS.maxOpenRequests));
    expect(constant("MAX_REQUEST_TTL_SECS")).toBe(String(PROGRAM_CONSTANTS.maxRequestTtlSecs));
    expect(constant("ACCOUNT_VERSION")).toBe(String(PROGRAM_CONSTANTS.accountVersion));
    expect(constant("PRINCIPAL_SEED")).toBe(bytes(SEEDS.principal));
    expect(constant("AGENT_SEED")).toBe(bytes(SEEDS.agent));
    expect(constant("PAYEE_SEED")).toBe(bytes(SEEDS.payee));
    expect(constant("REQUEST_SEED")).toBe(bytes(SEEDS.request));
  });

  it("stores labels, memos and references at their fixed lengths", () => {
    const array = (type: string, field: string) => {
      const def = typeDef(type);
      if (def.kind !== "struct") throw new Error(type);
      return def.fields.find((f) => f.name === field)?.type;
    };
    expect(array("Agent", "label")).toEqual({ array: ["u8", PROGRAM_CONSTANTS.labelLen] });
    expect(array("PaymentRequest", "memo")).toEqual({ array: ["u8", PROGRAM_CONSTANTS.memoLen] });
    expect(array("PayArgs", "reference")).toEqual({
      array: ["u8", PROGRAM_CONSTANTS.referenceLen],
    });
  });
});

describe("IDL instructions", () => {
  it("are the 18 of 01-onchain-program §6", () => {
    expect(sorted(idl.instructions.map((i) => i.name))).toEqual(
      sorted([
        "initialize_principal",
        "set_guardian",
        "freeze_principal",
        "unfreeze_principal",
        "create_agent",
        "update_policy",
        "freeze_agent",
        "unfreeze_agent",
        "close_agent",
        "add_payee",
        "update_payee",
        "remove_payee",
        "approve_request",
        "reject_request",
        "pay",
        "report_denied_attempt",
        "request_payment",
        "expire_request",
      ]),
    );
  });

  it("give pay the fixed account order of §6.2, with no fee payer", () => {
    const pay = idl.instructions.find((i) => i.name === "pay");
    expect(pay?.accounts.map((a) => a.name)).toEqual([
      "agent_key",
      "principal",
      "agent",
      "payee_entry",
      "request",
      "request_rent_receiver",
      "delegation",
      "subscription_authority",
      "source_token_account",
      "destination_token_account",
      "mint",
      "token_program",
      "subscriptions_program",
      "subscriptions_event_authority",
      "event_authority",
      "program",
    ]);
    const flags = Object.fromEntries(
      (pay?.accounts ?? []).map((a) => [
        a.name,
        `${a.signer ? "s" : ""}${a.writable ? "w" : ""}${a.optional ? "?" : ""}`,
      ]),
    );
    expect(flags).toMatchObject({
      agent_key: "s",
      principal: "",
      agent: "w",
      payee_entry: "w?",
      request: "w?",
      request_rent_receiver: "w?",
      delegation: "w",
      source_token_account: "w",
      destination_token_account: "w",
    });
    expect(pay?.accounts.filter((a) => a.signer).map((a) => a.name)).toEqual(["agent_key"]);
  });
});

describe("IDL enums", () => {
  it("store every enum as its variant index, matching the codes", () => {
    const check = (type: string, codes: Record<string, number>) => {
      const names = variants(type);
      for (const [json, code] of Object.entries(codes)) expect(names[code]).toBe(pascal(json));
      expect(names).toHaveLength(Object.keys(codes).length);
    };
    check("AgentStatus", AGENT_STATUS_CODES);
    check("FreezeReason", FREEZE_REASON_CODES);
    check("PayeeMode", PAYEE_MODE_CODES);
    check("RequestStatus", REQUEST_STATUS_CODES);
  });

  it("store DenialReason code n at index n - 1", () => {
    expect(variants("DenialReason")).toEqual(DENIAL_REASONS.map((d) => pascal(d.name)));
  });
});

describe("IDL accounts and structs match the views", () => {
  const onChain = (name: string) => without(fieldNames(name), ["version", "bump", "reserved"]);

  it("has the four accounts", () => {
    expect(sorted(idl.accounts.map((a) => a.name))).toEqual([
      "Agent",
      "Payee",
      "PaymentRequest",
      "Principal",
    ]);
  });

  it("Policy and PayeeLimits field by field, in order", () => {
    expect(fieldNames("Policy")).toEqual(keys(PolicyViewSchema));
    expect(fieldNames("PayeeLimits")).toEqual(keys(PayeeLimitsSchema));
  });

  it("every account field is in its view (views add the address and derived data)", () => {
    expect(sorted(onChain("Principal"))).toEqual(
      sorted(without(keys(PrincipalViewSchema), ["address"])),
    );
    expect(sorted(onChain("Agent"))).toEqual(
      sorted(without(keys(AgentViewSchema), ["address", "allowance"])),
    );
    expect(sorted(fieldNames("AgentStats"))).toEqual(sorted(keys(AgentStatsViewSchema)));
    expect(sorted(onChain("Payee"))).toEqual(sorted(without(keys(PayeeViewSchema), ["address"])));
    expect(sorted(onChain("PaymentRequest"))).toEqual(
      sorted(without(keys(RequestViewSchema), ["address"])),
    );
  });
});

describe("IDL events decode into the JSON events of 02-contracts §6", () => {
  // Filled in by the decoder: transaction metadata, and what it derives from `reason`.
  const DECODER_KEYS = ["id", "type", "signature", "slot", "blockTime", "principal", "agent"];
  const DERIVED = { PaymentDenied: ["reasonCode", "strike"] } as Record<string, string[]>;

  it("has one IDL event per JSON event type", () => {
    expect(sorted(idl.events.map((e) => e.name))).toEqual(sorted(LEASH_EVENT_TYPES));
  });

  it.each([...LEASH_EVENT_TYPES])("%s carries exactly the JSON fields", (type) => {
    const schema = LeashEventSchema.options.find((o) => o.shape.type.value === type);
    if (!schema) throw new Error(type);
    // The IDL nests payee limits; the JSON event flattens them.
    const fromIdl = fieldNames(type).flatMap((f) =>
      f === "limits" ? keys(PayeeLimitsSchema) : [f],
    );
    const json = Object.keys(schema.shape);
    for (const field of fromIdl) expect(json).toContain(field);
    const onlyInJson = json.filter((k) => !fromIdl.includes(k));
    expect(sorted(without(onlyInJson, [...DECODER_KEYS, ...(DERIVED[type] ?? [])]))).toEqual([]);
    expect(fromIdl).toContain("timestamp");
  });
});
