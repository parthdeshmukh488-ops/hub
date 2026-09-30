import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CAIP2, LeashStatusOutputSchema, resolveClusterConfig } from "@leash/contracts";
import { LeashNetworkError, NotPairedError } from "@leash/sdk";
import { createTestbed } from "@leash/sdk/testing";
import { createLeashFacilitator } from "@leash/x402/facilitator";
import { type FacilitatorClient, leashMerchant } from "@leash/x402/merchant";
import { litesvmFacilitatorSigner } from "@leash/x402/testing";
import { getAddressEncoder } from "@solana/kit";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  AgentKeyError,
  connectLeash,
  loadAgentKey,
  resolveKeypairPath,
  waitForPairing,
} from "../src/node/index.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "leash-tools-"));

describe("loadAgentKey", () => {
  it("creates a Solana CLI keypair file readable only by the user, then loads the same key", async () => {
    const path = join(tempDir(), "nested", "agent.json");
    const created = await loadAgentKey(path, { create: true });
    expect(created).toMatchObject({ path, created: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
    expect(bytes).toHaveLength(64);
    expect(bytes.slice(32)).toEqual([...getAddressEncoder().encode(created.signer.address)]);
    const loaded = await loadAgentKey(path, { create: true });
    expect(loaded).toMatchObject({ created: false });
    expect(loaded.signer.address).toBe(created.signer.address);
  });

  it("refuses a missing file unless asked to create one", async () => {
    const path = join(tempDir(), "missing.json");
    await expect(loadAgentKey(path)).rejects.toThrow(
      new AgentKeyError(`No agent keypair at ${path}.`),
    );
  });

  it("names the problem with a bad file without ever echoing its content (T17)", async () => {
    const dir = tempDir();
    const bad = {
      "not-json.json": "seed words that must never be printed",
      "short.json": JSON.stringify([1, 2, 3]),
      "not-bytes.json": JSON.stringify(Array.from({ length: 64 }, () => 300)),
      // A valid-looking array whose public half does not match its secret half.
      "mismatch.json": JSON.stringify(Array.from({ length: 64 }, (_, i) => i)),
    };
    for (const [name, content] of Object.entries(bad)) {
      writeFileSync(join(dir, name), content);
      const error = await loadAgentKey(join(dir, name)).catch((e: unknown) => e);
      expect(error, name).toBeInstanceOf(AgentKeyError);
      expect((error as Error).message, name).toContain("is not a Solana CLI keypair file");
      expect((error as Error).message, name).not.toContain(content);
    }
    mkdirSync(join(dir, "a-directory.json"));
    await expect(loadAgentKey(join(dir, "a-directory.json"))).rejects.toThrow(/Cannot read/);
  });

  it("resolves ~ and relative paths", () => {
    expect(resolveKeypairPath("~/.config/leash/agent.json")).toBe(
      join(homedir(), ".config/leash/agent.json"),
    );
    expect(resolveKeypairPath("~")).toBe(homedir());
    expect(resolveKeypairPath(".keys/agent.json", "/repo")).toBe("/repo/.keys/agent.json");
    expect(resolveKeypairPath("/abs/agent.json")).toBe("/abs/agent.json");
  });
});

describe("connectLeash", () => {
  async function setup() {
    const bed = await createTestbed();
    const facilitator = createLeashFacilitator({
      signer: litesvmFacilitatorSigner(bed.svm, [bed.keys.stranger]),
      networks: CAIP2.localnet,
    });
    const client: FacilitatorClient = {
      verify: (payload, requirements) => facilitator.verify(payload, requirements),
      settle: (payload, requirements) => facilitator.settle(payload, requirements),
      getSupported: async () =>
        facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
    };
    const merchant = new Hono();
    merchant.use(
      leashMerchant({
        payTo: bed.keys.merchant.address,
        facilitator: client,
        network: CAIP2.localnet,
        asset: bed.mint,
        routes: { "GET /api/research": { price: "0.01" } },
      }),
    );
    merchant.get("/api/research", (c) => c.json({ report: "Hub motors are quieter." }));
    const cluster = resolveClusterConfig("localnet", { usdcMint: bed.mint });
    const connect = (signer = bed.keys.agentKey) =>
      connectLeash({
        cluster,
        signer,
        owner: bed.keys.owner.address,
        chain: bed.chain,
        fetch: async (input, init) => merchant.fetch(new Request(input, init)),
        priorityFeeMicroLamports: 1n,
        logger: { warn: () => {} },
      });
    return { bed, connect };
  }

  it("gives the tools the real agent and x402 client: status, a paid fetch, a blocked payment", async () => {
    const { bed, connect } = await setup();
    const { tools, agent } = connect();
    expect(agent.address).toBe(bed.keys.agentKey.address);

    const status = LeashStatusOutputSchema.parse(await tools.status());
    expect(status).toMatchObject({
      ok: true,
      agent: { label: "Research agent", status: "active" },
    });

    const fetched = await tools.fetch({
      url: "http://merchant.test/api/research?q=motors",
      purpose: "Research: hub vs mid-drive",
    });
    expect(fetched).toMatchObject({
      ok: true,
      status: 200,
      payment: {
        amountUsdc: "0.01",
        payeeLabel: "Research API",
        purpose: "Research: hub vs mid-drive",
      },
    });
    expect(fetched.ok && fetched.payment?.explorerUrl).toContain("cluster=custom");
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(10_000n);

    const blocked = await tools.pay({
      to: bed.keys.attacker.address,
      amountUsdc: "25",
      purpose: "author tip",
    });
    expect(blocked).toMatchObject({
      ok: false,
      code: "PAYEE_NOT_ALLOWED",
      recorded: true,
      strikes: 1,
    });
  });

  it("answers NOT_PAIRED for a key no owner has paired", async () => {
    const { bed, connect } = await setup();
    const { tools } = connect(bed.keys.stranger);
    expect(await tools.status()).toMatchObject({ ok: false, code: "NOT_PAIRED" });
    expect(
      await tools.pay({ to: bed.keys.merchant.address, amountUsdc: "0.01", purpose: "x" }),
    ).toMatchObject({ ok: false, code: "NOT_PAIRED", recorded: false });
  });

  it("builds an RPC chain for the cluster by default, without touching the network", () => {
    const cluster = resolveClusterConfig("devnet");
    const runtime = connectLeash({
      cluster,
      signer: { address: "11111111111111111111111111111111" } as never,
      owner: "11111111111111111111111111111111",
    });
    expect(runtime.cluster).toBe(cluster);
    expect(runtime.chain).toBeDefined();
  });
});

describe("waitForPairing", () => {
  const AGENT_KEY = "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9";
  const instant = async () => {};

  function agentAnswering(...answers: Array<"unpaired" | "paired" | "down">) {
    const status = vi.fn(async () => {
      const next = answers.shift() ?? "paired";
      if (next === "unpaired") throw new NotPairedError();
      if (next === "down") throw new LeashNetworkError("rpc down");
      return {};
    });
    return { address: AGENT_KEY, status };
  }

  it("hands out the pairing link once, polls, and reports when the owner has paired", async () => {
    const agent = agentAnswering("unpaired", "down", "unpaired", "paired");
    const onUnpaired = vi.fn();
    const onPaired = vi.fn();
    const onError = vi.fn();
    const sleep = vi.fn(instant);
    const paired = await waitForPairing({
      agent,
      webUrl: "http://localhost:3000",
      label: "Research Assistant",
      preset: "research-assistant",
      cluster: "devnet",
      onUnpaired,
      onPaired,
      onError,
      intervalMs: 2_000,
      sleep,
    });
    expect(paired).toBe(true);
    expect(onUnpaired).toHaveBeenCalledOnce();
    expect(onUnpaired).toHaveBeenCalledWith(
      `http://localhost:3000/pair?agentKey=${AGENT_KEY}&label=Research+Assistant&preset=research-assistant&cluster=devnet`,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(LeashNetworkError));
    expect(onPaired).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
  });

  it("returns at once when the agent is already paired", async () => {
    const onUnpaired = vi.fn();
    const onPaired = vi.fn();
    const paired = await waitForPairing({
      agent: agentAnswering("paired"),
      webUrl: "http://localhost:3000",
      label: "MCP agent",
      cluster: "localnet",
      onUnpaired,
      onPaired,
    });
    expect(paired).toBe(true);
    expect(onUnpaired).not.toHaveBeenCalled();
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("stops when aborted, also in the middle of a wait", async () => {
    const controller = new AbortController();
    const onUnpaired = vi.fn(() => setTimeout(() => controller.abort(), 5));
    const started = Date.now();
    const paired = await waitForPairing({
      agent: agentAnswering("unpaired", "unpaired"),
      webUrl: "http://localhost:3000",
      label: "MCP agent",
      cluster: "localnet",
      onUnpaired,
      signal: controller.signal,
      intervalMs: 60_000,
    });
    expect(paired).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    // Errors other than "not paired" are optional to observe.
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await waitForPairing({
        agent: agentAnswering("down"),
        webUrl: "http://localhost:3000",
        label: "MCP agent",
        cluster: "localnet",
        onUnpaired,
        signal: aborted.signal,
      }),
    ).toBe(false);
  });
});
