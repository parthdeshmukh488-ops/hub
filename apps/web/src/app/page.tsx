import { PROGRAM_IDS } from "@leash/contracts";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CircleCheck,
  Hourglass,
  type LucideIcon,
  Snowflake,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

// The landing page (WS6 build step 5): for judges and visitors. Static text only; the live data
// is in the app. Every status colour comes with an icon and a word (04-conventions §8).

export const metadata: Metadata = {
  title: { absolute: "Leash: spending limits and an off switch for AI agents" },
};

const REPO_URL = "https://github.com/parthdeshmukh488-ops/hub";
const PROGRAM_URL = `https://explorer.solana.com/address/${PROGRAM_IDS.leash}?cluster=devnet`;

type Beat = { icon: LucideIcon; tone: string; label: string; title: string; body: string };

const STORY: Beat[] = [
  {
    icon: CircleCheck,
    tone: "text-ok bg-ok-soft",
    label: "Paid",
    title: "Normal work",
    body: "A research agent with 5 USDC a day pays an allowlisted research API a cent or two per call, over x402. Every payment is an on-chain event.",
  },
  {
    icon: Hourglass,
    tone: "text-approval bg-approval-soft",
    label: "Waiting for you",
    title: "Above the limit, it asks",
    body: "A 1.50 USDC report is above its 1 USDC instant limit, so the agent asks. You approve with one signature, and that exact payment goes through.",
  },
  {
    icon: Ban,
    tone: "text-blocked bg-blocked-soft",
    label: "Blocked",
    title: "The attack",
    body: "A buying guide hides an instruction to tip a stranger 25 USDC. The fooled agent tries: blocked, payee not allowed, strike 1. Strike 2. Strike 3.",
  },
  {
    icon: Snowflake,
    tone: "text-frozen bg-frozen-soft",
    label: "Frozen",
    title: "It freezes itself",
    body: "Three strikes and the agent freezes itself, on-chain, and Sentinel alerts you. The attacker got nothing, and only you can unfreeze it.",
  },
];

const STEPS = [
  {
    title: "You set a budget",
    body: "You give the agent an allowance in Solana's official, audited Allowances program. That is the most it can ever spend; your money stays in your wallet.",
  },
  {
    title: "Leash checks every payment",
    body: "The Leash program decides on-chain: allowlisted payees only, within per-payment, per-payee and rate limits, with your approval above a threshold, never while frozen.",
  },
  {
    title: "Blocked attempts become strikes",
    body: "Every blocked attempt is recorded on-chain. After three, the agent freezes itself. You, or a guardian, can freeze any agent in one transaction.",
  },
];

const WHY_SOLANA = [
  "Paying per API call only works with sub-cent fees and fast settlement, and most x402 agent payments already run on Solana.",
  "The rules live on-chain, where the money is: no prompt can change them, and a frozen agent is frozen for everyone from the next slot.",
  "Built from Solana's own parts: the Foundation's audited Allowances program sets the ceiling, and the x402 standard carries the payment.",
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-10">
      <h2 id={id} className="text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const linkClass =
  "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-lg bg-surface px-3 py-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-lg bg-brand text-canvas"
            >
              L
            </span>
            Leash
          </span>
          <nav aria-label="Site" className="flex gap-4 text-sm">
            <Link href="/app" className="underline-offset-4 hover:underline">
              Control panel
            </Link>
            <a href={REPO_URL} className="underline-offset-4 hover:underline">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-4">
        <div className="py-14">
          <p className="text-sm font-semibold text-brand">A spending firewall for AI agents</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Spending limits and an off switch for AI agents, enforced on Solana.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-fg-muted">
            Give your agent a budget, not your wallet. Leash checks every payment on-chain, and an
            agent that keeps trying to break the rules freezes itself.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className={`${linkClass} bg-brand text-canvas hover:opacity-90`}>
              Open the control panel
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <a
              href={REPO_URL}
              className={`${linkClass} border border-line bg-surface hover:bg-surface-2`}
            >
              Read the code on GitHub
            </a>
          </div>
          <p className="mt-4 text-sm text-fg-muted">
            The control panel opens with sample data from the demo story.
          </p>
        </div>

        <Section id="story" title="The 60-second story">
          <ol className="grid gap-4 sm:grid-cols-2">
            {STORY.map((beat, index) => (
              <li key={beat.title} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-fg-muted">{index + 1}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${beat.tone}`}
                  >
                    <beat.icon aria-hidden="true" className="size-3.5" />
                    {beat.label}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold">{beat.title}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{beat.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-2xl border border-line bg-surface p-5 text-lg font-semibold">
            The model was fooled. The money wasn't moved.
          </p>
        </Section>

        <Section id="how" title="How it works">
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-line bg-surface p-5">
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full bg-brand text-sm font-bold text-canvas"
                >
                  {index + 1}
                </span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="why-solana" title="Why Solana">
          <ul className="grid gap-3">
            {WHY_SOLANA.map((reason) => (
              <li key={reason} className="flex gap-3">
                <BadgeCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="links" title="See it for yourself">
          <ul className="grid gap-3 sm:grid-cols-3">
            <li>
              <Link
                href="/app"
                className="block h-full rounded-2xl border border-line bg-surface p-5 hover:bg-surface-2"
              >
                <span className="font-semibold">The control panel</span>
                <span className="mt-1 block text-sm text-fg-muted">
                  Agents, payments, blocked attempts and approvals.
                </span>
              </Link>
            </li>
            <li>
              <a
                href={REPO_URL}
                className="block h-full rounded-2xl border border-line bg-surface p-5 hover:bg-surface-2"
              >
                <span className="font-semibold">The code</span>
                <span className="mt-1 block text-sm text-fg-muted">
                  Open source. <code className="font-mono">pnpm demo</code> plays the whole story in
                  one command.
                </span>
              </a>
            </li>
            <li>
              <a
                href={PROGRAM_URL}
                className="block h-full rounded-2xl border border-line bg-surface p-5 hover:bg-surface-2"
              >
                <span className="font-semibold">The program on devnet</span>
                <span className="mt-1 block text-sm text-fg-muted">
                  The Leash program in Solana Explorer.
                </span>
              </a>
            </li>
          </ul>
        </Section>
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto max-w-4xl px-4 py-6 text-sm text-fg-muted">
          Built for the Superteam Germany Solana Challenge at WHU, October 2026. Devnet only. MIT
          licensed.
        </p>
      </footer>
    </>
  );
}
