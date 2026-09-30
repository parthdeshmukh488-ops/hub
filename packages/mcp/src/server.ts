import { TOOL_NAMES, type ToolName } from "@leash/contracts";
import type { LeashTools } from "@leash/tools";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

export const SERVER_INFO = { name: "leash", version: "0.1.0" } as const;

/** Sent to the client at initialization; clients may show it to the model. */
export const SERVER_INSTRUCTIONS = [
  "Leash lets you pay for things from your owner's budget. An on-chain spending policy set by the owner decides every payment.",
  "Use leash_fetch to read a URL: it pays automatically when a service charges over x402, and free pages cost nothing.",
  "Use leash_pay only when the user's task requires paying a wallet, and leash_status to see what you may still spend.",
  "Give every payment a short, true purpose; it is stored on-chain.",
  "When a tool says a payment was blocked, do not retry it or look for another way to pay: continue without paying, or tell the owner.",
].join(" ");

/** What the model sees if the server itself fails. Says nothing about the failure (T17). */
export const INTERNAL_ERROR_MESSAGE =
  "The Leash MCP server hit an internal error (details are in its log). Stop and tell the owner; do not retry payments.";

/** Hints only (clients decide), and honest ones: payments are additive, never destructive. */
const TOOL_META: Record<ToolName, Pick<Tool, "title" | "annotations">> = {
  leash_fetch: {
    title: "Fetch a URL (pays x402 charges)",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  leash_pay: {
    title: "Pay a wallet",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  leash_request_approval: {
    title: "Ask the owner to approve a payment",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  leash_status: {
    title: "Spending status",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};

const NAMES: ReadonlySet<string> = new Set(Object.values(TOOL_NAMES));
const isToolName = (name: string): name is ToolName => NAMES.has(name);

export type McpLog = (message: string, details?: Record<string, unknown>) => void;

/**
 * The four Leash tools as an MCP server (02-contracts §8). Input schemas are the contract's, as
 * `@leash/tools` defines them. Each result is the tool's contract output as JSON text; a tool
 * error (`ok: false`: a denial, NOT_PAIRED, …) is an `isError` result, so clients show it as one.
 */
export function createLeashMcpServer({ tools, log }: { tools: LeashTools; log: McpLog }): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  });
  const listed: Tool[] = tools.definitions.map((definition) => ({
    name: definition.name,
    ...TOOL_META[definition.name],
    description: definition.description,
    // JSON Schema generated from the contract's zod schemas; every property is an object.
    inputSchema: definition.input_schema as Tool["inputSchema"],
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
    if (!isToolName(params.name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);
    }
    try {
      const output = await tools.execute(params.name, params.arguments ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        ...(output.ok ? {} : { isError: true }),
      };
    } catch (error) {
      log("tool failed", { tool: params.name, error: String(error) });
      return { content: [{ type: "text", text: INTERNAL_ERROR_MESSAGE }], isError: true };
    }
  });
  return server;
}
