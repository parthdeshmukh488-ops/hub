import type { LeashEvent, PayeeView, PrincipalView, RequestView } from "@leash/contracts";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AgentRecord, DelegationRecord } from "../projection/records.ts";

// The indexer's database (WS4 brief). `events` is the history; the other tables are projections
// (views as JSON, plus the columns queries filter on), rewritten in the same batch as the event.

/** Every Leash event, once. `seq` is the ingestion order that breaks ties within a slot. */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    type: text("type").notNull(),
    signature: text("signature").notNull(),
    slot: integer("slot").notNull(),
    blockTime: integer("block_time").notNull(),
    timestamp: integer("timestamp").notNull(),
    owner: text("owner"),
    principal: text("principal"),
    agent: text("agent"),
    payload: text("payload", { mode: "json" }).$type<LeashEvent>().notNull(),
  },
  (t) => [
    index("events_owner_order").on(t.owner, t.slot, t.seq),
    index("events_agent_order").on(t.agent, t.slot, t.seq),
    index("events_owner_time").on(t.owner, t.timestamp),
  ],
);

export const principals = sqliteTable(
  "principals",
  {
    address: text("address").primaryKey(),
    owner: text("owner").notNull().unique(),
    guardian: text("guardian"),
    view: text("view", { mode: "json" }).$type<PrincipalView>().notNull(),
  },
  (t) => [index("principals_guardian").on(t.guardian)],
);

export const agents = sqliteTable(
  "agents",
  {
    address: text("address").primaryKey(),
    owner: text("owner").notNull(),
    view: text("view", { mode: "json" }).$type<AgentRecord>().notNull(),
  },
  (t) => [index("agents_owner").on(t.owner)],
);

export const payees = sqliteTable(
  "payees",
  {
    address: text("address").primaryKey(),
    agent: text("agent").notNull(),
    payee: text("payee").notNull(),
    view: text("view", { mode: "json" }).$type<PayeeView>().notNull(),
  },
  (t) => [uniqueIndex("payees_agent_payee").on(t.agent, t.payee)],
);

export const requests = sqliteTable(
  "requests",
  {
    address: text("address").primaryKey(),
    agent: text("agent").notNull(),
    owner: text("owner").notNull(),
    nonce: text("nonce").notNull(),
    status: text("status").notNull(),
    view: text("view", { mode: "json" }).$type<RequestView>().notNull(),
  },
  (t) => [
    index("requests_owner").on(t.owner),
    uniqueIndex("requests_agent_nonce").on(t.agent, t.nonce),
  ],
);

/** Delegation state; the `AllowanceView` is computed from it at read time. */
export const allowances = sqliteTable(
  "allowances",
  {
    delegation: text("delegation").primaryKey(),
    agent: text("agent").notNull(),
    state: text("state", { mode: "json" }).$type<DelegationRecord>().notNull(),
  },
  (t) => [index("allowances_agent").on(t.agent)],
);

/** Allowlist entry addresses reported by the source before their `PayeeAdded`. */
export const payeeEntries = sqliteTable(
  "payee_entries",
  {
    address: text("address").primaryKey(),
    agent: text("agent").notNull(),
    payee: text("payee").notNull(),
  },
  (t) => [uniqueIndex("payee_entries_agent_payee").on(t.agent, t.payee)],
);

/** Where each source stopped. Also records which source owns this database. */
export const cursors = sqliteTable("cursors", {
  source: text("source").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: integer("last_slot"),
});
