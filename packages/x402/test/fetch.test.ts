import {
  buildApproveRequest,
  LeashAgent,
  LeashNetworkError,
  MerchantRejectedError,
  PaymentDeniedError,
  UnsupportedPaymentError,
} from "@leash/sdk";
import { USDC } from "@leash/sdk/testing";
import type { Address } from "@solana/kit";
import type { x402Facilitator } from "@x402/core/facilitator";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLeashFetch } from "../src/index.ts";
import { type FacilitatorClient, leashMerchant } from "../src/merchant/index.ts";
import { createX402Bed, facilitatorOf, NETWORK, type X402Bed } from "./helpers.ts";

// End to end (WS3 test table, last row): agent → leashFetch → merchant (official @x402/hono
// middleware) → facilitator (official ExactSvmScheme) → Leash → Subscriptions → Token, all in
// process on the real binaries.

const inProcess = (facilitator: x402Facilitator): FacilitatorClient => ({
  verify: (payload, requirements) => facilitator.verify(payload, requirements),
  settle: (payload, requirements) => facilitator.settle(payload, requirements),
  // The facilitator types networks as plain strings; the client type wants CAIP-2 templates.
  getSupported: async () =>
    facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
});

function merchantApp(
  bed: X402Bed,
  options: { payTo?: string; price?: string; facilitator?: x402Facilitator; asset?: string } = {},
) {
  const app = new Hono();
  app.use(
    leashMerchant({
      payTo: options.payTo ?? bed.keys.merchant.address,
      facilitator: inProcess(options.facilitator ?? facilitatorOf(bed)),
      network: NETWORK,
      asset: options.asset ?? bed.mint,
      routes: { "GET /api/research": { price: options.price ?? "0.01", description: "A report" } },
    }),
  );
  app.get("/api/research", (c) => c.json({ answer: 42 }));
  app.get("/free", (c) => c.text("free"));
  return app;
}

function fetchOf(bed: X402Bed, app: Hono) {
  const agent = new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: () => {} },
  });
  const leashFetch = createLeashFetch({
    agent,
    chain: bed.chain,
    network: NETWORK,
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
  const get = (path: string, purpose = "Research API: one report") =>
    leashFetch({
      url: `http://merchant.test${path}`,
      method: "GET",
      headers: {},
      body: undefined,
      purpose,
    });
  return { agent, get };
}

describe("leashFetch against a merchant using the official middleware", () => {
  it("pays the 402 through Leash and returns the resource with the receipt", async () => {
    const bed = await createX402Bed();
    const { get } = fetchOf(bed, merchantApp(bed));
    const result = await get("/api/research");
    expect(result).toMatchObject({ status: 200, body: '{"answer":42}' });
    expect(result.contentType).toContain("application/json");
    expect(result.payment).toMatchObject({
      amount: 10_000n,
      payee: bed.keys.merchant.address,
      payeeLabel: "Research API",
      purpose: "Research API: one report",
      requestNonce: null,
    });
    expect(result.payment?.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(10_000n);
  });

  it("returns free responses untouched", async () => {
    const bed = await createX402Bed();
    const { get } = fetchOf(bed, merchantApp(bed));
    const result = await get("/free");
    expect(result).toMatchObject({ status: 200, body: "free", payment: null });
    expect(result.contentType).toMatch(/^text\/plain/);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(0n);
  });

  it("surfaces a denial with the challenge's payee and amount, recorded on-chain", async () => {
    const bed = await createX402Bed();
    const { get } = fetchOf(bed, merchantApp(bed, { payTo: bed.keys.attacker.address }));
    const error = await get("/api/research").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentDeniedError);
    expect(error).toMatchObject({
      reason: "payeeNotAllowed",
      recorded: true,
      strikes: 1,
      attempted: { to: bed.keys.attacker.address, amount: 10_000n },
    });
    expect(await bed.balanceOf(bed.keys.attacker.address)).toBe(0n);
  });

  it("needs approval above the instant limit, then pays with the approved request", async () => {
    const bed = await createX402Bed();
    const { agent, get } = fetchOf(bed, merchantApp(bed, { price: "2" }));
    const first = await get("/api/research").catch((e: unknown) => e);
    expect(first).toMatchObject({ reason: "approvalRequired", recorded: false });
    // What the tools do on approvalRequired, then the owner approves.
    const request = await agent.requestApproval({
      to: bed.keys.merchant.address,
      amount: 2n * USDC,
      purpose: "Deep report",
    });
    await bed.send(bed.keys.owner, [
      await buildApproveRequest({
        owner: bed.keys.owner,
        agent: bed.accounts.agent,
        request: request.address as Address,
      }),
    ]);
    const second = await get("/api/research");
    expect(second.payment).toMatchObject({ amount: 2n * USDC, requestNonce: 0n });
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(2n * USDC);
  });

  it("refuses a challenge it cannot pay", async () => {
    const bed = await createX402Bed();
    const { get } = fetchOf(bed, merchantApp(bed, { asset: bed.keys.stranger.address }));
    await expect(get("/api/research")).rejects.toBeInstanceOf(UnsupportedPaymentError);
  });

  it("reports a facilitator that refuses the payment as MerchantRejectedError, nothing charged", async () => {
    const bed = await createX402Bed();
    const stock = facilitatorOf(bed, { allowLeash: false });
    const { get } = fetchOf(bed, merchantApp(bed, { facilitator: stock }));
    await expect(get("/api/research")).rejects.toBeInstanceOf(MerchantRejectedError);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(0n);
  });

  it("reports an unreachable merchant as LeashNetworkError", async () => {
    const bed = await createX402Bed();
    const agent = new LeashAgent({
      chain: bed.chain,
      signer: bed.keys.agentKey,
      owner: bed.keys.owner.address,
    });
    const leashFetch = createLeashFetch({
      agent,
      chain: bed.chain,
      network: NETWORK,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(
      leashFetch({
        url: "http://down.test/",
        method: "GET",
        headers: {},
        body: undefined,
        purpose: "x",
      }),
    ).rejects.toBeInstanceOf(LeashNetworkError);
  });
});
