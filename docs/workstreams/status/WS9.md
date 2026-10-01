# WS9 status: Integration, end-to-end tests and story

- Session branch: `claude/determined-faraday-9rk16e` (Parth's second Claude account, cloud)
- Last updated: 2026-10-01
- Current build step: 1 (narrative). The plan below waits for Parth's OK.
- Messages handled: through `20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md`

## Plan for build step 1

Scope this round ([message 20261001-0400](../messages/20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md)): `README.md` v1 and `docs/pitch/deck.md` v1, then `demo-script.md`, `judge-qa.md` and `video-storyboard.md`, then the slide deck for the submission link. No e2e harness this round: it needs a validator.

Rules for every claim:
- Only what the status files and a test run show is "done"; everything else is "in progress".
- The scripted injection is "simulating a successful injection", as the demo screen says.
- Ramp: 70,000+ is Ramp's whole customer base; its agent wallets were a limited alpha.
- "On a real chain" means a local validator so far. On devnet, only the program is deployed until the laptop's devnet run.
- Test counts come from a fresh run on the day of writing, not from the status files (they drift).

1. **README v1.** First screen: name and tagline, links (deck, video, devnet program), the problem in two sentences, what Leash does in five bullets, one picture of the attack being stopped. Below it: the 60-second story, how it works, why Solana, what works today and what is in progress, the security model, "try it" (tests without a chain, the local demo, the MCP server in Claude Code), the repo map, the team.
2. **`docs/pitch/deck.md` v1, 13 slides:** title · problem · why now · solution · how it works · demo · why Solana · trust (what can still go wrong) · working today · first users and market · business model · roadmap · team and close.
3. **Pictures:** screenshots of the web app replaying the storyline (fixture mode, Chromium in the cloud), labelled as sample data, until the laptop records the devnet run.

## Done
- Read the starter prompt's documents; `pnpm check` passes on this branch's base (36 tasks).

## Next
- After Parth's OK: README v1 and `deck.md` v1, then a pull request into `main`.
- Then `demo-script.md`, `judge-qa.md`, `video-storyboard.md`; then the slide deck.

## Open items
- From Parth: team names and roles, the business model, any conversations with agent builders, the slide tool.
- Storyline steps 1 (pairing in the web app), 3 (Telegram and one-tap approval) and 5 (unfreeze in the web app) depend on WS6 step 2 and WS5. Until they ship, the demo script uses `pnpm devnet:setup`, `pnpm owner:approve` and `pnpm owner:unfreeze`.

## Questions for other workstreams
- None yet.

## Contract changes proposed
- None.
