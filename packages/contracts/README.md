# @leash/contracts

The single off-chain source of truth for Leash. Every interface between two workstreams is defined here once, as zod schemas plus inferred TypeScript types, exactly as specified in [docs/architecture/02-contracts.md](../../docs/architecture/02-contracts.md).

Owned by **WS0**; everyone else changes it through the [contract-change process](../../docs/architecture/04-conventions.md#6-changing-a-contract). `idl/` is written only by WS1: `idl/leash.json` is the program's Anchor IDL, regenerated with `cargo run -p leash --example idl -- --write` (CI fails when it is stale). `test/idl.test.ts` checks it against this package: errors, program ID, constants and seeds, `pay`'s accounts, enum order, account and event fields.

## What's inside

| Module | Contents |
| --- | --- |
| `config.ts` | Clusters, program IDs (Leash is a placeholder until WS1 deploys), PDA seeds, program constants, CAIP-2 networks, ports, `resolveClusterConfig`, explorer links, `ENV_VARS` (source of `.env.example`) |
| `units.ts` | Money as `bigint` (`parseUsdc`, `formatUsdc`, JSON amount strings), fixed-size UTF-8 labels and memos, `truncateUtf8`, references (`referenceFromMemo`, hex) |
| `enums.ts` | On-chain enums and their JSON values; the **DenialReason master table** (code, Anchor error, tool code, strike flag, owner copy); the full `LEASH_ERRORS` list the program must match |
| `views.ts` | Read models: principal, agent, policy, allowance, payee, request, stats; `policyProblems` mirrors the program's `InvalidPolicy` rules |
| `events.ts` | `LeashEvent` (18 event types) and the demo-storyline file format |
| `api.ts` | Indexer REST responses, query parsing, WebSocket messages |
| `x402.ts` | x402 v2 headers, networks, the facilitator allowlist with Leash, compute limits |
| `tools.ts` | The four agent tools: input/output schemas, error codes, the messages shown to the model, the denial-reporting policy |
| `actions.ts` | Solana Actions (Blinks) types, routes and headers |
| `alerts.ts` | Sentinel alert schema |
| `presets.ts` | Policy presets and pairing links |
| `test-vectors.ts` | Schema of `test-vectors/policy.json` |

Rules: no I/O and no `process.env`; the only runtime dependency is `zod`. Import from the package root: `import { parseUsdc } from "@leash/contracts"`.

## Fixtures

`fixtures/` holds one coherent world that follows the demo storyline: a research agent pays per call, gets a premium report approved, is manipulated by a poisoned guide into three blocked payments, and freezes itself, while a second agent waits for approval. Use them to build the UI, indexer and Sentinel before any chain exists.

| File | Shape |
| --- | --- |
| `demo-storyline.json` | `DemoStorylineSchema`: named keys + 18 events in slot order |
| `owner-overview.json` | `GET /v1/owners/:owner` |
| `agent-detail.json` | `GET /v1/agents/:agent` (the frozen research agent) |
| `requests.json` | `GET /v1/owners/:owner/requests` (one pending request) |
| `stats-24h.json` | `GET /v1/owners/:owner/stats?window=24h` |

Addresses are deterministic but are not real PDAs of the placeholder program ID.

## Policy test vectors

`test-vectors/policy.json` holds 60 cases for payment evaluation (01-onchain-program §7). Each case gives the full input state, the payment, and the expected outcome: allowed (optionally with post-payment counters), denied with a reason, or an error. The Rust program (WS1) and the TypeScript evaluator (WS2) must both pass every case. That is how we prove they agree.

- Key names (`merchant`, `attacker`) map to keypairs whose ed25519 seed is `sha256("leash:test-key:" + name)`.
- Time fields use on-chain semantics: `0` means "never started" or "no expiry".
- `test/reference-evaluator.ts` is a line-by-line transcription of the spec used to check the expectations. It is test-only, not an API.
- Never delete a case. Fix it, or add a new one.

## Commands

```bash
pnpm --filter @leash/contracts test       # 177 tests: schemas, units (property-based), vectors, the IDL
pnpm --filter @leash/contracts generate   # regenerate fixtures/ and test-vectors/ (deterministic)
pnpm env:example                          # regenerate the root .env.example from ENV_VARS
```

Change the generators in `scripts/`, never the JSON by hand.
