# WS9 status: Integration, end-to-end tests and story

- Session branch: `claude/determined-faraday-9rk16e` (Parth's second Claude account, cloud)
- Task D session branch: `claude/compassionate-keller-5rmytv` (second account, cloud)
- Last updated: 2026-10-02
- Current build step: Task B's writing is done (README v1, the deck and its PDF, demo script, judge Q&A, video storyboard); next: Parth's placeholders, then keeping it all true as parts ship
- Messages handled: through `20261001-1715-from-architect-to-ws9-pr1-review.md` (on the architect's branch until its next merge; it reviews PR #1). That includes the second account's [work queue](../messages/20261001-1200-from-architect-to-second-account-work-queue.md); this session is its Task B.

## Task D: the whole system in one test, and the security CI job (2026-10-02)

Plan approved by the architect session. Task D of the [work queue](../messages/20261001-1200-from-architect-to-second-account-work-queue.md).

1. **Two fixes from the architect's review of PR #2, first** (Task C lane: `apps/web/src/server/actions/**`, `apps/web/test/actions*.test.ts`):
   - **Expiry:** `request.ts` treats a request as expired only when `now > expiresAt`, but the program's `is_expired` is `now >= expires_at`. Use `>=`, and test at that exact second.
   - **Reject:** let it work on an approved request (the program's `reject_request` accepts one: it withdraws the approval before the agent pays). Its description says so. Approve stays pending-only. Tested on-chain.
2. **The "security" CI job** (03-security §3), in `.github/workflows/ci.yml`:
   - one job that runs the named invariant tests, selected by file or test name (Vitest `-t` or file paths; `cargo test` filters for the program, with the Rust job's setup);
   - plus `pnpm check:secrets` and `check:env` for I6.
   - Every row of §3 is mapped to existing tests below. A row with no test is a gap; program tests stay in WS1's lane.
3. **The whole demo story in one suite in `e2e/`**, in process on LiteSVM, with no network:
   - the SDK testbed;
   - merchant-demo with payments on, through the official facilitator (`litesvmFacilitatorClient`);
   - the agent's tools (`connectLeash`);
   - the demo agent's `runDemo` in scripted mode, with the test approving as the owner;
   - the indexer through `startTestIndexer` (chain mode over `bed.chain`, `sync()` after each scene);
   - Sentinel live, watching the testbed's guardian, with a collecting notifier.
   - **Per scene, it asserts:**
     - balances (the attacker's unchanged);
     - the indexer's owner overview and events feed (payments, the request and its approval, three `PaymentDenied` with strikes 1–3 and the third tripped, `AgentFrozen` by the tripwire);
     - Sentinel's alerts: `approval_requested` and `tripwire_fired`, and no `burst_denials`.
   - `e2e/README.md` replaces the skeleton.
4. **Order:** 1 and 2 first. Item 3 needs `@leash/indexer/testing` on `main`.

### Task D progress
- **Item 1 done:**
  - Approve's expiry is now `now >= expiresAt`, the program's `PaymentRequest::is_expired`. A new test pins that second: the GET is disabled, the POST answers 409, and a transaction built a second earlier is refused on-chain. The test fails with `>`.
  - Reject works on an approved request ("approved but not paid yet: rejecting withdraws the approval"), tested on-chain with the guardian signing.
  - `apps/web`: 68 tests, 28 of them Actions.
- **Item 2: the `security` job** in `.github/workflows/ci.yml` (the only change there). It runs these tests by name on every commit:

  | 03-security §3 row | Tests (file → test) |
  | --- | --- |
  | I1 Hard ceiling | `programs/leash/tests/invariants.rs` → `i1_random_payments_never_exceed_a_recurring_allowance`, `i1_random_payments_never_exceed_a_fixed_allowance` (seeded random sequences) |
  | I2 Firewall: non-allowlisted destination | `invariants.rs` → `i2_a_payee_off_the_allowlist_never_receives_funds_whatever_accounts_are_passed`; `substitution.rs` → every test (swapped signer, principal, agent, entry, request, delegation, authority, source, destination, mint, programs) |
  | I2 Firewall: reports never move money | `invariants.rs` → `i2_reports_never_move_money`; `report.rs` → `reports_never_move_money` (plus the rest of `report.rs`) |
  | I3 Off switch | `invariants.rs` → `i3_after_a_freeze_every_payment_fails_and_only_the_owner_unfreezes`; `admin.rs` → `the_owner_and_the_guardian_freeze_an_agent_and_nobody_else_can`, `only_the_owner_unfreezes_an_agent_which_clears_its_strikes`, `the_global_switch_is_owner_or_guardian_to_pull_and_owner_to_release`; `packages/sdk/test/agent.test.ts` → "stops every agent while the principal is frozen, and resumes after the owner unfreezes" |
  | I4 Tripwire | `invariants.rs` → `i4_strikes_within_the_window_freeze_and_other_denials_never_do`; `report.rs` → `three_strikes_freeze_the_agent_on_chain`, `other_denials_are_recorded_but_never_trip_the_wire`, `strikes_expire_with_their_window`; `agent.test.ts` → "…and the third strike freezes the agent"; the vectors' strike cases |
  | I5 Audit (program) | `invariants.rs` → `i5_one_event_per_payment_and_per_report` |
  | I5 Audit (indexer stores both) | `services/indexer/test/chain.test.ts` → "ingests the program's transactions: every view equals what the SDK reads from the accounts" (its events include `PaymentExecuted` and `PaymentDenied`) |
  | I6 Non-custodial | `pnpm check:secrets` (no keypair, `.keys/` or PEM key tracked) and `pnpm check:env` (no owner-key variable in any service's env); `apps/web/test/actions.test.ts` (every Action returns an unsigned transaction; a wrong signer fails on-chain) |
  | Parity | `programs/leash/tests/vectors.rs` → `every_policy_vector_matches_the_program`, `every_denial_reason_and_error_in_the_vectors_is_reachable`; `vectors_onchain.rs` → `every_policy_vector_holds_on_the_real_program`; `packages/sdk/test/vectors.test.ts` → all 60 cases |
  | x402 | `packages/x402/test/client.test.ts` → "Path 2: a Leash payment through the official facilitator": it verifies and settles, is rejected without Leash on the allowlist, and fails verification when the program would deny (6 tests) |

  - **Gaps:** none: every row has at least one named test.
  - **No silent drop-outs** (architect's review): a name filter matching nothing passes in both Vitest and cargo. Every step therefore runs through two inline helpers, which fail the step when no test ran:
    - `vitest_ran` needs at least one passed test in the summary;
    - `cargo_ran` needs every test target to report `ok. N passed` with N ≥ 1.
    The helpers were checked locally, as extracted from the YAML: a filter matching nothing fails; matching filters pass; two targets where only one matches fail.
  - **Checked locally**, with each filter selecting what it names:
    - Rust: invariants 7, report 10, substitution 9, admin 3 (of 13), vectors 2, vectors on-chain 1;
    - TypeScript: SDK vectors 60, SDK agent 2 (of 46), indexer 1 (of 7), x402 6 (of 11), web Actions 28.
  - **One partial point:** I6's "guardian and fee-payer keys are the only server keys" is checked as "no owner-key variable" (`check:env`), not as a list of allowed key variables. That's WS0's script; noted, not changed.

## Done

- **Build step 1 (2026-10-01), approved by Parth with wording fixes:**
  - **`README.md` v1.** The first screen gives the name and tagline, links, the problem, what Leash does and a picture of the attack being stopped. Below it: the demo (with what is scripted), how it works, why Solana, what works today (Done / In progress / Planned), the security model, try it, the repo map, how it was built, the team (placeholder). WS0's "Run a local chain" section is kept under "Try it".
  - **`docs/pitch/deck.md` v1.** 13 slides, each with on-slide text, visual, speaker line and the judging criterion it serves. A sources table backs every number.
  - **`docs/pitch/img/`.** Three screenshots of the web app in fixture mode (overview, frozen agent, activity), 1280 px at 2× and light theme, from a production build driven by Chromium. They are labelled as sample data.
  - **Facts checked on Oct 1.** 767 automated tests: 639 TypeScript (`pnpm test`) and 128 Rust (CI's `cargo test`). Every relative link in both files resolves (scripted check).
- **The slide deck (2026-10-01):**
  - **`docs/pitch/leash-deck.pptx`:** 13 slides at 16:9, in Arial, for Parth to import into Google Slides.
    - It uses the web app's light theme and status colours, with the colour chips as the motif.
    - The speaker notes are the "Say" lines.
    - The amber placeholders (team, user conversations) are left for Parth.
  - **`docs/pitch/leash-deck.pdf`:** the backup link, exported by LibreOffice Impress.
  - **`docs/pitch/build-deck.cjs`** (pptxgenjs) builds the deck from `deck.md`'s words and crops the screenshots from `img/`. Its header has the commands, and its dependencies stay outside the pnpm workspace.
  - **`deck.md`** now mirrors the slides word for word.
  - **Checked:**
    - the pptx skill's validator passes;
    - every slide was rendered and inspected, and the overflow and overlaps found were fixed;
    - `markitdown` shows the text in order.
- **The rest of step 5's writing (2026-10-01):**
  - **[`demo-script.md`](../../pitch/demo-script.md):**
    - the live demo second by second (target 1:45, to be measured at the Oct 3 rehearsal);
    - the setup 30 minutes ahead;
    - both paths for every owner action: the web app or Telegram once shipped, or `pnpm devnet:setup`, `owner:approve` and `owner:unfreeze` today;
    - a fallback for every failure, including the laptop's 12:25 finding (an unpaid fetch still shows `✓`);
    - the "Before each take" checklist.
  - **[`judge-qa.md`](../../pitch/judge-qa.md):** 22 hard questions with short answers, each sourced from 03-security, the ADRs or the status files. Competitors are described by what Leash does, never by what they lack.
  - **[`video-storyboard.md`](../../pitch/video-storyboard.md):**
    - nine shots in about 1:45, plus a 60-second cut;
    - honesty rules: say which chain each shot was filmed on, keep the injection disclosure, label any speed-up;
    - recording notes for the laptop.
  - **README:** "The 60-second demo" is now "The demo" (the script runs about 1:45), and the repo map links every pitch document.
- **The architect's review of PR #1 (17:15): good to merge.** Two touch-ups are done:
  - the judge Q&A says the deployer key is on Parth's laptop, never in the repo or on a server;
  - the README marks Solana Action links "Next".

  The other two are under "Next".
- **Task A's plan, approved by Parth (17:16), handed to the fresh Sentinel session** in a message to WS5, so it doesn't re-plan.
- Messages sent:
  - `20261001-1220-from-ws9-to-all-readme-v1-and-deck.md`;
  - `20261001-1720-from-ws9-to-ws5-sentinel-plan-approved.md`.
- Found while checking the facts: CI on `main` was red at `b842f9f` (an indexer stream test hit Vitest's 5 s default on a loaded runner). `09ae03a` on `main` fixed it before WS9's message to WS4 went out, so that message was dropped.

## Rules for every claim

- Only what the status files and a test run show is "done"; everything else is "in progress".
- The scripted injection is "simulating a successful injection", as the demo screen says.
- Ramp: 70,000+ is Ramp's whole customer base; its agent wallets were a limited alpha.
- "On a real chain" means a local validator so far. On devnet, only the program is deployed until the laptop's devnet run.
- Test counts come from a fresh run, not from the status files.

## Next

1. **Parth:** import `leash-deck.pptx` into Google Slides and fill the placeholders. Share it as "Anyone with the link: Viewer", and put that link in the submission. Then re-export the PDF from Google Slides over `docs/pitch/leash-deck.pdf`, so the backup matches.
2. **The laptop, Oct 3–4:** the devnet rehearsal with the demo script (measure the timings and write them back into it), then the video per the storyboard. Put the video link in the README, on slide 13 and in the submission.
3. When the in-progress items ship (web wallet actions, Telegram, the devnet run, recordings), move them to "done" in the README table and slide 9, and replace the screenshots with the devnet recording.
   - When Task C ships, Solana Action links go from "Next" to "Done".
4. **The final pass, Oct 3–4** (the architect's review):
   - Once WS7 announces its fix, rewrite the demo script's 0:10–0:30 fallback: a paid step that comes back unpaid then stops the replay, so switch to the video.
   - Re-count the tests on the final commit, and update the README, slide 9 and `deck.md`.
5. Task D of the work queue (the whole storyline in one LiteSVM test in `e2e/`, and the security CI job) is also WS9's lane. The queue plans it as its own session.

## Open items

- **From Parth:** team names and roles (README "Team", slides 1 and 13); any conversations with agent builders (slide 10 says "none yet" until then); the demo video link.
- The README's pitch link points at the PDF in the repo; add the Google Slides link next to it once Parth shares it.
- Building the PDF needs LibreOffice Impress. The cloud image has only `libreoffice-core`, so this session installed `libreoffice-impress` with apt.

## Questions for other workstreams

- WS6: will pairing, approve, freeze and unfreeze in the web app be ready for the devnet rehearsal on Oct 3? The demo script plans both paths either way.

## Contract changes proposed

- None.
