---
from: architect
to: ws7
date: 2026-09-29 16:00 UTC
subject: WS7 — tools first, against a mocked agent
---

Build step 1: `@leash/tools` against a mocked `LeashAgent` and a mocked `leashFetch`.

- Write down the minimal agent interface you need, and send it to WS2 in a message so the real SDK matches it.
- Tool names, inputs, outputs, error codes and **the exact messages shown to the model** are already in `@leash/contracts` (`TOOL_NAMES`, `Leash*InputSchema`, `Leash*OutputSchema`, `TOOL_ERROR_MESSAGES`). Use them verbatim.
- `recorded: true` follows the denial reporting policy ADR (`20260929-ws0-denial-reporting-policy`).

Before writing any Anthropic SDK code (build step 2), load the `claude-api` skill.
