---
from: ws1 (laptop session)
to: all (mainly parth, ws9, architect)
date: 2026-10-03 11:45 UTC
subject: the narrated demo video is done (real devnet take); the laptop's report so far, and what remains before the deadline
---

Replying to [20261003-1100](20261003-1100-from-architect-to-ws1-ws3-facilitator-retries.md) and [20261003-1300](20261003-1300-from-architect-to-ws1-faster-devnet-calls.md).

## The demo video

`leash-demo-devnet.mp4`, 2:03, 1080p with narration. It is on the laptop at `F:\lasona h\leash-video\`, not in git. Parth uploads it and sends the link; the README and deck pass then only needs that link.

| Part | Length | Source |
| --- | ---: | --- |
| Title card, with the disclosure (decisions scripted, transactions real) | 7 s | |
| Landing page | 7 s | headless Chrome, 1920×1080 |
| Control panel overview | 7 s | the same, labelled "sample data of the same storyline" (live mode needs owner-demo in a wallet) |
| The storyline, three captioned scenes | 52 s | every line the demo agent printed in the real devnet take at 11:00 UTC, at its real time. The owner's wait runs at 4× with an on-screen label. |
| Parth's phone: the real Telegram alerts from Sentinel (his screen recording, its sound replaced by the narration) | 12 s | the devnet take's "Research agent was frozen by its tripwire" among them |
| Approvals inbox, frozen agent | 13 s | control panel, labelled as sample data |
| Two on-chain cards: the approved payment, the tripwire freeze | 16 s | `getTransaction` from devnet: owner −1.50, merchant +1.50, fee payer the facilitator; `ReportDeniedAttempt`, strike 3 of 3, no tokens moved |
| End card | 10 s | |

- **Voice:** OpenAI `gpt-4o-mini-tts` (voice "onyx"), one clip per part, normalized to −16 LUFS. The script is `narration.txt` next to the video.
- **Not a screen recording:** screen capture from the session gave blank frames. The terminal part is a faithful replay of the take's output: same text, same timing.
- **The take itself:** 53 s for the whole storyline. Paid calls took 1.4–4.3 s, against about 20 s in the first rehearsal. The two experiments in 1300 can wait for the next take.

## The laptop's work so far

- **Program:** built, 128 Rust tests (all 60 policy vectors on-chain in LiteSVM), deployed on devnet `HyL9S5…HJncu`, and the dump equals the committed `leash.so`.
- **Every service checked on a real chain, localnet first, then devnet.** Bugs found and fixed:
  - **Facilitator:** its RPC object was misread, so every simulation failed.
  - **Merchant:** its first paid request answered 500 when it started before the facilitator.
  - **`pnpm localnet`:** kept only minutes of history.
  - **Indexer:** a cursor from another chain stalled it.
  - **Two CI breakages:** a lost poke, and test timeouts on slow runners.
- **Devnet:** keys funded; setup, x402, `devnet:smoke`, indexer and Sentinel all pass. The pitch storyline passed twice: the rehearsal and the video take.
- **Sentinel:** real Telegram alerts on Parth's phone, and a guardian autofreeze on a real chain.
- **RPC:** Alchemy (free tier, no `getProgramAccounts`) for the facilitator; everything else on the public RPC with the SDK's retries.

## What remains before Sun Oct 4, 23:59

**Parth:**
1. Watch the video, upload it (YouTube unlisted or Drive) and send the link for the README and the deck.
2. Accept or reject the four proposed ADRs (`3af243a`).
3. Submit: the deck (`docs/pitch/leash-deck.pdf`), the public repo and the video link.
4. After the submission, rotate the secrets that passed through chat or screenshots:
   - the Telegram bot token (`/revoke` in BotFather);
   - the OpenAI key;
   - the Alchemy key.

**Optional, if there is time:**
5. A richer video: the live control panel, with owner-demo imported into a devnet browser wallet (Parth only; the session never handles private keys).
6. A real Claude run of the agent: LLM mode with `ANTHROPIC_API_KEY` and `--record`.

**Laptop, before any next take:**
7. Restart the facilitator, merchant, indexer and Sentinel on the latest `main` (retries and faster calls).
8. Takes only after about 09:50 UTC tomorrow: the Research API's daily budget is spent.
9. Try 1300's experiments then: priority fee 20000, and a Helius RPC for the agent and the indexer.

**Program:** no change pending. After any change: rebuild, update `CHECKSUMS`, upgrade on devnet.
