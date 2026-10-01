import {
  type ActionGetResponse,
  ActionPostRequestSchema,
  type ActionPostResponse,
  ActionQuerySchemas,
} from "@leash/contracts";
import { type LeashChain, LeashNetworkError } from "@leash/sdk";
import type { Instruction } from "@solana/kit";
import type { z } from "zod";
import {
  ActionHttpError,
  actionError,
  actionJson,
  actionOptions,
  actionRedirect,
  wantsHtml,
} from "./http.ts";
import { iconUrl } from "./icon.ts";
import { unsignedTransaction } from "./transaction.ts";

// One Action = a definition (describe it, build its transaction) turned into GET, POST and
// OPTIONS handlers. The handlers own parsing, headers, errors and the browser redirect.

export type ActionName = keyof typeof ActionQuerySchemas;
export type ActionQuery<A extends ActionName> = z.infer<(typeof ActionQuerySchemas)[A]>;

export interface ActionDeps {
  /** Chain access through @leash/sdk: `rpcChain` in production, the LiteSVM testbed in tests. */
  chain: LeashChain;
  /** `NEXT_PUBLIC_APP_URL`; when unset, the request's origin. */
  appUrl?: string | undefined;
}

export interface ActionContext {
  chain: LeashChain;
  /** The web app's base URL (absolute links: the icon). */
  baseUrl: string;
}

export interface ActionDefinition<A extends ActionName> {
  name: A;
  /** The web app page a browser is sent to. */
  page(query: ActionQuery<A>): string;
  /** The GET answer, described from the chain (`icon` is added by the handler). */
  describe(
    query: ActionQuery<A>,
    context: ActionContext,
  ): Promise<Omit<ActionGetResponse, "icon" | "type">>;
  /** Checks who may sign, then the instructions and the wallet's message. */
  build(
    query: ActionQuery<A>,
    account: string,
    context: ActionContext,
  ): Promise<{ instructions: Instruction[]; message: string }>;
}

function parseQuery<A extends ActionName>(name: A, request: Request): ActionQuery<A> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = ActionQuerySchemas[name].safeParse(params);
  if (!parsed.success) {
    const field = Object.keys(ActionQuerySchemas[name].shape)[0] ?? "query";
    throw new ActionHttpError(400, `Missing or invalid ?${field}=: expected a Solana address.`);
  }
  return parsed.data as ActionQuery<A>;
}

async function parseAccount(request: Request): Promise<string> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = ActionPostRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ActionHttpError(400, 'Expected a JSON body { "account": "<wallet address>" }.');
  }
  return parsed.data.account;
}

async function answer(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ActionHttpError) return actionError(error.status, error.message);
    if (error instanceof LeashNetworkError) {
      return actionError(502, "The Solana RPC is not reachable right now. Try again shortly.");
    }
    console.error("action failed", error);
    return actionError(500, "Something went wrong building this action.");
  }
}

/** GET, POST and OPTIONS for one Action; `deps` is resolved per request. */
export function actionHandlers<A extends ActionName>(
  definition: ActionDefinition<A>,
  deps: () => ActionDeps,
) {
  const context = (request: Request): ActionContext => {
    const { chain, appUrl } = deps();
    return { chain, baseUrl: (appUrl ?? new URL(request.url).origin).replace(/\/+$/, "") };
  };
  return {
    GET: (request: Request) =>
      answer(async () => {
        const query = parseQuery(definition.name, request);
        const ctx = context(request);
        if (wantsHtml(request)) return actionRedirect(`${ctx.baseUrl}${definition.page(query)}`);
        const described = await definition.describe(query, ctx);
        const body: ActionGetResponse = {
          type: "action",
          icon: iconUrl(ctx.baseUrl),
          ...described,
        };
        return actionJson(body);
      }),
    POST: (request: Request) =>
      answer(async () => {
        const query = parseQuery(definition.name, request);
        const account = await parseAccount(request);
        const ctx = context(request);
        const { instructions, message } = await definition.build(query, account, ctx);
        const body: ActionPostResponse = {
          type: "transaction",
          transaction: await unsignedTransaction(ctx.chain, account, instructions),
          message,
        };
        return actionJson(body);
      }),
    OPTIONS: async () => actionOptions(),
  };
}
