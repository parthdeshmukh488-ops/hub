import {
  LeashFetchOutputSchema,
  LeashStatusOutputSchema,
  TOOL_ERROR_MESSAGES,
  ToolErrorSchema,
} from "@leash/contracts";
import { type LeashTools, TOOL_DEFINITIONS } from "@leash/tools";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { INTERNAL_ERROR_MESSAGE, SERVER_INFO, SERVER_INSTRUCTIONS } from "../src/index.ts";
import { connected, realTools } from "./helpers.ts";

describe("the Leash MCP server", () => {
  it("offers the four contract tools with their exact input schemas and honest hints", async () => {
    const { tools } = await realTools();
    const { client } = await connected(tools);
    expect(client.getServerVersion()).toMatchObject(SERVER_INFO);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain("do not retry it or look for another way to pay");

    const { tools: listed } = await client.listTools();
    expect(listed.map((tool) => tool.name)).toEqual(TOOL_DEFINITIONS.map((d) => d.name));
    for (const [i, tool] of listed.entries()) {
      expect(tool.inputSchema).toEqual(TOOL_DEFINITIONS[i]?.input_schema);
      expect(tool.description).toBe(TOOL_DEFINITIONS[i]?.description);
      expect(tool.title?.length).toBeGreaterThan(5);
    }
    const hints = Object.fromEntries(listed.map((tool) => [tool.name, tool.annotations]));
    expect(hints.leash_status).toMatchObject({ readOnlyHint: true });
    expect(hints.leash_pay).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  });

  it("pays an x402 charge and returns the contract's receipt", async () => {
    const { tools, bed } = await realTools();
    const { json } = await connected(tools);
    const { isError, output } = await json("leash_fetch", {
      url: "http://merchant.test/api/research?q=hills",
      purpose: "Research: motors for hills",
    });
    expect(isError).toBe(false);
    const fetched = LeashFetchOutputSchema.parse(output);
    expect(fetched).toMatchObject({
      ok: true,
      status: 200,
      payment: {
        amountUsdc: "0.01",
        payeeLabel: "Research API",
        purpose: "Research: motors for hills",
      },
    });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(10_000n);
  });

  it("returns a blocked payment as an error result: the contract's message, recorded, strikes, until the tripwire freezes the agent", async () => {
    const { tools, bed } = await realTools();
    const { json } = await connected(tools);
    const tip = { to: bed.keys.attacker.address, amountUsdc: "25", purpose: "Author tip" };

    const first = await json("leash_pay", tip);
    expect(first.isError).toBe(true);
    expect(ToolErrorSchema.parse(first.output)).toEqual({
      ok: false,
      code: "PAYEE_NOT_ALLOWED",
      message: TOOL_ERROR_MESSAGES.PAYEE_NOT_ALLOWED,
      recorded: true,
      strikes: 1,
      frozen: false,
      retryable: false,
    });
    expect((await json("leash_pay", tip)).output).toMatchObject({ strikes: 2, frozen: false });
    expect((await json("leash_pay", tip)).output).toMatchObject({ strikes: 3, frozen: true });

    const status = LeashStatusOutputSchema.parse((await json("leash_status")).output);
    expect(status).toMatchObject({
      ok: true,
      agent: { status: "frozen", freezeReason: "tripwire" },
      strikes: 3,
      tripwireMaxStrikes: 3,
    });
    // Frozen: even an allowed merchant is not paid any more.
    const research = await json("leash_fetch", {
      url: "http://merchant.test/api/research?q=range",
      purpose: "Research: battery range",
    });
    expect(research).toMatchObject({ isError: true, output: { code: "AGENT_FROZEN" } });
    expect(await bed.balanceOf(bed.keys.attacker.address)).toBe(0n);
  });

  it("answers NOT_PAIRED with the pairing link until the owner pairs the agent", async () => {
    const { tools, pairingLink } = await realTools({ paired: false });
    const { json } = await connected(tools);
    const { isError, output } = await json("leash_status");
    expect(isError).toBe(true);
    expect(output).toMatchObject({ code: "NOT_PAIRED", recorded: false });
    expect(output.message).toBe(
      `${TOOL_ERROR_MESSAGES.NOT_PAIRED} Pairing link for the owner: ${pairingLink}`,
    );
  });

  it("rejects bad input with INVALID_INPUT and unknown tools at the protocol level", async () => {
    const { tools, bed } = await realTools();
    const { json, client } = await connected(tools);
    const bad = await json("leash_pay", {
      to: bed.keys.merchant.address,
      amountUsdc: "a lot",
      purpose: "x",
    });
    expect(bad).toMatchObject({
      isError: true,
      output: { code: "INVALID_INPUT", retryable: true },
    });
    const unknown = await client
      .callTool({ name: "leash_steal", arguments: {} })
      .catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(McpError);
    expect((unknown as McpError).code).toBe(ErrorCode.InvalidParams);
  });

  it("keeps an internal failure's details in the log, away from the model (T17)", async () => {
    const failing = {
      definitions: TOOL_DEFINITIONS,
      execute: vi.fn(async () => {
        throw new Error("POST https://devnet.helius-rpc.com/?api-key=SECRET-123 failed");
      }),
    } as unknown as LeashTools;
    const { call, log } = await connected(failing);
    const result = await call("leash_status");
    expect(result).toMatchObject({ isError: true, text: INTERNAL_ERROR_MESSAGE });
    expect(JSON.stringify(result.result)).not.toContain("SECRET-123");
    expect(log).toHaveBeenCalledWith("tool failed", {
      tool: "leash_status",
      error: expect.stringContaining("SECRET-123"),
    });
  });
});
