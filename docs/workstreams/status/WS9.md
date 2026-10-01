# WS9 status: Integration, end-to-end tests and story

- Session branch: `claude/determined-faraday-9rk16e` (Parth's second Claude account, cloud)
- Last updated: 2026-10-01
- Current build step: 1 (narrative) done; next: the slide deck, then the rest of step 5's writing
- Messages handled: through `20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md`

## Done

- **Build step 1 (2026-10-01), approved by Parth with wording fixes:**
  - **`README.md` v1.** The first screen gives the name and tagline, links, the problem, what Leash does and a picture of the attack being stopped. Below it: the 60-second demo (with what is scripted), how it works, why Solana, what works today (Done / In progress / Planned), the security model, try it, the repo map, how it was built, the team (placeholder). WS0's "Run a local chain" section is kept under "Try it".
  - **`docs/pitch/deck.md` v1.** 13 slides, each with on-slide text, visual, speaker line and the judging criterion it serves. A sources table backs every number.
  - **`docs/pitch/img/`.** Three screenshots of the web app in fixture mode (overview, frozen agent, activity), 1280 px at 2× and light theme, from a production build driven by Chromium. They are labelled as sample data.
  - **Facts checked on Oct 1.** 767 automated tests: 639 TypeScript (`pnpm test`) and 128 Rust (CI's `cargo test`). Every relative link in both files resolves (scripted check).
- Messages sent: `20261001-1220-from-ws9-to-all-readme-v1-and-deck.md`.
- Found while checking the facts: CI on `main` was red at `b842f9f` (an indexer stream test hit Vitest's 5 s default on a loaded runner). `09ae03a` on `main` fixed it before WS9's message to WS4 went out, so that message was dropped.

## Rules for every claim

- Only what the status files and a test run show is "done"; everything else is "in progress".
- The scripted injection is "simulating a successful injection", as the demo screen says.
- Ramp: 70,000+ is Ramp's whole customer base; its agent wallets were a limited alpha.
- "On a real chain" means a local validator so far. On devnet, only the program is deployed until the laptop's devnet run.
- Test counts come from a fresh run, not from the status files.

## Next

1. **The slide deck** from `deck.md`: a `.pptx` built with Claude's slide tools, which Parth imports into Google Slides ("Anyone with the link: Viewer"), and a PDF export in `docs/pitch/` as the backup link.
2. `docs/pitch/demo-script.md` (second by second, with both paths for the owner's side: the web app, or `pnpm devnet:setup` / `owner:approve` / `owner:unfreeze`, and the "Before each take" checklist), `judge-qa.md`, `video-storyboard.md`.
3. When the in-progress items ship (web wallet actions, Telegram, the devnet run, recordings), move them to "done" in the README table and slide 9, and replace the screenshots with the devnet recording.

## Open items

- **From Parth:** team names and roles (README "Team", slides 1 and 13); any conversations with agent builders (slide 10 says "none yet" until then); the demo video link.
- The README's pitch link points at `deck.md` until the Google Slides link and the PDF exist.

## Questions for other workstreams

- WS6: will pairing, approve, freeze and unfreeze in the web app be ready for the devnet rehearsal on Oct 3? The demo script plans both paths either way.

## Contract changes proposed

- None.
