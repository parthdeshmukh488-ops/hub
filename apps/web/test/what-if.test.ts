import type { AgentView } from "@leash/contracts";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import { describe, expect, it } from "vitest";
import { createFixtureSource } from "../src/data/fixtures.ts";
import { DEMO_OWNER } from "../src/data/owner.ts";
import { csvField, eventsToCsv } from "../src/lib/csv.ts";
import { delegationFromView, whatIf } from "../src/lib/what-if.ts";

const [research, market] = overviewJson.agents as unknown as [AgentView, AgentView];
const source = createFixtureSource();
const now = source.now();

async function ask(agent: AgentView, amount: bigint, destination?: string) {
  const detail = await source.agent(DEMO_OWNER, agent.address);
  const merchant = detail?.payees[0];
  if (!merchant) throw new Error("no payee");
  const to = destination ?? merchant.payee;
  const payee = detail?.payees.find((row) => row.payee === to) ?? null;
  return whatIf({ agent, principalFrozen: false, payee, destination: to, amount, now });
}

describe("what if the agent paid…", () => {
  it("lets a small payment to an allowed payee through", async () => {
    expect(await ask(market, 500_000n)).toMatchObject({ tone: "ok", title: "Goes through" });
  });

  it("asks for approval above the instant limit, and blocks above the approval limit", async () => {
    expect(await ask(market, 1_500_000n)).toMatchObject({
      tone: "approval",
      title: "Needs your approval",
    });
    expect(await ask(market, 6_000_000n)).toMatchObject({
      tone: "blocked",
      detail: "Tried to pay more than allowed per payment. The attempt would count as a strike.",
    });
  });

  it("blocks an unknown wallet, and everything while frozen", async () => {
    expect(
      await ask(market, 10_000n, "3Ncik65BqWG53kphdKrYpXwagXiQwKHVmxGNB7ECRPzw"),
    ).toMatchObject({
      tone: "blocked",
      detail: "Tried to pay someone not on the allowlist. The attempt would count as a strike.",
    });
    expect(await ask(research, 10_000n)).toMatchObject({
      tone: "blocked",
      detail: "This agent is paused.",
    });
  });

  it("reads the allowance the way the evaluator needs it", () => {
    expect(delegationFromView(market.allowance ?? ({} as never))).toMatchObject({
      kind: "recurring",
      amountPerPeriod: 5_000_000n,
      pulledInPeriod: 40_000n,
      periodLengthSecs: 86_400n,
    });
  });
});

describe("CSV export", () => {
  it("quotes every field and defuses spreadsheet formulas in untrusted text", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvField("-1+1")).toBe('"\'-1+1"');
    expect(csvField("@SUM(A1)")).toBe('"\'@SUM(A1)"');
  });

  it("writes one row per event under a header", async () => {
    const { items } = await source.events(DEMO_OWNER, { types: ["PaymentDenied"] });
    const overview = await source.overview(DEMO_OWNER);
    const lines = eventsToCsv(items, overview.names).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      '"time_utc","type","agent","counterparty","amount_usdc","summary","detail","memo","signature"',
    );
    expect(lines).toHaveLength(items.length + 1);
    expect(lines[1]).toContain('"Research Assistant"');
    expect(lines[1]).toContain('"25.00"');
  });
});
