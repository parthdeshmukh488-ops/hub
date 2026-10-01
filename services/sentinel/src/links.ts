import { ACTION_ROUTES, ActionQuerySchemas } from "@leash/contracts";
import type { z } from "zod";

// Links in alerts: web app pages, and the Solana Action (Blink) routes of 02-contracts §10.

export type ActionName = keyof typeof ACTION_ROUTES;

function join(webUrl: string, path: string): string {
  return `${webUrl.replace(/\/+$/, "")}${path}`;
}

/** The web app's page for one agent. */
export function agentPageUrl(webUrl: string, agent: string): string {
  return join(webUrl, `/app/agents/${encodeURIComponent(agent)}`);
}

/** The web app's activity log (every agent of the owner). */
export function activityPageUrl(webUrl: string): string {
  return join(webUrl, "/app/activity");
}

/** The web app's approvals inbox. */
export function approvalsPageUrl(webUrl: string): string {
  return join(webUrl, "/app/approvals");
}

/**
 * The URL of a Solana Action served by the web app, e.g.
 * `actionUrl(web, "approve", { request })` → `<web>/api/actions/approve?request=<request>`.
 * Throws if a parameter is not what the route accepts.
 */
export function actionUrl<A extends ActionName>(
  webUrl: string,
  action: A,
  params: z.input<(typeof ActionQuerySchemas)[A]>,
): string {
  const query = ActionQuerySchemas[action].parse(params) as Record<string, string>;
  return `${join(webUrl, ACTION_ROUTES[action])}?${new URLSearchParams(query).toString()}`;
}
