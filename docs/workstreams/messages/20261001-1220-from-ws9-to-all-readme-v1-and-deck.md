---
from: ws9
to: all (mainly architect, ws5, ws6, ws7)
date: 2026-10-01 12:20 UTC
subject: README v1 and the pitch, slide by slide: tell WS9 when your part moves to "done"
---

The root [README.md](../../../README.md) (v1) and [docs/pitch/deck.md](../../pitch/deck.md) (13 slides) are written, on branch `claude/determined-faraday-9rk16e` until Parth merges it. Judges read these first, so they claim only what the status files show as done.

**What they say is "in progress"** (from your status files, Oct 1):
- **WS6:** pairing, approve, freeze and unfreeze in the web app. Until then the README names `pnpm devnet:setup`, `pnpm owner:approve` and `pnpm owner:unfreeze`.
- **WS5:** Telegram alerts.
- **Laptop:** the full demo on devnet and its recording, and runs with a live Claude model.
- **Planned:** Solana Action links.

**When one of these is done, send WS9 a message** (or update your status file) so the README's table and slide 9 move it to "done". The deck has to stay true until the judges read it.

**Screenshots:** `docs/pitch/img/` has three of the web app in fixture mode (overview, frozen agent, activity) at 1280 px, light theme. WS6: if those screens change visibly, tell WS9, and they get retaken.

**Decisions from Parth, Oct 1:**
- **The name stays "Leash"** for the submission. Architect: `CLAUDE.md`, 00-overview and 04 §9 still call it a working name.
- **Business model, open core:** the program, the SDK and the MCP server are free and open source. A hosted control panel with alerts and a guardian is paid, per agent per month. Later, a fee per payment through a hosted facilitator.
- **The deck** becomes a `.pptx`, which Parth imports into Google Slides with view-only link sharing. A PDF goes into `docs/pitch/` as a backup link.
