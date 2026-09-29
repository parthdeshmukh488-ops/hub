# Engineering conventions

These rules keep ten parallel Claude sessions producing one coherent codebase. When a rule and your instinct disagree, follow the rule. To change a rule, write an ADR.

## 1. Languages and tooling

| Area | Standard |
| --- | --- |
| Package manager | pnpm workspaces (`pnpm-workspace.yaml`), Node 22 LTS |
| Build orchestration | Turborepo: `pnpm turbo run build \| lint \| typecheck \| test` |
| TypeScript | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM only (`"type": "module"`), target ES2022 |
| Lint and format (TS, JSON, CSS) | Biome. No ESLint or Prettier. |
| Rust | `rustfmt` + `clippy -D warnings`; Anchor 1.x |
| Tests | Vitest (TS), LiteSVM (programs), Playwright (web smoke tests) |
| Validation | zod 4 at every boundary: HTTP, WebSocket, env, tool inputs, files |
| Logging | pino (JSON) with fields `service`, `cluster`, and where relevant `agent`, `owner`, `signature` |

Exact versions are pinned by WS0 in the root `package.json` and `pnpm-lock.yaml`. Don't bump shared dependencies inside a feature change.

## 2. Code rules

1. **Money is `bigint`** in TypeScript and `u64` on-chain. Never `number`, never floats. Conversions go through `@leash/contracts/units`.
2. **No `any`**, and no non-null assertion (`!`) outside tests. Parse unknown data with zod.
3. **Typed errors.** The SDK throws `LeashSdkError` subclasses carrying a `code` (the tool/denial codes from [02 §4](02-contracts.md#denialreason-master-table) plus SDK codes). Services respond with `{ error: { code, message } }`. Never throw strings.
4. **Configuration.** Each app has `src/env.ts` that parses `process.env` with zod at startup and fails fast with a readable message. Nothing else reads `process.env`.
5. **One way to do each thing.** Solana access goes through `@leash/sdk`; x402 through `@leash/x402`; shared types come from `@leash/contracts`. Don't re-derive PDAs, decode events or format amounts locally.
6. **Generated code** lives in `src/generated/`, is committed, and is never edited by hand. Regenerate it with the package's `generate` script.
7. **No dead code, no commented-out code, no TODOs** without a matching line under "Open items" in your workstream's status file.
8. **Comments explain why, not what.** Every public function in `packages/*` has a TSDoc or rustdoc comment.
9. **Files:** kebab-case (`agent-card.tsx`, `policy-evaluator.ts`); one main export per file; `index.ts` only re-exports.
10. **Security-relevant code** (program, SDK transaction building, facilitator config, Actions routes) gets tests for the failure cases first, then the happy path.

## 3. Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Program | `leash` | |
| Rust instructions | snake_case | `report_denied_attempt` |
| TS instruction builders (Codama) | camelCase + `Instruction` suffix | `getPayInstruction` |
| Accounts / types | PascalCase | `PaymentRequest`, `AgentView` |
| JSON keys | camelCase | `maxPerPayment` |
| JSON enum values | lowerCamelCase | `"payeeNotAllowed"` |
| Event `type` | PascalCase | `"PaymentDenied"` |
| Tool error codes | SCREAMING_SNAKE_CASE | `PAYEE_NOT_ALLOWED` |
| Packages | `@leash/<name>` | `@leash/sdk` |
| Env vars | see [02 §13](02-contracts.md#13-environment-variables) | `LEASH_RPC_URL` |

## 4. Tests and definition of done

A task is done when:

1. It implements the spec exactly (or the spec was changed through an ADR first).
2. Tests cover the new behaviour, including failure cases. `pnpm turbo run lint typecheck test` passes for the touched packages.
3. The package README reflects the change (purpose, how to run, env vars, public API).
4. Your workstream status file is updated.
5. It can be shown: a command, a test or a screen someone can run to see it work.

Coverage expectations: 100% of branches in the policy evaluator, event decoding, amount conversion and facilitator configuration. Meaningful coverage elsewhere; don't chase numbers with trivial tests.

## 5. Git workflow

- **One workstream per session, one branch per session.** Claude Code on the web assigns a branch name. Locally, use `ws<N>/<slug>` (e.g. `ws2/sdk-evaluator`).
- **Stay in your lane.** Only edit the paths your workstream owns ([workstreams/README.md](../workstreams/README.md#ownership)). Shared paths (`packages/contracts`, root configs, `docs/architecture`) change only through the contract-change process below.
- **Start every session** by merging the latest `main` into your branch, then read any new ADRs.
- **Small commits**, Conventional Commits: `type(scope): subject`, where scope is one of `program contracts sdk x402 facilitator indexer sentinel web agent mcp merchant platform e2e docs`. Example: `feat(sdk): evaluate payee period limits`.
- **Merging to `main`**: when a build step's definition of done is met, the owner of the repo (Parth) merges the branch, or asks the session to open a pull request.
- **Never** force-push `main`, rewrite shared history, commit secrets, or commit generated build output (except `artifacts/programs/*.so`, `packages/contracts/idl/leash.json` and `src/generated/`).

## 6. Changing a contract

A contract is anything in `docs/architecture/01-onchain-program.md`, `02-contracts.md`, `packages/contracts`, or the committed IDL.

1. Write an ADR in `docs/adr/` named `YYYYMMDD-ws<N>-<slug>.md` (date prefix, so parallel sessions never collide), with status **Proposed** and a `Contract change` section listing the affected workstreams.
2. In the same commit: update the spec document(s), `packages/contracts` (and the IDL for program changes), fixtures and test vectors, and bump `CONTRACTS_VERSION` in `packages/contracts/src/index.ts` (minor = additive, major = breaking).
3. Breaking changes need the repo owner's OK before merging. Additive changes (a new optional field, a new event, a new error appended at the end) can merge when tests pass.
4. Affected sessions pick the change up at their next session start ("read new ADRs").

## 7. Documentation

- Every package, app and service has a `README.md`: purpose, how to run, env vars, public API or routes, how to test.
- Decisions go into ADRs, not into chat. If a session makes a choice another session must know about, it's an ADR.
- Diagrams: Mermaid in Markdown (GitHub renders it).

## 8. UI conventions (WS6; also any other UI)

- Mobile-first; the off switch is reachable in two taps from the home screen.
- Amounts are shown as USDC with 2 decimals, and up to 6 when needed (`0.005 USDC`). Times are relative ("2 min ago") with the absolute time on hover or long-press.
- Every on-chain action shows a plain-language summary before the wallet opens, then a pending state, then the confirmed result with an explorer link.
- User- and agent-controlled strings (labels, memos) are rendered as text only.
- Colour semantics are consistent: executed = neutral/green, blocked = red, needs approval = amber, frozen = blue. Never colour alone: always an icon or a label too.
- WCAG AA contrast; full keyboard support; visible focus rings.

## 9. Renaming

"Leash" is a working name. PDA seeds deliberately do not contain it, so renaming never touches on-chain data. To rename: update the product copy (README, web app, pitch), the npm scope `@leash/*` → `@<new>/*`, the program crate name (keep the program ID), and the `LEASH_` env var prefix. Do it in one commit, before the pitch, from a clean `main`.
