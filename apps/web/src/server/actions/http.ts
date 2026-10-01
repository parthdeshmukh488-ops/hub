import { ACTIONS_BLOCKCHAIN_ID, ACTIONS_CORS_HEADERS } from "@leash/contracts";

// Responses of the Solana Action routes (02-contracts §10). Every one carries the same headers,
// errors and OPTIONS included, so a Blink client can read any answer.

/**
 * The Actions spec version we implement. `@solana/actions-spec` is at 2.4.2 on npm; the header
 * takes major.minor. We do not depend on that package (02 §10: it pulls in web3.js v1).
 */
export const ACTION_VERSION = "2.4";

export const ACTION_HEADERS: Record<string, string> = {
  ...ACTIONS_CORS_HEADERS,
  "X-Action-Version": ACTION_VERSION,
  "X-Blockchain-Ids": ACTIONS_BLOCKCHAIN_ID,
};

/** An expected failure, answered as `{ message }` (ActionErrorSchema) with its status. */
export class ActionHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 502,
    message: string,
  ) {
    super(message);
    this.name = "ActionHttpError";
  }
}

export function actionJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: ACTION_HEADERS });
}

export function actionError(status: number, message: string): Response {
  return actionJson({ message }, status);
}

export function actionOptions(): Response {
  return new Response(null, { status: 204, headers: ACTION_HEADERS });
}

export function actionRedirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...ACTION_HEADERS, Location: location } });
}

/** A browser asks for HTML; a Blink client asks for JSON (or anything else). */
export function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}
