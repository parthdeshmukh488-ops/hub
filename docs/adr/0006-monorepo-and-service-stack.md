# pnpm + Turborepo + Biome; Hono services; Drizzle + libSQL; Next.js web

- Status: Accepted
- Date: 2026-09-29
- Workstream: architecture (WS0 pins exact versions)
- Contract change: n/a (founding decision)

## Context

Ten parallel sessions need one toolchain, one way to run things, and one set of lint rules. Package versions checked on npm on 2026-09-29: `turbo` 2.11, `@biomejs/biome` 2.5, `hono` 4.13, `@hono/node-server` 2.1, `drizzle-orm` 0.45, `@libsql/client` 0.18, `next` 16.3, `tailwindcss` 4.3, `zod` 4.6, `vitest` 5.0, `pino` 10.3, `@playwright/test` 1.63, `@modelcontextprotocol/sdk` 1.31, `@anthropic-ai/sdk` 0.129, `grammy` 1.46.

## Decision

| Concern | Choice | Why |
| --- | --- | --- |
| Workspace | pnpm workspaces + Turborepo | Fast, cached, standard |
| Lint and format | Biome | One fast tool for TS, JSON and CSS; no config drift between packages |
| Services | Hono on `@hono/node-server` | Small, typed, and matches the official `@x402/hono` middleware |
| Database | Drizzle ORM + libSQL (a local file in dev, Turso if hosted) | One driver for dev and prod; only the indexer writes |
| Web | Next.js (App Router) + Tailwind v4 + shadcn/ui (Radix) + TanStack Query | API routes for Solana Actions, SSR landing page, easy deploy |
| Agent | `@anthropic-ai/sdk` with tool use | Demo agent; model configurable (`AGENT_MODEL`) |
| MCP | `@modelcontextprotocol/sdk` (stdio) | Works with Claude Desktop, Claude Code, Cursor |
| Telegram | grammY | Simple bot API |
| Validation | zod 4 | Shared by every boundary |
| Logging | pino | JSON logs |

## Consequences

- WS0 creates the root configs once. Nobody adds a second linter, formatter or test runner.
- Every service is a Hono app with `src/env.ts`, `src/server.ts` and a `/health` route, which keeps them recognizable.
- Hosted deployment (optional): web on Vercel; services on any Node host; libSQL on Turso.

## Alternatives considered

- **ESLint + Prettier:** slower, and more config to keep consistent across packages.
- **Express / Fastify:** fine, but Hono matches the x402 middleware and runs anywhere.
- **Postgres:** heavier for local development. libSQL keeps a zero-setup local file with the same driver hosted.
- **Vite + React** (like the Foundation's Subscriptions web app): no built-in API routes for Solana Actions. We still borrow its Kit and ConnectorKit patterns.

## Pinned versions (WS0, 2026-09-29)

| Tool | Version | Note |
| --- | --- | --- |
| Node | 22 (`.nvmrc`) | `engines: >=22.12` |
| pnpm | 10.33.0 | `packageManager`; `onlyBuiltDependencies: [esbuild]` |
| TypeScript | 6.0.3 | Not 7.0.2 yet: TypeScript 7 is the new native compiler. Next.js and Codama tooling use the TypeScript JS API, and their support for 7 is unconfirmed. Revisit when WS6 and WS2 confirm. |
| Biome | 2.5.14 | Config migrated to `"preset": "recommended"` |
| Turborepo | 2.11.5 | It writes a managed agent-guidance block to `AGENTS.md`; we keep it committed, as it asks |
| Vitest / Vite | 5.0.2 / 8.3.1 | Vite is a peer dependency of Vitest 5 |
| tsx | 4.23.15 | Runs scripts and services in development |
| zod | 4.6.5 | Note: zod 4 runs later checks even after one fails, so a schema must never assume an earlier check passed (see `AmountStringSchema`) |
| fast-check | 4.10.2 | Property tests |
| @types/node | 22.20.4 | Matches Node 22 |
