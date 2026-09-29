import { z } from "zod";
import { AddressSchema } from "./config.ts";
import { EventIdSchema } from "./events.ts";
import { UnixSecondsSchema } from "./units.ts";

// Sentinel alerts (02-contracts §12).

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertKindSchema = z.enum([
  "tripwire_fired",
  "burst_denials",
  "approval_requested",
  "spend_spike",
  "new_payee_spend",
  "allowance_low",
  "guardian_freeze",
]);
export type AlertKind = z.infer<typeof AlertKindSchema>;

export const AlertSchema = z.object({
  id: z.string().min(1),
  severity: AlertSeveritySchema,
  kind: AlertKindSchema,
  owner: AddressSchema,
  agent: AddressSchema.nullable(),
  title: z.string().min(1).max(80),
  /** Plain text. Agent- or owner-controlled strings must be escaped by each notifier. */
  body: z.string().max(500),
  actions: z.array(z.object({ label: z.string().min(1), url: z.url() })),
  eventIds: z.array(EventIdSchema),
  createdAt: UnixSecondsSchema,
});
export type Alert = z.infer<typeof AlertSchema>;
