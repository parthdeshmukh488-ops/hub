import type { AgentView, Alert, AlertKind, LeashEvent, PayeeView } from "@leash/contracts";
import type { SentinelConfig } from "../config.ts";

/** What the rules engine is fed, per owner: events, and the views that events don't carry. */
export type RuleInput =
  | { kind: "event"; event: LeashEvent }
  /** An agent's current view, from the stream's `agent` message or `GET /v1/owners/:owner`. */
  | { kind: "agent"; agent: AgentView }
  /** An agent's allowlist, from `GET /v1/agents/:agent` (labels and caps after a restart). */
  | { kind: "payees"; agent: string; payees: PayeeView[] };

/** A guardian freeze a rule asks for. Executed only when autofreeze is allowed (build step 4). */
export type SentinelAction =
  | { type: "freezeAgent"; owner: string; agent: string; alertId: string }
  | { type: "freezePrincipal"; owner: string; alertId: string };

export interface RuleContext {
  config: SentinelConfig;
  /** `SENTINEL_WEB_URL`, for links. */
  webUrl: string;
}

/** What one rule found, before the engine applies cooldowns and stamps it into an `Alert`. */
export interface Finding {
  kind: AlertKind;
  agent: string | null;
  /** Makes the alert id unique and stable: the triggering event id, or a period key. */
  trigger: string;
  title: string;
  body: string;
  actions: Alert["actions"];
  eventIds: string[];
  /** Whether the per-rule cooldown limits this kind of finding. */
  cooldown: boolean;
  /** The freeze to ask for, without the alert id the engine assigns. */
  freeze?: { type: "freezeAgent"; agent: string } | { type: "freezePrincipal" };
}

export interface RuleResult<S> {
  state: S;
  alerts: Alert[];
  actions: SentinelAction[];
}
