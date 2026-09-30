import {
  LeashFetchInputSchema,
  LeashPayInputSchema,
  LeashRequestApprovalInputSchema,
  LeashStatusInputSchema,
  TOOL_NAMES,
  type ToolName,
} from "@leash/contracts";
import { z } from "zod";

/**
 * A tool definition in the shape Claude's Messages API takes (`name`, `description`,
 * `input_schema`); MCP servers pass the same schema as `inputSchema`. Not `strict`: the
 * free-form `headers` map of `leash_fetch` is outside what strict tool schemas allow. The tools
 * validate every input with the contract's zod schemas instead.
 */
export type ToolDefinition = {
  name: ToolName;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  } & Record<string, unknown>;
};

const POLICY =
  "Payments follow the owner's spending policy: allowed recipients, per-payment and per-period limits, and a rate limit. " +
  "A payment above the instant limit goes to the owner for approval instead. " +
  "Blocked attempts are recorded, and repeated ones freeze the agent.";

const DESCRIPTIONS: Record<ToolName, string> = {
  leash_fetch:
    "Fetch a URL over HTTP. If the service charges for the request (HTTP 402, x402), the tool pays from the " +
    "owner's Leash budget and returns the content with a payment receipt; free pages cost nothing. " +
    `${POLICY} \`purpose\` is stored on-chain with any payment: say briefly and truthfully why you need it.`,
  leash_pay:
    "Send USDC from the owner's budget directly to a wallet, when the user's task requires paying someone. " +
    `${POLICY} \`purpose\` is stored on-chain with the payment.`,
  leash_request_approval:
    "Ask the owner to approve one payment above your instant limit. The owner is notified; once they approve, " +
    "paying the same recipient the same amount (with leash_pay, or leash_fetch on the same URL) goes through. " +
    "Returns the pending request.",
  leash_status:
    "Show your spending status: whether payments are active or frozen, the allowance left in this period, your " +
    "limits, the recipients you may pay and what is left for each, and your strikes. Costs nothing.",
};

const SCHEMAS = {
  leash_fetch: LeashFetchInputSchema,
  leash_pay: LeashPayInputSchema,
  leash_request_approval: LeashRequestApprovalInputSchema,
  leash_status: LeashStatusInputSchema,
} satisfies Record<ToolName, z.ZodType>;

function inputSchema(schema: z.ZodType): ToolDefinition["input_schema"] {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  return { ...json, type: "object" };
}

/** The four Leash tools, in contract order (02-contracts §8). */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.values(TOOL_NAMES).map(
  (name) => ({
    name,
    description: DESCRIPTIONS[name],
    input_schema: inputSchema(SCHEMAS[name]),
  }),
);
