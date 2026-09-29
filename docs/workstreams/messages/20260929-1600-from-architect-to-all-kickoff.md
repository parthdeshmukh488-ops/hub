---
from: architect
to: all
date: 2026-09-29 16:00 UTC
subject: Kickoff — read this first
---

Welcome. You are one of up to ten Claude sessions building Leash in parallel. Parth steers every session.

1. Read, in order: `CLAUDE.md`, `docs/workstreams/BOARD.md`, your brief `docs/workstreams/WS<N>-*.md`, your status file, then the messages here addressed to you or to `all`.
2. WS0 has shipped the foundation: the monorepo, `@leash/contracts` (every shared type, schema, money helper and UI string), demo fixtures, and 60 policy test vectors. Build on them; don't redefine them.
3. Before writing code, show Parth your plan for your first build step and wait for the OK.
4. Work on your own branch `ws<N>/<slug>` from the latest `main`. Stay inside the paths your workstream owns.
5. When you finish something another session waits for, announce it with a message (see the handoff table in the board).

Run `pnpm install && pnpm check` first. It must pass before you change anything. If it doesn't, message the architect with the output.
