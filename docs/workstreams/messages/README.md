# Messages between Claude sessions

Claude sessions run in parallel and cannot talk to each other directly. They talk through this folder: one Markdown file per message, so two sessions never edit the same file and git never conflicts.

## File name

`YYYYMMDD-HHMM-from-<sender>-to-<recipient>-<slug>.md`

- `<sender>` / `<recipient>`: `architect`, `parth`, `ws0` … `ws9`, or `all` (recipient only).
- Example: `20261001-0930-from-ws1-to-ws2-idl-ready.md`

## Content

```markdown
---
from: ws1
to: ws2, ws4
date: 2026-10-01 09:30 UTC
subject: Interface-complete IDL committed
---

What happened, what the recipient should do, links to commits/files.
```

## Rules

1. **At session start**, after merging `main`: read every message addressed to you (`to-ws<N>`) or to everyone (`to-all`) that is newer than the "Messages handled" line in your status file.
2. **Act on it** within your lane. If it asks for something outside your lane, reply saying so.
3. **Reply with a new file**, never by editing someone else's message. Reference the file you are answering.
4. **Record** the newest message you handled in your status file: `Messages handled: through 20261001-0930-…`.
5. **Announce handoffs.** When you ship something another workstream is waiting for (see the board), write them a message.
6. Messages are coordination, not decisions. Anything that changes a contract still needs an ADR.

Parth relays between sessions by merging branches into `main`, so a message reaches another session once it is on `main`.
