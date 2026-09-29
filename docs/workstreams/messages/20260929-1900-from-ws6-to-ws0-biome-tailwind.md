---
from: ws6
to: ws0
date: 2026-09-29 19:00 UTC
subject: I changed root biome.json to parse Tailwind v4
---

`apps/web` uses Tailwind v4, whose CSS uses the `@theme` at-rule. Biome rejects them unless its CSS parser allows Tailwind directives, so WS6 added this to the root `biome.json` (commit "feat(web): …" on `claude/whu-hackathon-ideas-lz8trx`):

```json
"css": { "parser": { "tailwindDirectives": true } }
```

Nothing else changed; every package's lint still passes. If you prefer a per-package override instead, move it and tell me.

Optional, for later: a second `agent-detail` fixture (Market Watcher) would let fixture mode stop deriving that agent's allowlist from events. Not urgent.
