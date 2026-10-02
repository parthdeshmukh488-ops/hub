import {
  HealthResponseSchema,
  LeashEventSchema,
  type StatsView,
  StatsViewSchema,
} from "@leash/contracts";
import {
  buildApproveRequest,
  fetchAgentViews,
  fetchOpenRequests,
  fetchPayees,
  fetchPrincipalView,
  LEASH_PROGRAM_ADDRESS,
  LeashAgent,
  type LeashChain,
  PaymentDeniedError,
  readChainTime,
} from "@leash/sdk";
import { createTestbed, type Testbed, USDC } from "@leash/sdk/testing";
import { address } from "@solana/kit";
import { afterEach, describe, expect, it } from "vitest";
import { createPipeline } from "../src/pipeline.ts";
import { createChainSource } from "../src/sources/chain.ts";
import { createFixtureSource } from "../src/sources/fixtures.ts";
import { startTestIndexer, type TestIndexer } from "../src/testing.ts";
import { log, storyline, testStore } from "./helpers.ts";

// WS4 build steps 3–4 (Task E): the account snapshot, stats on chain data, and an honest health.

const closers: TestIndexer[] = [];
afterEach(async () => {
  for (const indexer of closers.splice(0)) await indexer.close();
});

function agentOf(bed: Testbed) {
  return new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: () => {} },
  });
}

const pay = (agent: LeashAgent, bed: Testbed, amount: bigint) =>
  agent.pay({ to: bed.keys.merchant.address, amount, purpose: `Research ${amount}` });

async function blocked(agent: LeashAgent, bed: Testbed) {
  const error = await agent
    .pay({ to: bed.keys.attacker.address, amount: 25n * USDC, purpose: "Author tip" })
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(error).toBeInstanceOf(PaymentDeniedError);
}

async function get<T>(indexer: TestIndexer, path: string, schema: { parse(v: unknown): T }) {
  const response = await fetch(`${indexer.url}${path}`);
  expect(response.status).toBe(200);
  return schema.parse(await response.json());
}

describe("the account snapshot (accounts give truth)", () => {
  it("lists an owner whose onboarding the first backfill missed, equal to the SDK's reads", async () => {
    const bed = await createTestbed();
    const agent = agentOf(bed);
    await pay(agent, bed, 10_000n);
    await pay(agent, bed, 20_000n);
    await blocked(agent, bed);
    await agent.requestApproval({
      to: bed.keys.merchant.address,
      amount: 1_500_000n,
      purpose: "Premium report",
    });

    // A first start that reads only the newest two transactions: not the onboarding.
    const { store } = await testStore({ delegationsFromEvents: false });
    await store.claim("chain");
    const source = createChainSource({
      chain: bed.chain,
      programId: LEASH_PROGRAM_ADDRESS,
      cursor: { load: () => store.cursor("chain"), save: (c) => store.saveCursor("chain", c) },
      knownAgents: () => store.knownAgents(),
      pollIntervalMs: 60_000,
      backfillLimit: 2,
      now: () => Number(bed.now()),
    });
    const sink = createPipeline(store, null, () => Number(bed.now()), log);
    const owner = bed.keys.owner.address;
    const now = await readChainTime(bed.chain);

    expect(await source.pollOnce(sink)).toEqual({ processed: 2 });
    expect(source.needsSnapshot()).toBe(true);
    // Events alone: the owner is unknown, and so is whose the two events are.
    expect(await store.ownerOverview(owner, Number(now))).toEqual({ principal: null, agents: [] });
    expect((await store.events({ owner, limit: 50 }))?.items).toEqual([]);

    await source.snapshot(sink);
    expect(source.needsSnapshot()).toBe(false);
    const overview = await store.ownerOverview(owner, Number(now));
    expect(overview.principal).toEqual(await fetchPrincipalView(bed.chain, owner));
    expect(overview.agents).toEqual(await fetchAgentViews(bed.chain, owner, { now }));
    expect(overview.agents[0]?.stats).toMatchObject({ paymentsCount: 2, deniedCount: 1 });
    const detail = await store.agentDetail(bed.accounts.agent, Number(now));
    expect(detail?.payees).toEqual(await fetchPayees(bed.chain, bed.accounts.agent));
    const open = await fetchOpenRequests(bed.chain, bed.accounts.agent);
    expect(open).toHaveLength(1);
    expect(detail?.requests).toEqual(open);
    expect(await store.requests(owner)).toEqual({ items: open });
    expect(await store.guardianOwners(bed.keys.guardian.address)).toEqual([owner]);

    // The two events it did read now belong to the owner.
    const events = (await store.events({ owner, limit: 50 }))?.items ?? [];
    expect(events.map((e) => e.type).reverse()).toEqual(["PaymentDenied", "PaymentRequested"]);
    for (const event of events) expect(LeashEventSchema.parse(event)).toEqual(event);

    // Later events project on top of the snapshot as usual: the owner approves, the agent pays.
    const [request] = open;
    if (!request) throw new Error("no open request");
    await bed.send(bed.keys.owner, [
      await buildApproveRequest({
        owner: bed.keys.owner,
        agent: bed.accounts.agent,
        request: address(request.address),
      }),
    ]);
    await pay(agent, bed, 1_500_000n);
    expect(await source.pollOnce(sink)).toEqual({ processed: 2 });
    const after = await store.ownerOverview(owner, Number(now));
    expect(after.agents).toEqual(await fetchAgentViews(bed.chain, owner, { now }));
    expect(await store.requests(owner)).toEqual({ items: [] });
  });

  it("removes what no longer exists on-chain, and keeps the event history", async () => {
    const bed = await createTestbed();
    const agent = agentOf(bed);
    await agent.requestApproval({
      to: bed.keys.merchant.address,
      amount: 1_500_000n,
      purpose: "Premium report",
    });
    const indexer = await startTestIndexer({
      source: { kind: "chain", chain: bed.chain, programId: LEASH_PROGRAM_ADDRESS },
      now: () => Number(bed.now()),
    });
    closers.push(indexer);
    const owner = bed.keys.owner.address;
    expect((await indexer.store.requests(owner)).items).toHaveLength(1);
    const history = (await indexer.store.events({ owner, limit: 50 }))?.items.length;

    // The indexer misses the transaction that closed the request (say, an RPC that dropped it):
    // the snapshot alone must take the request away.
    const { items } = await indexer.store.requests(owner);
    const stale = items[0];
    if (!stale) throw new Error("no request");
    await indexer.store.applySnapshot({
      principals: [],
      agents: [],
      payees: [],
      requests: [],
      delegations: [],
    });
    expect((await indexer.store.requests(owner)).items).toEqual([]);
    expect(await indexer.store.ownerOverview(owner, Number(bed.now()))).toEqual({
      principal: null,
      agents: [],
    });
    expect((await indexer.store.events({ owner, limit: 50 }))?.items.length).toBe(history);

    // And the real snapshot puts back everything that does exist.
    await indexer.snapshot();
    expect((await indexer.store.requests(owner)).items).toEqual([stale]);
    expect((await indexer.store.ownerOverview(owner, Number(bed.now()))).agents).toHaveLength(1);
  });
});

