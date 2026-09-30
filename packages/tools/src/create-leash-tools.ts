import {
  type ClusterConfig,
  explorerTxUrl,
  FETCH_BODY_MAX_CHARS,
  formatUsdc,
  LeashFetchInputSchema,
  type LeashFetchOutput,
  LeashPayInputSchema,
  type LeashPayOutput,
  LeashRequestApprovalInputSchema,
  type LeashRequestApprovalOutput,
  LeashStatusInputSchema,
  type LeashStatusOutput,
  type PaymentReceipt,
  PROGRAM_CONSTANTS,
  parseUsdc,
  type ToolError,
  type ToolName,
  truncateUtf8,
} from "@leash/contracts";
import { PaymentDeniedError } from "@leash/sdk";
import type { z } from "zod";
import { TOOL_DEFINITIONS, type ToolDefinition } from "./definitions.ts";
import type { LeashAgentPort, LeashFetchPort, PaymentResult } from "./ports.ts";
import { statusOutput } from "./status.ts";
import { fromError, toolError } from "./tool-errors.ts";

export type LeashToolsOptions = {
  agent: LeashAgentPort;
  leashFetch: LeashFetchPort;
  /** For explorer links in receipts. */
  cluster: ClusterConfig;
};

export type ToolOutput =
  | LeashFetchOutput
  | LeashPayOutput
  | LeashRequestApprovalOutput
  | LeashStatusOutput;

export type LeashTools = {
  definitions: readonly ToolDefinition[];
  /** Runs a tool by name with the model's raw input. Throws only for an unknown name or a bug. */
  execute(name: string, input: unknown): Promise<ToolOutput>;
  fetch(input: unknown): Promise<LeashFetchOutput>;
  pay(input: unknown): Promise<LeashPayOutput>;
  requestApproval(input: unknown): Promise<LeashRequestApprovalOutput>;
  status(input?: unknown): Promise<LeashStatusOutput>;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: ToolError };

function parse<T>(schema: z.ZodType<T>, input: unknown): Parsed<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
  );
  return { ok: false, error: toolError("INVALID_INPUT", { detail: `(${issues.join("; ")})` }) };
}

/** A positive amount in base units, or the INVALID_INPUT error for it. */
function amountOf(text: string): Parsed<bigint> {
  const amount = parseUsdc(text);
  return amount > 0n
    ? { ok: true, value: amount }
    : {
        ok: false,
        error: toolError("INVALID_INPUT", { detail: "(amountUsdc: must be above zero)" }),
      };
}

/** The on-chain memo holds 64 bytes; longer purposes are cut at a character boundary. */
const memo = (purpose: string) => truncateUtf8(purpose, PROGRAM_CONSTANTS.memoLen);

/**
 * The four Leash tools (02-contracts §8). They translate; the SDK and the program decide. Denials
 * come back as `ToolError`s with the contract's messages, which tell the model to stop.
 */
export function createLeashTools({ agent, leashFetch, cluster }: LeashToolsOptions): LeashTools {
  const receipt = (payment: PaymentResult): PaymentReceipt => ({
    signature: payment.signature,
    explorerUrl: explorerTxUrl(cluster, payment.signature),
    amountUsdc: formatUsdc(payment.amount),
    payee: payment.payee,
    payeeLabel: payment.payeeLabel,
    purpose: payment.purpose,
    requestNonce: payment.requestNonce === null ? null : payment.requestNonce.toString(),
  });

  /**
   * Above the instant limit, ask the owner right away (02 §8 automatic behaviour, ADR
   * 20260930-ws7), so APPROVAL_REQUIRED's "a request was sent" is true.
   */
  async function denied(error: unknown, purpose: string): Promise<ToolError> {
    if (!(error instanceof PaymentDeniedError) || error.reason !== "approvalRequired")
      return fromError(error);
    try {
      const request = await agent.requestApproval({ ...error.attempted, purpose });
      return toolError("APPROVAL_REQUIRED", { detail: `Request: ${request.address}.` });
    } catch (requestError) {
      return fromError(requestError);
    }
  }

  const tools: LeashTools = {
    definitions: TOOL_DEFINITIONS,

    async fetch(input) {
      const parsed = parse(LeashFetchInputSchema, input);
      if (!parsed.ok) return parsed.error;
      const { url, method, headers, body, purpose } = parsed.value;
      try {
        const result = await leashFetch({
          url,
          method: method ?? "GET",
          headers: headers ?? {},
          body,
          purpose: memo(purpose),
        });
        const extra = result.body.length - FETCH_BODY_MAX_CHARS;
        return {
          ok: true,
          status: result.status,
          contentType: result.contentType,
          body:
            extra > 0
              ? `${result.body.slice(0, FETCH_BODY_MAX_CHARS)}\n\n[Truncated: ${extra} more characters]`
              : result.body,
          payment: result.payment === null ? null : receipt(result.payment),
        };
      } catch (error) {
        return denied(error, memo(purpose));
      }
    },

    async pay(input) {
      const parsed = parse(LeashPayInputSchema, input);
      if (!parsed.ok) return parsed.error;
      const amount = amountOf(parsed.value.amountUsdc);
      if (!amount.ok) return amount.error;
      const purpose = memo(parsed.value.purpose);
      try {
        const payment = await agent.pay({ to: parsed.value.to, amount: amount.value, purpose });
        return { ok: true, payment: receipt(payment) };
      } catch (error) {
        return denied(error, purpose);
      }
    },

    async requestApproval(input) {
      const parsed = parse(LeashRequestApprovalInputSchema, input);
      if (!parsed.ok) return parsed.error;
      const amount = amountOf(parsed.value.amountUsdc);
      if (!amount.ok) return amount.error;
      try {
        const request = await agent.requestApproval({
          to: parsed.value.to,
          amount: amount.value,
          purpose: memo(parsed.value.purpose),
        });
        return {
          ok: true,
          request: {
            address: request.address,
            nonce: request.nonce.toString(),
            expiresAt: request.expiresAt,
            status: "pending",
          },
        };
      } catch (error) {
        return fromError(error);
      }
    },

    async status(input = {}) {
      const parsed = parse(LeashStatusInputSchema, input);
      if (!parsed.ok) return parsed.error;
      try {
        return statusOutput(await agent.status());
      } catch (error) {
        return fromError(error);
      }
    },

    async execute(name, input) {
      const run: Record<ToolName, (input: unknown) => Promise<ToolOutput>> = {
        leash_fetch: tools.fetch,
        leash_pay: tools.pay,
        leash_request_approval: tools.requestApproval,
        leash_status: tools.status,
      };
      const tool = run[name as ToolName];
      if (!tool) throw new TypeError(`Unknown Leash tool: ${name}`);
      return tool(input);
    },
  };
  return tools;
}
