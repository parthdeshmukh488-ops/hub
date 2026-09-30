import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

// The real entry point over real stdio, as Claude Desktop and Claude Code start it. There is no
// chain in the cloud (ADR-0007), so the RPC points at a closed port.

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(PACKAGE, "node_modules/.bin/tsx");
const OWNER = "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9";
const CLOSED_RPC = "http://127.0.0.1:9";

describe("the stdio server", () => {
  it("refuses to start without an owner, says why on stderr, and writes nothing to stdout", () => {
    const run = spawnSync(TSX, ["src/main.ts"], {
      cwd: PACKAGE,
      env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), "leash-home-")) },
      input: "",
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("AGENT_OWNER");
  }, 30_000);

  it("creates the agent key, serves the tools over stdio, and says NETWORK_ERROR while the chain is out of reach", async () => {
    const keyPath = join(mkdtempSync(join(tmpdir(), "leash-mcp-")), "agent.json");
    const transport = new StdioClientTransport({
      command: TSX,
      args: ["src/main.ts"],
      cwd: PACKAGE,
      env: {
        PATH: process.env.PATH ?? "",
        AGENT_OWNER: OWNER,
        AGENT_KEYPAIR: keyPath,
        LEASH_CLUSTER: "localnet",
        LEASH_RPC_URL: CLOSED_RPC,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "leash-stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "leash_fetch",
        "leash_pay",
        "leash_request_approval",
        "leash_status",
      ]);
      const status = await client.callTool({ name: "leash_status", arguments: {} });
      expect(status.isError).toBe(true);
      const [first] = status.content as Array<{ text: string }>;
      expect(JSON.parse(first?.text ?? "{}")).toMatchObject({
        code: "NETWORK_ERROR",
        retryable: true,
      });
      expect(statSync(keyPath).mode & 0o777).toBe(0o600);
      expect(stderr).toContain(`created a new agent key at ${keyPath}`);
      expect(stderr).toMatch(/ready on localnet: agent key \w+, owner 4gMnh/);
    } finally {
      await client.close();
    }
  }, 30_000);
});
