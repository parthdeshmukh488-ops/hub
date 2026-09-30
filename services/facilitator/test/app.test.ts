import { CAIP2 } from "@leash/contracts";
import { LeashAgent } from "@leash/sdk";
import { createTestbed, USDC } from "@leash/sdk/testing";
import { LeashExactSvmScheme } from "@leash/x402";
import { createLeashFacilitator } from "@leash/x402/facilitator";
import { litesvmFacilitatorSigner } from "@leash/x402/testing";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, verificationPath } from "../src/app.ts";
import { parseEnv } from "../src/env.ts";
import { createRateLimiter } from "../src/rate-limit.ts";

// The facilitator service over the official scheme, on the real binaries in LiteSVM.

const NETWORK = CAIP2.localnet;

async function setup(options: { limit?: number } = {}) {
  const bed = await createTestbed();
  const feePayer = bed.keys.stranger;
  const facilitator = createLeashFacilitator({
    signer: litesvmFacilitatorSigner(bed.svm, [feePayer]),
    networks: NETWORK,
  });
  const logs: Record<string, unknown>[] = [];
  const log = pino({ level: "info" }, { write: (line: string) => logs.push(JSON.parse(line)) });
  const app = createApp({
    facilitator,
    log,
    cluster: "localnet",
    feePayer: feePayer.address,
    webOrigin: "http://localhost:3000",
    rateLimiter: createRateLimiter({ limit: options.limit ?? 100, windowMs: 60_000 }),
    clientOf: () => "test-client",
  });
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: NETWORK,
    asset: bed.mint,
    amount: (USDC / 10n).toString(),
    payTo: bed.keys.merchant.address,
    maxTimeoutSeconds: 60,
    extra: { feePayer: feePayer.address },
  };
  const agent = new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
  });
  const scheme = new LeashExactSvmScheme({
    agent,
    chain: bed.chain,
    network: NETWORK,
    purpose: "x",
  });
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: (await scheme.createPaymentPayload(2, requirements)).payload,
  };
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { bed, app, logs, requirements, payload, post, feePayer };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the facilitator service", () => {
  it("reports its health and the supported kinds", async () => {
    const { app, feePayer } = await setup();
    const health = await (await app.request("/health")).json();
    expect(health).toEqual({
      ok: true,
      service: "facilitator",
      cluster: "localnet",
      feePayer: feePayer.address,
      networks: [NETWORK],
    });
    const supported = (await (await app.request("/supported")).json()) as {
      kinds: { scheme: string; network: string }[];
    };
    expect(supported.kinds[0]).toMatchObject({ scheme: "exact", network: NETWORK });
  });

  it("verifies and settles a Leash payment, and logs the smart-wallet path", async () => {
    const { bed, logs, requirements, payload, post } = await setup();
    const body = { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements };
    const verified = await (await post("/verify", body)).json();
    expect(verified).toMatchObject({ isValid: true });
    const settled = await (await post("/settle", body)).json();
    expect(settled).toMatchObject({ success: true, network: NETWORK });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(USDC / 10n);
    expect(logs.map((l) => [l.msg, l.verificationPath])).toEqual([
      ["verify", "smartWallet"],
      ["settle", "smartWallet"],
    ]);
    expect(logs[0]).toMatchObject({ isValid: true, amount: "100000", client: "test-client" });
  });

  it("speaks the protocol the official HTTP facilitator client expects", async () => {
    const { bed, app, requirements, payload } = await setup();
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      app.fetch(new Request(input, init)),
    );
    const client = new HTTPFacilitatorClient({ url: "http://facilitator.test" });
    expect((await client.getSupported()).kinds[0]?.network).toBe(NETWORK);
    expect(await client.verify(payload, requirements)).toMatchObject({ isValid: true });
    expect(await client.settle(payload, requirements)).toMatchObject({ success: true });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(USDC / 10n);
  });

  it("refuses malformed requests, unsupported networks and too many requests", async () => {
    const { post, requirements, payload } = await setup({ limit: 3 });
    expect((await post("/verify", { nope: true })).status).toBe(400);
    const elsewhere = { ...requirements, network: CAIP2.devnet };
    const refused = await post("/verify", {
      x402Version: 2,
      paymentPayload: { ...payload, accepted: elsewhere },
      paymentRequirements: elsewhere,
    });
    expect(refused.status).toBe(400);
    expect((await post("/settle", { nope: true })).status).toBe(400);
    const limited = await post("/verify", { nope: true });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
  });

  it("classifies verification paths for the logs", async () => {
    const { payload } = await setup();
    expect(verificationPath(payload)).toBe("smartWallet");
    expect(verificationPath({ ...payload, payload: { transaction: "not base64!" } })).toBe(
      "undecodable",
    );
  });
});

describe("rate limiter", () => {
  it("allows a number of requests per client and window", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    expect([0, 1, 2].map((t) => limiter.allow("a", t))).toEqual([true, true, false]);
    expect(limiter.allow("b", 2)).toBe(true);
    expect(limiter.allow("a", 1_000)).toBe(true);
  });
});

describe("environment", () => {
  it("has defaults and rejects nonsense", () => {
    expect(parseEnv({})).toMatchObject({
      LEASH_CLUSTER: "localnet",
      FACILITATOR_PORT: 4200,
      FACILITATOR_FEE_PAYER_KEYPAIR: ".keys/facilitator.json",
    });
    expect(parseEnv({ FACILITATOR_PORT: "", LEASH_CLUSTER: "devnet" }).LEASH_CLUSTER).toBe(
      "devnet",
    );
    expect(() => parseEnv({ LEASH_CLUSTER: "mainnet" })).toThrow(/Invalid facilitator environment/);
  });
});
