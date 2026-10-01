---
from: architect (cloud session 1)
to: Parth's second Claude account (all its sessions)
date: 2026-10-01 12:00 UTC
subject: the work queue for the second account: five tasks, ordered by value per dollar
---

The second account has about $88 of credits left. This queue spends them on work that moves the judging criteria, in this order. Each task is independent, ships on its own branch, and is worth merging even if the credits run out after it. Session 1 builds WS6 step 2 (wallet, pairing, approve, freeze in the web app) at the same time; the lanes below never overlap with it.

| # | Task | Lane (paths it may edit) | Judging criterion | Starter prompt |
| --- | --- | --- | --- | --- |
| 1 | **B. WS9 story** (running now): README v1, `docs/pitch/` (deck, demo script, judge Q&A, storyboard), the `.pptx` and a PDF | `README.md`, `docs/pitch/`, `status/WS9.md` | all four; required for submission | [0400 message](20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md) |
| 2 | **A. WS5 Sentinel**: alert rules, the indexer stream, Telegram (@LeashmvpBot), and now **also step 4**, guardian autofreeze | `services/sentinel/`, `status/WS5.md` | working prototype: the phone buzzes | [0400 message](20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md) |
| 3 | **C. Solana Actions (Blinks)**: approve, reject, freeze and freeze-all as Actions (02 §10), so a Telegram alert approves in one tap | `apps/web/src/app/api/actions/**`, `apps/web/src/app/actions.json/**`, `apps/web/src/server/actions/**`, `apps/web/test/actions*.test.ts`, `status/WS6-actions.md` | clear role for Solana | below |
| 4 | **D. Whole-system proof**: the pitch storyline in one test on LiteSVM (agent → x402 → program → indexer → Sentinel), plus the "security" CI job of 03-security §3 | `e2e/`, the new job in `.github/workflows/ci.yml`, `status/WS9.md` | working prototype, trust | below |
| 5 | **E. Indexer robustness** (only if credits remain): account snapshot at start, stats on chain data | `services/indexer/`, `status/WS4.md` | working prototype | below |

**How to spend the credits well:**
- **One fresh session per task, or per build step:** a long conversation costs more for every message.
- **Plan first:** each session proposes a plan and waits for an OK; say no to anything outside its lane.
- **Test narrowly:** each runs only its own package's tests while working, and `pnpm check` once before its last push.
- **When credits run low:** finish the current step, update the status file, and push. A half-done step on a branch is still useful; an unpushed one is lost.
- **Parallel or one after another:** two sessions at once (for example B and A) cost the same as one after the other, but finish sooner.
- **Merging:** open a pull request into `main` when a task's tests pass, and merge once CI is green.

## Task A, amended: step 4 is now in scope

After steps 1, 2, 3 and 5, do step 4 of [WS5-sentinel.md](../WS5-sentinel.md): guardian freezes through the SDK (`buildFreezeAgent`, `buildFreezePrincipal`), signed with `SENTINEL_GUARDIAN_KEYPAIR`.
- **Two conditions, both required:** `SENTINEL_AUTOFREEZE=true`, and the principal's on-chain guardian equals Sentinel's key.
- **Tests on the LiteSVM testbed** (`@leash/sdk/testing`, whose guardian key is `keys.guardian`):
  - a burst of denials freezes the principal;
  - with autofreeze off, no transaction is ever sent;
  - a principal whose guardian is someone else is never touched.

## Task C: Solana Actions (Blinks)

The spec is 02 §10; the types and constants are already in `packages/contracts/src/actions.ts` (`ACTION_ROUTES`, `ActionQuerySchemas`, `ACTIONS_CORS_HEADERS`, `ACTIONS_JSON`, the GET/POST schemas). Sentinel's alerts and the web app link to these routes; Blink-capable wallets render them.

- **What each route does:**
  - **GET** returns `{ type: "action", icon, title, description, label }`, described from the chain. Approve says "Approve 1.50 USDC to Research API".
  - **POST** `{ account }` returns an **unsigned** v0 transaction:
    - fee payer `account`, recent blockhash from the RPC, built with the SDK's builders;
    - for approve and reject, the agent, owner and rent payer are read from the request account.
- **Never sign on the server** (invariant I6). Use kit's `createNoopSigner(account)` where a builder wants a signer.
- **Chain access** only through `@leash/sdk` (`rpcChain` on `LEASH_RPC_URL`), injectable, so tests use the LiteSVM testbed.
- **Headers on every response:** `ACTIONS_CORS_HEADERS`, `X-Action-Version` (find the current Actions spec version in the `@solana/actions` package metadata on npm, without depending on it: it pulls in web3.js v1), and `X-Blockchain-Ids`.
- **Done when:** for each of the four actions, the test signs the returned transaction with the right key, and it succeeds on the real program in LiteSVM. With a wrong signer (for example the guardian approving) it fails on-chain. Bad input gets a 400 in the Actions error shape, and `/actions.json` serves `ACTIONS_JSON`.

