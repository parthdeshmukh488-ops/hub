---
from: architect (cloud session 1, branch claude/whu-hackathon-ideas-lz8trx)
to: ws5, ws9 (Parth's second Claude account, GitHub deshmukhparth921-commits)
date: 2026-10-01 04:00 UTC
subject: tasks for the second Claude account: Sentinel alerts (WS5) and the story (WS9)
---

Parth now has a second Claude account (GitHub `deshmukhparth921-commits`, write access) with $100 of credits. It takes the two workstreams that nothing else touches:
- **Task A, WS5 Sentinel:** the phone that buzzes in the demo.
- **Task B, WS9:** the README and the pitch.

Cloud session 1 keeps building the product next: WS6 step 2 (wallet, pairing, approve, freeze in the web app). The laptop session runs everything that needs a real chain.

## For Parth: how to start a task

1. Open Claude Code on the web with the second account, on `parthdeshmukh488-ops/hub`.
2. **One session per task.** Paste the task's starter prompt (below). It names the branch and the scope.
3. The session reads the docs and proposes a plan. Approve it (or steer); it builds, commits and pushes to its branch.
4. When a build step is done, open a pull request from its branch into `main`, and merge once CI is green.

**To make $100 go far:**
- Start a fresh session for each build step, not one long conversation.
- Let it run only its own package's tests (`pnpm --filter @leash/sentinel test`), and the whole `pnpm check` only before the last push.
- Say no to scope creep.

## Task A: WS5 Sentinel, Telegram alerts (priority 1)

**Why:** storyline steps 3 and 4. When the agent asks for approval, and when the tripwire freezes it, the owner's phone buzzes.

**Scope this round:** build steps 1, 2, 3 and 5 of [WS5-sentinel.md](../WS5-sentinel.md):
1. The rules engine as pure functions, tested on the storyline fixture.
2. The stream client and console notifier, end to end against the indexer.
3. The Telegram notifier, tested with a fake bot API.
5. The README.

Step 4 (guardian autofreeze) comes only after Parth says so.

**Ready to use:**
- **The indexer:**
  - Fixture mode: `INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start`. It replays the whole demo storyline with no chain.
  - Chain mode works too (the laptop has tested it).
  - API: REST, `GET /v1/guardians/:guardian/owners`, and the `/v1/stream` WebSocket (`StreamServerMessageSchema`; `subscribe` per owner, `ping`/`pong`, `?after=` to fill gaps). See [services/indexer/README.md](../../../services/indexer/README.md).
- **The contracts:** the `Alert` type (02 §12) and every event schema, from `@leash/contracts`.
- **Web app links for alerts:** `/app/agents/<agent>` and `/app/approvals`, under `SENTINEL_WEB_URL`. Approving from the web app is being built by session 1. Until then the owner approves with `pnpm owner:approve`. Solana Action (Blink) URLs (02 §10) aren't built yet: leave them out, or behind a flag.
- **For step 4 later:** the SDK's guardian builders (`buildFreezeAgent`, `buildFreezePrincipal`) and the LiteSVM testbed (`@leash/sdk/testing`), so guardian actions can be tested with no chain.

**Telegram:**
- **The demo bot exists: [@LeashmvpBot](https://t.me/LeashmvpBot)** (created by Parth on 2026-10-01). Its token came from @BotFather and is `TELEGRAM_BOT_TOKEN`. It lives only in Parth's local `.env`: never paste it in a chat, a commit or a log. If it leaks, revoke it with BotFather's `/revoke`.
- Parth sends `/start` to @LeashmvpBot and reads `chat.id` from `https://api.telegram.org/bot<token>/getUpdates`. That gives `TELEGRAM_CHAT_ID`.
- Both go in a local `.env`, never in git.
- The cloud may not reach Telegram (or Solana RPC): test with fakes, and the laptop sends the real messages.

**Done when** (brief's definition):
- Replaying the storyline yields exactly the expected alerts (a snapshot test).
- With autofreeze off, Sentinel never sends a transaction.
- No label or memo can inject Telegram markup (tested).

**Branch:** `ws5/sentinel`.

```text
You are the WS5 (Sentinel and alerts) engineer on Leash, a spending firewall for AI agents on Solana. Work on the branch ws5/sentinel: create it from the latest main, or merge the latest main into it if it exists.

Before anything else, read CLAUDE.md, docs/workstreams/WS5-sentinel.md and every document its "Read first" section lists, docs/workstreams/status/WS5.md, docs/workstreams/BOARD.md, and the messages in docs/workstreams/messages/ addressed to ws5 or to all. Start with 20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md: it sets your scope.

This round: build steps 1, 2, 3 and 5 of the brief. That is the rules engine, the stream client with the console notifier against the indexer's fixture mode, the Telegram notifier tested with a fake bot API, and the README. Step 4 (guardian autofreeze) waits for my OK.

Tell me in a short message your plan for build step 1 and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules:
- Only edit services/sentinel and docs/workstreams/status/WS5.md.
- Follow docs/architecture/04-conventions.md. Contract changes go through an ADR.
- This cloud can't reach Solana RPC and may not reach Telegram: test with fakes.
- Never commit tokens or .env files.
- End every work block by updating your status file, committing, and pushing to ws5/sentinel.
```

## Task B: WS9, the story judges read (priority 2, in parallel)

**Why:** the submission needs a pitch-deck link that anyone can view, a working prototype, and a public repo whose README a judge understands in one screen ([hackathon-brief.md](../../hackathon-brief.md)).

**Scope this round:** build step 1 of [WS9-integration-story.md](../WS9-integration-story.md), then the writing parts of step 5. Deliverables:
- The root `README.md` v1;
- `docs/pitch/deck.md` (slide by slide);
- `docs/pitch/demo-script.md` (second by second, with a fallback for every failure);
- `docs/pitch/judge-qa.md`;
- `docs/pitch/video-storyboard.md`.

Then the actual slide deck for the submission link, built from `deck.md` with Claude's slide tools, or in Google Slides; Parth picks.

**Out of scope this round:** the e2e harness, `preflight.ts` and the devnet rehearsal (steps 2–4). They need a validator, which the cloud doesn't have.

**Use only real facts.** Read every `docs/workstreams/status/*.md`; they say what is built and tested.
- **Facts you can cite:**
  - The program is live on devnet (`HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`).
  - x402 payments go through the unmodified official facilitator.
  - Claude Code connects to the MCP server.
  - The scripted storyline and the indexer have passed on a real validator.
  - The test counts are in each status file.
- **Not built yet:** web writes, Telegram, the devnet run, the recording. Call them "in progress", never "done".

**Honesty:** in the scripted demo, the injection is "simulating a successful injection", and the screen says so. The deck and the script must say it too. The punchline still holds: the policy stops the payment whatever the model decides.

**Branch:** `ws9/story`.

```text
You are the WS9 (Integration, end-to-end tests and story) engineer on Leash, a spending firewall for AI agents on Solana. Work on the branch ws9/story: create it from the latest main, or merge the latest main into it if it exists.

Before anything else, read:
- CLAUDE.md and docs/architecture/00-overview.md;
- docs/architecture/03-security.md, §6 first;
- docs/hackathon-brief.md and docs/workstreams/WS9-integration-story.md;
- every file in docs/workstreams/status/ (they say what is really built and tested);
- docs/workstreams/BOARD.md;
- the messages in docs/workstreams/messages/ addressed to ws9 or to all. Start with 20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md: it sets your scope.

Read docs/context/transcript.md only for the judging criteria and the chosen idea; it is long.

This round: build step 1 (README.md v1, docs/pitch/deck.md v1), then demo-script.md, judge-qa.md and video-storyboard.md. No e2e harness yet.

Tell me in a short message your outline for the README's first screen and the deck's slides, and anything in the docs that looks inconsistent. Wait for my OK before writing.

Rules:
- Only edit README.md, docs/pitch/ and docs/workstreams/status/WS9.md.
- Claim only what the status files show as done; label the rest "in progress".
- End every work block by updating your status file, committing, and pushing to ws9/story.
```

## Optional Task C (only if credits remain): WS9 security CI job

One CI job that runs the invariant tests of every workstream (03-security §3), named so the pitch can point at it. It touches `.github/workflows/`. Agree the change with cloud session 1 first, through a message.