describe("stats on chain data", () => {
  it("/v1/owners/:owner/stats matches the payments, denials and spend the testbed produced", async () => {
    const bed = await createTestbed();
    const agent = agentOf(bed);
    const indexer = await startTestIndexer({
      source: { kind: "chain", chain: bed.chain, programId: LEASH_PROGRAM_ADDRESS },
      now: () => Number(bed.now()),
    });
    closers.push(indexer);
    await pay(agent, bed, 10_000n);
    await pay(agent, bed, 20_000n);
    await blocked(agent, bed);
    await blocked(agent, bed);
    await pay(agent, bed, 30_000n);
    await indexer.sync();

    const owner = bed.keys.owner.address;
    const stats: StatsView = await get(
      indexer,
      `/v1/owners/${owner}/stats?window=24h`,
      StatsViewSchema,
    );
    const paid = 60_000n.toString();
    expect(stats).toEqual({
      window: "24h",
      totals: { paid, payments: 3, denied: 2, strikes: 2, frozenAgents: 0 },
      byAgent: [
        {
          agent: bed.accounts.agent,
          label: expect.any(String),
          paid,
          payments: 3,
          denied: 2,
        },
      ],
      byPayee: [{ payee: bed.keys.merchant.address, label: expect.any(String), paid, payments: 3 }],
    });
    // The merchant really received that much, and the agent's on-chain counters agree.
    expect(await bed.balanceOf(bed.keys.merchant.address)).toBe(60_000n);
    const [view] = await fetchAgentViews(bed.chain, owner);
    expect(view?.stats).toMatchObject({ paymentsCount: 3, deniedCount: 2, totalPaid: paid });

    // A day later, the 24h window is empty; the 7d window still holds every payment.
    bed.advance(86_401n);
    const later = await get(indexer, `/v1/owners/${owner}/stats?window=24h`, StatsViewSchema);
    expect(later.totals).toMatchObject({ paid: "0", payments: 0, denied: 0 });
    const week = await get(indexer, `/v1/owners/${owner}/stats?window=7d`, StatsViewSchema);
    expect(week.totals).toMatchObject({ paid, payments: 3, denied: 2 });
  });
});

describe("/v1/health", () => {
  it("says ok: false after three failed polls in a row, and ok: true after the next success", async () => {
    const bed = await createTestbed();
    let down = false;
    const chain: LeashChain = {
      ...bed.chain,
      getSignatures: async (address, page) => {
        if (down) throw new Error("rpc down");
        return bed.chain.getSignatures(address, page);
      },
    };
    const indexer = await startTestIndexer({
      source: { kind: "chain", chain, programId: LEASH_PROGRAM_ADDRESS },
      now: () => Number(bed.now()),
    });
    closers.push(indexer);
    const health = () => get(indexer, "/v1/health", HealthResponseSchema);
    expect(await health()).toMatchObject({ ok: true, lagSeconds: 0 });

    down = true;
    for (let failure = 1; failure <= 3; failure++) {
      bed.advance(10n);
      await expect(indexer.sync()).rejects.toThrow("rpc down");
      // Two failures may be a blip; the third means the source cannot make progress.
      expect((await health()).ok).toBe(failure < 3);
    }
    // Still HTTP 200 with the contract's fields, and the lag says how long it has been.
    expect(await health()).toMatchObject({ ok: false, lagSeconds: 30 });

    down = false;
    await indexer.sync();
    expect(await health()).toMatchObject({ ok: true, lagSeconds: 0 });
  });

  it("says ok: false once the fixture replay failed", async () => {
    const source = createFixtureSource(storyline, { speed: 0, loop: false, onError: () => {} });
    expect(source.healthy()).toBe(true);
    await source.start({
      accounts: async () => {},
      events: async () => {
        throw new Error("disk full");
      },
      resetProjections: async () => {},
      snapshot: async () => {},
    });
    expect(source.healthy()).toBe(false);
  });
});