```text
You are building Leash's Solana Actions (Blinks), a carved-out part of WS6 (web app), on Leash, a spending firewall for AI agents on Solana. Work on the branch this session was created with; merge the latest main into it first.

Read:
- CLAUDE.md;
- docs/workstreams/messages/20261001-1200-from-architect-to-second-account-work-queue.md (your scope, Task C);
- docs/architecture/02-contracts.md §10 (your contract) and §13;
- packages/contracts/src/actions.ts (use its types and constants, never redefine them);
- docs/architecture/01-onchain-program.md §6.1 (who may sign what);
- docs/architecture/03-security.md (I6: the server never holds a key that can move funds);
- apps/web/README.md and apps/web/AGENTS.md;
- the SDK's owner builders (packages/sdk/src/owner.ts) and testbed (packages/sdk/src/testing).

Build the four Actions (freeze, freeze-all, approve, reject) as Next.js route handlers under apps/web/src/app/api/actions/, plus /actions.json, with the CORS, X-Action-Version and X-Blockchain-Ids headers.
- GET returns the action, described from the chain.
- POST { account } returns an unsigned v0 transaction built with the SDK builders.
- The server never signs.
- Read the chain only through @leash/sdk, with the chain injectable so tests run on the LiteSVM testbed.

Tests in apps/web/test/actions.test.ts:
- Call the route handlers with Request objects.
- For each action, sign the returned transaction with the right key and send it on the testbed: it must succeed. With a wrong key it must fail on-chain.
- Bad input answers 400.

Tell me your plan first and wait for my OK.

Rules:
- Only edit apps/web/src/app/api/actions/**, apps/web/src/app/actions.json/**, apps/web/src/server/actions/**, apps/web/test/actions*.test.ts, and docs/workstreams/status/WS6-actions.md (create it). Session 1 is editing the rest of apps/web at the same time.
- A new dependency in apps/web/package.json is fine; note it in your status file.
- Never commit keys. This cloud cannot reach Solana RPC: test on LiteSVM.
- End every work block by updating your status file, committing, and pushing.
```

## Task D: the whole system in one test, and the security CI job

WS9 build steps 2–3, adapted to the cloud: a validator isn't available here, LiteSVM is.

**One suite in `e2e/` runs the pitch storyline in process, with no network.** The pieces:
- the SDK testbed (the real `leash.so` and `subscriptions.so`);
- `litesvmFacilitatorClient` (the official x402 facilitator);
- merchant-demo with payments on (`@leash/merchant-demo/server`, lab included);
- the demo agent's `runDemo` in scripted mode, with the test approving as the owner, the way `apps/agent-demo/test/demo.test.ts` does;
- the indexer in chain mode over the same LiteSVM chain (`createChainSource`, `Store`, its Hono app in process);
- Sentinel's rules with the console notifier, if `services/sentinel` exists by then.

**Assert per scene:**
- the on-chain balances;
- the indexer's API: owner overview; the events feed with the payments, the denials with their strikes, and `AgentFrozen` by the tripwire;
- the alerts: `approval_requested` and `tripwire_fired`.

**Then the "security" CI job (03-security §3):** one job that runs the named invariant tests across workstreams, so the pitch can say "these run on every commit".

```text
You are the WS9 engineer for Leash's end-to-end proof, on Leash, a spending firewall for AI agents on Solana. Work on the branch this session was created with; merge the latest main into it first.

Read:
- CLAUDE.md;
- docs/workstreams/messages/20261001-1200-from-architect-to-second-account-work-queue.md (your scope, Task D);
- docs/workstreams/WS9-integration-story.md (build steps 2–3);
- docs/architecture/03-security.md §3 (the invariant tests);
- the READMEs of apps/agent-demo, services/indexer, apps/merchant-demo, packages/x402 and, if it exists, services/sentinel;
- apps/agent-demo/test/demo.test.ts and helpers.ts, the closest existing example.

Build in e2e/ one Vitest suite that runs the whole pitch storyline in process on LiteSVM, with no network:
- the SDK testbed;
- the official x402 facilitator via litesvmFacilitatorClient;
- merchant-demo with payments on;
- the demo agent's runDemo in scripted mode;
- the indexer in chain mode over the same chain (its Store and HTTP API in process);
- Sentinel's rules with the console notifier, if services/sentinel exists.

For each scene, assert the on-chain balances, the indexer's API (owner overview, events feed: payments, denials with strikes, AgentFrozen), and the alerts.

Then add the "security" CI job of 03-security §3 to .github/workflows/ci.yml: one job that runs the named invariant tests.

Tell me your plan first and wait for my OK.

Rules:
- Only edit e2e/, the new job in .github/workflows/ci.yml, and docs/workstreams/status/WS9.md.
- You may add an "exports" entry to another package's package.json to import it; note it in your status file.
- Never commit keys.
- End every work block by updating your status file, committing, and pushing.
```

## Task E (only if credits remain): indexer robustness

WS4 build steps 3–4.
- **An account snapshot at start, and on demand:** every principal, agent, allowlist entry and open request, through `getProgramAccounts` with the SDK's reads. It overwrites the projections ("accounts give truth"). Then a first start whose backfill misses older history still has owners.
- **Stats checked on chain-mode data.**
- **`/v1/health`:** says honestly when the source cannot make progress.

```text
You are the WS4 (indexer) engineer on Leash, a spending firewall for AI agents on Solana. Work on the branch this session was created with; merge the latest main into it first.

Read:
- CLAUDE.md;
- docs/workstreams/WS4-indexer.md (steps 3–4);
- docs/workstreams/status/WS4.md (open items);
- services/indexer/README.md and src/sources/chain.ts;
- docs/workstreams/messages/20261001-1200-from-architect-to-second-account-work-queue.md (Task E).

Add the account snapshot (getProgramAccounts through the SDK's reads, overwriting the projections) at start and on demand. Verify the stats on chain-mode data with the LiteSVM tests in test/chain.test.ts. Make /v1/health report a source that cannot make progress.

Tell me your plan first and wait for my OK.

Rules:
- Only edit services/indexer and docs/workstreams/status/WS4.md.
- End every work block by updating your status file, committing, and pushing.
```
