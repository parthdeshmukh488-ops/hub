import { DEFAULT_PORTS, formatUsdc, HealthResponseSchema } from "@leash/contracts";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda, getTokenDecoder } from "@solana-program/token";
import {
  fetchAgentView,
  fetchOpenRequests,
  fetchPayees,
  fetchPrincipalView,
  findAgentPda,
  findPrincipalPda,
  type LeashChain,
  readChainTime,
} from "../src/index.ts";

// The demo's preflight (`pnpm demo:check`): everything that would spoil a take of the storyline,
// checked before it starts. A take of the scripted storyline pays 0.07 USDC directly (three
// research calls at 0.01, two price checks at 0.02) and 1.50 USDC through an approved request,
// which skips the payee's period check (01 §7.1) but still uses the allowance.

export type CheckLevel = "ok" | "warn" | "fail";
export type Check = { name: string; level: CheckLevel; detail: string; fix?: string };

/** What one take needs: all its payments from the allowance, the direct ones from the payee budget. */
export const TAKE = { total: 1_570_000n, direct: 70_000n } as const;

export type ServiceUrls = {
  facilitator: string;
  /** A paid route: with payments on it answers 402. */
  merchantPaid: string;
  indexer: string;
  sentinel: string;
  web: string;
};

export const LOCAL_SERVICES: ServiceUrls = {
  facilitator: `http://localhost:${DEFAULT_PORTS.facilitator}/health`,
  merchantPaid: `http://localhost:${DEFAULT_PORTS.merchant}/api/research?q=preflight`,
  indexer: `http://localhost:${DEFAULT_PORTS.indexer}`,
  sentinel: `http://localhost:${DEFAULT_PORTS.sentinel}/health`,
  web: `http://localhost:${DEFAULT_PORTS.web}/app`,
};

export type ReadinessInput = {
  chain: LeashChain;
  cluster: "devnet" | "localnet";
  /** owner-demo's wallet. */
  owner: Address;
  /** The demo agent's key (`.keys/agent.json`). */
  agentKey: Address;
  /** The Research API's wallet, the allowlisted payee. */
  merchant: Address;
  mint: Address;
  /** Keys that pay fees, with the SOL each needs at least. */
  feePayers: { name: string; address: Address; minLamports: bigint }[];
  /** The HTTP checks; null skips them. */
  services: { fetch: typeof fetch; urls: ServiceUrls } | null;
  take?: { total: bigint; direct: bigint };
};

const sol = (lamports: bigint) => `${(Number(lamports) / 1e9).toFixed(3)} SOL`;
const usdc = (amount: bigint) => `${formatUsdc(amount)} USDC`;
const clock = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 19);

export async function checkReadiness(input: ReadinessInput): Promise<Check[]> {
  const take = input.take ?? TAKE;
  const flag = `--cluster ${input.cluster}`;
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  // Fees.
  const accounts = await input.chain.getAccounts(input.feePayers.map((k) => k.address));
  input.feePayers.forEach((key, i) => {
    const account = accounts[i];
    const lamports = account?.exists ? account.lamports : 0n;
    add({
      name: `${key.name} SOL`,
      level: lamports >= key.minLamports ? "ok" : "fail",
      detail: `${sol(lamports)} (needs ${sol(key.minLamports)})`,
      fix: "faucet.solana.com",
    });
  });

  // The owner's USDC, which every payment of a take comes from.
  const [mintAccount] = await input.chain.getAccounts([input.mint]);
  if (!mintAccount?.exists) {
    add({ name: "USDC mint", level: "fail", detail: `${input.mint} does not exist` });
    return checks;
  }
  const [ownerToken] = await findAssociatedTokenPda({
    owner: input.owner,
    mint: input.mint,
    tokenProgram: mintAccount.programAddress,
  });
  const [tokenAccount] = await input.chain.getAccounts([ownerToken]);
  const balance = tokenAccount?.exists ? getTokenDecoder().decode(tokenAccount.data).amount : 0n;
  add({
    name: "owner-demo USDC",
    level: balance >= take.total ? "ok" : "fail",
    detail: `${usdc(balance)} (a take pays ${usdc(take.total)})`,
    fix: "faucet.circle.com (devnet USDC to owner-demo)",
  });

  // The demo world: principal and agent, as the program will see them.
  const principalPda = await findPrincipalPda(input.owner);
  const agentPda = await findAgentPda(principalPda, input.agentKey);
  const now = Number(await readChainTime(input.chain));
  const principal = await fetchPrincipalView(input.chain, input.owner);
  const agent = await fetchAgentView(input.chain, agentPda, { now: BigInt(now) });
  if (!principal || !agent) {
    add({
      name: "demo world",
      level: "fail",
      detail: "the demo agent is not paired",
      fix: `pnpm devnet:setup ${flag}`,
    });
    return checks;
  }
  add({
    name: "all agents",
    level: principal.frozen ? "fail" : "ok",
    detail: principal.frozen ? "paused (freeze_principal)" : "not paused",
    fix: `pnpm owner:unfreeze ${flag}`,
  });
  add({
    name: "agent",
    level: agent.status === "frozen" ? "fail" : "ok",
    detail: agent.status === "frozen" ? `frozen (${agent.freezeReason})` : "active",
    fix: `pnpm owner:unfreeze ${flag}`,
  });
  const windowEnd =
    agent.stats.strikeWindowStart === null
      ? 0
      : agent.stats.strikeWindowStart + agent.policy.tripwireWindowSecs;
  const liveStrikes = agent.stats.strikes > 0 && now < windowEnd ? agent.stats.strikes : 0;
  add({
    name: "strikes",
    level: liveStrikes > 0 && agent.status !== "frozen" ? "fail" : "ok",
    detail:
      liveStrikes > 0
        ? `${liveStrikes} still count until ${clock(windowEnd)} UTC: the tripwire would fire early`
        : "none that count",
    fix: `pnpm owner:unfreeze ${flag} (it clears leftover strikes)`,
  });

  const remaining = BigInt(agent.allowance?.remaining ?? "0");
  add({
    name: "allowance",
    level: remaining >= take.total ? "ok" : "fail",
    detail: `${usdc(remaining)} left in this period (a take needs ${usdc(take.total)})`,
    fix: "wait for the next period, or raise the allowance",
  });

  const payees = await fetchPayees(input.chain, agentPda);
  const research = payees.find((p) => p.payee === input.merchant);
  if (!research) {
    add({
      name: "payee",
      level: "fail",
      detail: "the merchant is not on the allowlist",
      fix: `pnpm devnet:setup ${flag}`,
    });
  } else if (research.periodLimit !== "0") {
    const periodEnd = (research.periodStart ?? 0) + research.periodSecs;
    const spent =
      research.periodStart === null || now >= periodEnd ? 0n : BigInt(research.spentInPeriod);
    const left = BigInt(research.periodLimit) - spent;
    add({
      name: `${research.label || "payee"} budget`,
      level: left >= take.direct ? "ok" : "fail",
      detail: `${usdc(left)} left today (a take pays ${usdc(take.direct)} directly)`,
      fix: `wait until ${clock(periodEnd)} UTC, or raise the payee's period limit`,
    });
  }

  const open = await fetchOpenRequests(input.chain, agentPda);
  add({
    name: "open requests",
    level: open.length >= 8 ? "fail" : open.length > 0 ? "warn" : "ok",
    detail:
      open.length === 0
        ? "none"
        : `${open.length} left from earlier takes (the program allows 8): they crowd the approvals inbox`,
    fix: `pnpm owner:approve --reject ${flag} for pending ones; approved ones expire after an hour`,
  });

  if (input.services) await checkServices(input, agentPda, add);
  return checks;
}

