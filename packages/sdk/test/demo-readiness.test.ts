import { describe, expect, it } from "vitest";
import {
  type Check,
  checkReadiness,
  LOCAL_SERVICES,
  type ReadinessInput,
} from "../scripts/demo-readiness.ts";
import { buildFreezeAgent, LEASH_PROGRAM_ADDRESS, LeashAgent } from "../src/index.ts";
import { createTestbed, type Testbed, USDC } from "../src/testing/index.ts";

// `pnpm demo:check` on the testbed, which mirrors the demo's preset (5 USDC a day, the Research
// API at 3 USDC a day, three strikes in ten minutes): each thing that would spoil a take.

type Answers = Partial<Record<keyof typeof LOCAL_SERVICES | "overview", Response | "down">>;

/** The services as a take needs them, unless `answers` says otherwise. */
function services(bed: Testbed, answers: Answers = {}): NonNullable<ReadinessInput["services"]> {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const healthy: Required<Answers> = {
    facilitator: json({ ok: true }),
    merchantPaid: json({ error: "payment required" }, 402),
    indexer: json({
      ok: true,
      cluster: "localnet",
      programId: LEASH_PROGRAM_ADDRESS,
      lastProcessedSlot: 1,
      lastEventAt: 1,
      lagSeconds: 1,
    }),
    overview: json({ principal: {}, agents: [{ address: bed.accounts.agent }] }),
    sentinel: json({ ok: true }),
    web: new Response("<html></html>"),
  };
  const pick = (key: keyof Required<Answers>) => {
    const answer = answers[key] ?? healthy[key];
    if (answer === "down") throw new TypeError("fetch failed");
    return answer.clone();
  };
  const fetcher = async (url: string | URL | Request) => {
    const target = String(url);
    if (target === LOCAL_SERVICES.facilitator) return pick("facilitator");
    if (target === LOCAL_SERVICES.merchantPaid) return pick("merchantPaid");
    if (target === `${LOCAL_SERVICES.indexer}/v1/health`) return pick("indexer");
    if (target.startsWith(`${LOCAL_SERVICES.indexer}/v1/owners/`)) return pick("overview");
    if (target === LOCAL_SERVICES.sentinel) return pick("sentinel");
    if (target === LOCAL_SERVICES.web) return pick("web");
    throw new Error(`unexpected URL ${target}`);
  };
  return { fetch: fetcher as typeof fetch, urls: LOCAL_SERVICES };
}

function readiness(bed: Testbed, extra: Partial<ReadinessInput> = {}): Promise<Check[]> {
  return checkReadiness({
    chain: bed.chain,
    cluster: "localnet",
    owner: bed.keys.owner.address,
    agentKey: bed.keys.agentKey.address,
    merchant: bed.keys.merchant.address,
    mint: bed.mint,
    feePayers: [
      { name: "owner-demo", address: bed.keys.owner.address, minLamports: 10_000_000n },
      { name: "agent", address: bed.keys.agentKey.address, minLamports: 20_000_000n },
    ],
    services: null,
    ...extra,
  });
}

const failed = (checks: Check[]) => checks.filter((c) => c.level === "fail").map((c) => c.name);
const named = (checks: Check[], name: string) => checks.find((c) => c.name === name);

const agentOf = (bed: Testbed) =>
  new LeashAgent({
    chain: bed.chain,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    logger: { warn: () => {} },
  });

describe("pnpm demo:check", () => {
  it("finds a fresh demo world and its services ready for a take", async () => {
    const bed = await createTestbed();
    const checks = await readiness(bed, { services: services(bed) });
    expect(failed(checks)).toEqual([]);
    expect(checks.every((c) => c.level === "ok")).toBe(true);
    expect(checks.map((c) => c.name)).toEqual([
      "owner-demo SOL",
      "agent SOL",
      "owner-demo USDC",
      "all agents",
      "agent",
      "strikes",
      "allowance",
      expect.stringMatching(/budget$/),
      "open requests",
      "facilitator",
      "merchant",
      "indexer",
      "indexer sees the agent",
      "sentinel",
      "web app",
    ]);
  });

  it("fails on a strike that still counts, until its window has passed", async () => {
    const bed = await createTestbed();
    await agentOf(bed)
      .pay({ to: bed.keys.attacker.address, amount: USDC, purpose: "tip" })
      .catch(() => {});
    const checks = await readiness(bed);
    expect(failed(checks)).toEqual(["strikes"]);
    expect(named(checks, "strikes")?.fix).toMatch(/pnpm owner:unfreeze --cluster localnet/);
    bed.advance(601n);
    expect(failed(await readiness(bed))).toEqual([]);
  });

  it("fails on a frozen agent, and points to the unfreeze", async () => {
    const bed = await createTestbed();
    await bed.send(bed.keys.owner, [
      await buildFreezeAgent({
        authority: bed.keys.owner,
        owner: bed.keys.owner.address,
        agent: bed.accounts.agent,
      }),
    ]);
    const checks = await readiness(bed);
    expect(failed(checks)).toEqual(["agent"]);
    expect(named(checks, "agent")?.detail).toMatch(/frozen \(owner\)/);
  });

  it("warns about requests left from an earlier take", async () => {
    const bed = await createTestbed();
    await agentOf(bed).requestApproval({
      to: bed.keys.merchant.address,
      amount: 2n * USDC,
      purpose: "Deep report",
    });
    const checks = await readiness(bed);
    expect(failed(checks)).toEqual([]);
    expect(named(checks, "open requests")?.level).toBe("warn");
  });

  it("fails when the payee's budget for today is used up, and names when it resets", async () => {
    const bed = await createTestbed();
    const agent = agentOf(bed);
    for (let i = 0; i < 3; i++) {
      await agent.pay({ to: bed.keys.merchant.address, amount: USDC, purpose: `call ${i}` });
    }
    const checks = await readiness(bed);
    const budget = checks.find((c) => c.name.endsWith("budget"));
    expect(failed(checks)).toEqual([budget?.name]);
    expect(budget?.detail).toMatch(/^0(\.0+)? USDC left today/);
    expect(budget?.fix).toMatch(/wait until \d\d:\d\d:\d\d UTC/);
  });

  it("names services that are down, off, or on another cluster", async () => {
    const bed = await createTestbed();
    const checks = await readiness(bed, {
      services: services(bed, {
        merchantPaid: Response.json({ results: [] }),
        sentinel: "down",
        indexer: Response.json({
          ok: true,
          cluster: "devnet",
          programId: LEASH_PROGRAM_ADDRESS,
          lastProcessedSlot: 1,
          lastEventAt: 1,
          lagSeconds: 1,
        }),
      }),
    });
    expect(failed(checks)).toEqual(["merchant", "indexer", "sentinel"]);
    expect(named(checks, "merchant")?.detail).toMatch(/payments are off/);
    expect(named(checks, "indexer")?.detail).toBe("follows devnet, not localnet");
    expect(named(checks, "sentinel")?.detail).toBe("not reachable");
  });
});
