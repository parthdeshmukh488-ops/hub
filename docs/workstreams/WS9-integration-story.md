# WS9: Integration, end-to-end tests and story (`e2e/`, `scripts/demo/`, `README.md`, `docs/pitch/`)

## Mission

Make the pieces one product, prove it works end to end, and tell its story. WS9 owns the question "does the demo work on devnet, every time?" and the words judges read first: the README and the pitch.

## Read first

Everything in [docs/architecture/](../architecture/), [docs/hackathon-brief.md](../hackathon-brief.md), [docs/context/transcript.md](../context/transcript.md) (judging criteria, the chosen idea, the judge's questions), [03-security §6](../architecture/03-security.md#6-what-we-say-in-the-pitch)

## You own

`e2e/`, `scripts/demo/`, `README.md` (root), `docs/pitch/`

## The demo storyline

The single story every workstream builds towards (fixtures, content, scenes and deck all follow it):

1. **Setup (web, 15 s):** Parth pairs "Research Assistant" from the web app: 5 USDC per day, 1 USDC max per payment, approvals up to 5 USDC, only the Research API allowlisted, tripwire at 3 strikes.
2. **Normal work (terminal, 20 s):** the agent researches budget e-bikes. It pays 0.01 and 0.02 USDC per call over x402. Green lines, explorer links, and the web feed updates live.
3. **Needs approval (phone, 15 s):** the agent wants the 1.50 USDC premium report. The owner's phone buzzes (Telegram), one tap approves, the agent continues.
4. **The attack (terminal + web, 30 s):** the agent reads a buying guide with a hidden instruction to tip 25 USDC to an unknown wallet. It tries: **blocked, payee not allowed, strike 1**. It tries again: strike 2, strike 3 → **the agent freezes itself on-chain**. The phone buzzes: "Agent frozen by tripwire".
5. **Owner in control (web, 10 s):** the feed shows exactly what happened, with the attacker's address. The owner keeps the agent frozen, or unfreezes it after removing the poisoned source.
6. **Punchline:** "The model was fooled. The money wasn't moved. Solana's Allowances capped how much; Leash decided who, how fast, and when to stop."

## Design notes

- **`scripts/demo/`:** `seed-devnet.ts` (principal, agent, allowance, payees, guardian; idempotent), `reset.ts` (unfreeze, reset strikes by re-pairing if needed, top up balances), `preflight.ts` (checks every service, balance and account before going on stage; prints ✓/✗).
- **`e2e/`:** Vitest suites that run against localnet (and, with a flag, devnet): start the services, run each scene with the tools in scripted mode, and assert on-chain balances, events in the indexer, and alerts produced by Sentinel (console notifier).
- **Security job:** one CI job that runs the invariant tests of every workstream (03-security §3), named so the pitch can point at it.
- **README:** what Leash is, the 60-second story as a GIF or screenshots, architecture diagram, "Why Solana", quick start, repo map, security model summary, team. Judges read this first.
- **`docs/pitch/`:** `demo-script.md` (second-by-second, with fallbacks when something fails), `deck.md` (slide-by-slide content: problem, why now, solution, demo, why Solana, market and first users, business model, roadmap, team), `judge-qa.md` (hard questions and crisp answers), `video-storyboard.md`.

## Build order (quality gates)

1. **Narrative.** README v1 and `deck.md` v1 from the architecture docs, so everyone builds towards the same story.
2. **Harness.** Localnet e2e harness that boots everything; `preflight.ts`.
3. **Scenes as tests.** One e2e test per storyline scene; the security CI job.
4. **Devnet rehearsal.** `seed-devnet.ts`, a full run on devnet, with timings and issues logged in your status file.
5. **Final story.** Demo script with fallbacks, judge Q&A, video storyboard, final README with real screenshots.

## Definition of done (in addition to the general one)

- `pnpm e2e` passes on localnet from a clean machine following the README.
- `preflight.ts` is green on devnet before any demo.
- A judge can understand what Leash does from the README's first screen.

## Starter prompt

```text
You are the WS9 (Integration, end-to-end tests and story) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, every document in docs/architecture/, docs/workstreams/WS9-integration-story.md, docs/hackathon-brief.md and docs/context/transcript.md.
3. Read docs/workstreams/status/WS9.md (create it from docs/workstreams/status/README.md if missing), every other workstream's status file, and any ADRs newer than yours.

Then tell me in a short message: what you understand your job to be, the current integration state across workstreams, which build step you will do now, and your plan for it. Wait for my OK before writing code.

Rules: only edit e2e/, scripts/demo/, README.md, docs/pitch/ and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