async function checkServices(
  input: ReadinessInput,
  agentPda: Address,
  add: (check: Check) => void,
): Promise<void> {
  const { fetch: get, urls } = input.services as NonNullable<ReadinessInput["services"]>;
  const probe = async (url: string): Promise<Response | null> => {
    try {
      return await get(url, { signal: AbortSignal.timeout(3_000) });
    } catch {
      return null;
    }
  };
  const up = (name: string, response: Response | null, fix: string) =>
    add({
      name,
      level: response?.ok ? "ok" : "fail",
      detail: response ? `HTTP ${response.status}` : "not reachable",
      fix,
    });

  up("facilitator", await probe(urls.facilitator), "pnpm --filter @leash/facilitator start");

  const paid = await probe(urls.merchantPaid);
  add({
    name: "merchant",
    level: paid?.status === 402 ? "ok" : "fail",
    detail: !paid
      ? "not reachable"
      : paid.status === 402
        ? "paid routes answer 402: payments are on"
        : `a paid route answered HTTP ${paid.status}: payments are off`,
    fix: "MERCHANT_PAYMENTS=on pnpm --filter @leash/merchant-demo start",
  });

  const health = await probe(`${urls.indexer}/v1/health`);
  const parsed = health?.ok ? HealthResponseSchema.safeParse(await health.json()) : null;
  const healthy = parsed?.success && parsed.data.ok && parsed.data.cluster === input.cluster;
  add({
    name: "indexer",
    level: healthy ? "ok" : "fail",
    detail: !health
      ? "not reachable"
      : !parsed?.success
        ? `HTTP ${health.status}, but not the indexer's /v1/health`
        : parsed.data.cluster !== input.cluster
          ? `follows ${parsed.data.cluster}, not ${input.cluster}`
          : parsed.data.ok
            ? `healthy, ${parsed.data.lagSeconds ?? "?"} s behind`
            : "says it cannot make progress",
    fix: `LEASH_CLUSTER=${input.cluster} INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start`,
  });
  if (healthy) {
    const overview = await probe(`${urls.indexer}/v1/owners/${input.owner}`);
    const body = overview?.ok
      ? ((await overview.json()) as { agents?: { address: string }[] })
      : null;
    const known = body?.agents?.some((a) => a.address === agentPda) ?? false;
    add({
      name: "indexer sees the agent",
      level: known ? "ok" : "fail",
      detail: known ? "the control panel will show it" : "the owner's overview lacks the agent",
      fix: "restart the indexer: its start snapshot reads every account",
    });
  }

  up(
    "sentinel",
    await probe(urls.sentinel),
    "SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json pnpm --filter @leash/sentinel start",
  );
  up(
    "web app",
    await probe(urls.web),
    `NEXT_PUBLIC_DATA_SOURCE=indexer NEXT_PUBLIC_LEASH_CLUSTER=${input.cluster} pnpm --filter @leash/web dev`,
  );
}
