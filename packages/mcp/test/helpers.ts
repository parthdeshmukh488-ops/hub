import { buildPairingUrl, CAIP2, resolveClusterConfig } from "@leash/contracts";
import { createTestbed } from "@leash/sdk/testing";
import type { LeashTools } from "@leash/tools";
import { connectLeash } from "@leash/tools/node";
import { leashMerchant } from "@leash/x402/merchant";
import { litesvmFacilitatorClient } from "@leash/x402/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hono } from "hono";
import { vi } from "vitest";
import { createLeashMcpServer } from "../src/index.ts";

/** The real tools on the real program (LiteSVM), paying a merchant through the official facilitator. */
export async function realTools(options: { paired?: boolean } = {}) {
  const bed = await createTestbed();
  const merchant = new Hono();
  merchant.use(
    leashMerchant({
      payTo: bed.keys.merchant.address,
      facilitator: litesvmFacilitatorClient(bed.svm, [bed.keys.stranger], CAIP2.localnet),
      network: CAIP2.localnet,
      asset: bed.mint,
      routes: { "GET /api/research": { price: "0.01", description: "Research snippets" } },
    }),
  );
  merchant.get("/api/research", (c) => c.json({ results: ["Mid-drive motors climb better."] }));
  const signer = options.paired === false ? bed.keys.stranger : bed.keys.agentKey;
  const pairingLink = buildPairingUrl("http://localhost:3000", {
    agentKey: signer.address,
    label: "Claude via MCP",
    cluster: "localnet",
  });
  const runtime = connectLeash({
    cluster: resolveClusterConfig("localnet", { usdcMint: bed.mint }),
    signer,
    owner: bed.keys.owner.address,
    chain: bed.chain,
    fetch: async (input, init) => merchant.fetch(new Request(input, init)),
    pairingLink,
    logger: { warn: () => {} },
  });
  return { bed, tools: runtime.tools, pairingLink };
}

/** An MCP client talking to the Leash server in process, the way Claude Desktop would over stdio. */
export async function connected(tools: LeashTools) {
  const log = vi.fn();
  const server = createLeashMcpServer({ tools, log });
  const client = new Client({ name: "leash-test-client", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  /** Calls a tool and parses the JSON text it returns. */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [first] = result.content as Array<{ type: string; text: string }>;
    return { isError: result.isError === true, text: first?.text ?? "", result };
  };
  const json = async (name: string, args: Record<string, unknown> = {}) => {
    const { isError, text } = await call(name, args);
    return { isError, output: JSON.parse(text) as Record<string, unknown> };
  };
  return { client, server, log, call, json };
}
