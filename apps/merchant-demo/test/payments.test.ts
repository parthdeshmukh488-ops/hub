import { CAIP2 } from "@leash/contracts";
import { LeashAgent, PaymentDeniedError } from "@leash/sdk";
import { createTestbed } from "@leash/sdk/testing";
import { createLeashFetch } from "@leash/x402";
import { createLeashFacilitator } from "@leash/x402/facilitator";
import type { FacilitatorClient } from "@leash/x402/merchant";
import { litesvmFacilitatorSigner } from "@leash/x402/testing";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import { createApp, paidRoutes } from "../src/server.ts";
import { content } from "./helpers.ts";

// Build step 2: the paid routes behind the official x402 middleware, paid by a Leash agent
// through the official facilitator, on the real program in LiteSVM.

const NETWORK = CAIP2.localnet;

async function setup() {
  const bed = await createTestbed();
  const facilitator = createLeashFacilitator({
    signer: litesvmFacilitatorSigner(bed.svm, [bed.keys.stranger]),
    networks: NETWORK,
  });
  const client: FacilitatorClient = {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    getSupported: async () =>
      facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
  };
  const wallets = { merchant: bed.keys.merchant.address, attacker: bed.keys.attacker.address };
  const app = createApp(
    { wallets, payments: "on", x402: { facilitator: client, network: NETWORK, asset: bed.mint } },
    content,
  );
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
  const get = (path: string) =>
    leashFetch({
      url: `http://merchant.test${path}`,
      method: "GET",
      headers: {},
      body: undefined,
      purpose: `Merchant demo: ${path}`,
    });
  return { bed, app, get, wallets };
}

const denial = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e,
  );

describe("payments on", () => {
  it("prices every paid route from the catalog", () => {
    const routes = paidRoutes({ merchant: "M", attacker: "A" });
    expect(routes).toEqual({
      "GET /api/research": expect.objectContaining({ price: "0.01", payTo: "M" }),
      "GET /api/market/:symbol": expect.objectContaining({ price: "0.02", payTo: "M" }),
      "GET /api/reports/premium": expect.objectContaining({ price: "1.50", payTo: "M" }),
      "GET /lab/unlock": expect.objectContaining({ price: "25.00", payTo: "A" }),
      "GET /lab/research-premium": expect.objectContaining({ price: "9.00", payTo: "M" }),
      "GET /lab/loop": expect.objectContaining({ price: "0.01", payTo: "M" }),
    });
  });

  it("answers an unpaid request with a 402 challenge the agent can pay", async () => {
    const { bed, app } = await setup();
    const response = await app.request("http://merchant.test/api/research?q=range");
    expect(response.status).toBe(402);
    const required = decodePaymentRequiredHeader(response.headers.get("PAYMENT-REQUIRED") ?? "");
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: NETWORK,
      asset: bed.mint,
      amount: "10000",
      payTo: bed.keys.merchant.address,
      extra: { feePayer: bed.keys.stranger.address },
    });
  });

  it("serves paid routes once a Leash payment settles, and free routes for free", async () => {
    const { bed, get } = await setup();
    const research = await get("/api/research?q=range");
    expect(research.status).toBe(200);
    expect(JSON.parse(research.body).query).toBe("range");
    expect(research.payment).toMatchObject({ amount: 10_000n, payeeLabel: "Research API" });
    const symbol = content.market.symbols[0]?.symbol ?? "";
    const market = await get(`/api/market/${symbol}`);
    expect(market.payment?.amount).toBe(20_000n);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(30_000n);
    // A request the handler fails is never settled: nothing charged.
    await expect(get("/api/market/NOPE")).rejects.toThrow(/status 404/);
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(30_000n);
    const catalog = await get("/");
    expect(catalog.payment).toBeNull();
    expect(JSON.parse(catalog.body).payments).toBe("on");
    expect((await get("/lab")).payment).toBeNull();
  });

  it("blocks the lab's attacks on-chain", async () => {
    const { bed, get } = await setup();
    // The injection's unlock pays an unknown wallet: blocked, recorded, a strike.
    expect(await denial(get("/lab/unlock"))).toMatchObject({
      reason: "payeeNotAllowed",
      recorded: true,
      strikes: 1,
    });
    // Overpriced: above what even an approval could allow.
    expect(await denial(get("/lab/research-premium?q=x"))).toMatchObject({
      reason: "exceedsPaymentLimit",
      recorded: true,
      strikes: 2,
    });
    // The premium report needs the owner's approval, and is not a strike.
    const premium = await denial(get("/api/reports/premium"));
    expect(premium).toBeInstanceOf(PaymentDeniedError);
    expect(premium).toMatchObject({ reason: "approvalRequired", recorded: false });
    expect(await bed.balanceOf(bed.keys.attacker.address)).toBe(0n);
  });
});
