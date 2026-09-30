# WS0 status: Platform and shared contracts

- Session branches: `claude/whu-hackathon-ideas-lz8trx` (the architecture session) and `main` (laptop session, step 4)
- Last updated: 2026-09-30
- Current build step: all five steps done

## Done

- **Step 1: skeleton.** pnpm workspace (`packages/*`, `services/*`, `apps/*`, `e2e`), Turborepo, Biome, TypeScript 6 strict base config, Vitest. Every workspace package exists with `package.json`, `tsconfig.json`, a README stub and `src/index.ts`, and now belongs to its workstream. Pinned versions: [ADR-0006](../../adr/0006-monorepo-and-service-stack.md#pinned-versions-ws0-2026-09-29).
  - Check: `pnpm install && pnpm check` passes: 36 workspace tasks plus root checks.
- **Step 2: contracts.** `@leash/contracts` 1.0.0 implements all of 02-contracts. See [packages/contracts/README.md](../../../packages/contracts/README.md).
  - Check: `pnpm --filter @leash/contracts test` passes 144 tests, including property-based round trips for every u64 amount.
- **Step 3: fixtures and test vectors.** Deterministic generators (`packages/contracts/scripts/`) produce 5 fixtures that tell the demo storyline, and 60 policy test vectors covering every evaluation step, every denial reason and the boundaries. A test-only reference evaluator checks every expectation, including post-payment counters.
- **Step 5: guards.** `pnpm check:secrets` fails on tracked `.env` files, `.keys/`, keypair JSON arrays or PEM keys. `pnpm check:env` fails if `.env.example` drifts from `ENV_VARS` or if any `.env.example` names an owner key (I6). Both were proven to fail on planted violations. CI (`.github/workflows/ci.yml`) runs them, the workspace checks, and a Rust job that activates once `Cargo.toml` exists.
- **Spec corrections found while building** (three ADRs, docs updated):
  - [Allowance expiry is inclusive](../../adr/20260929-ws0-allowance-expiry-is-inclusive.md): upstream uses `now > expiry`; the spec said `>=`.
  - [Switched-off limits don't update counters](../../adr/20260929-ws0-disabled-limits-are-not-tracked.md), and approved requests still count towards payee spend.
  - [Denial reporting policy](../../adr/20260929-ws0-denial-reporting-policy.md): strikes always reported, `approvalRequired` never, others once per reason per minute.

- 2026-09-30, CI fix: every CI run since WS6 step 1 failed because the root `.gitignore` rule `data/` also hid `apps/web/src/data/` (six source files never reached GitHub). The rule now ignores only runtime data folders (`/data/`, `apps/*/data/`, `services/*/data/`). A new guard, `pnpm check:ignored` (part of `pnpm check`), fails when `.gitignore` hides any source file. CI can't catch this itself, since ignored files never reach it.
- 2026-09-30, with WS1: the Rust CI job now pins Rust 1.94.1 (as `rust-toolchain.toml` does), so new clippy lints can't break CI unannounced. It also runs `cargo run -p leash --example idl -- --check`, which fails when `packages/contracts/idl/leash.json` drifts from the program.

- **Step 4: environments** (laptop session, 2026-09-30, Agave 4.1.2). How to run them: the root README's "Run a local chain" section. Every script prints usage with `--help`.
  - `pnpm keys` (`scripts/keys.ts`): the six demo keypairs in `.keys/` (Solana CLI format; `solana-keygen pubkey` reads them). Never overwrites, and checks existing files are intact. Prints the addresses and the `.env` lines that take them.
  - `pnpm artifact:subscriptions` (`scripts/subscriptions-artifact.sh`): `artifacts/programs/subscriptions.so` (119,600 bytes), built from tag `program-v0.5.0` (commit `364a4197`) with `cargo build-sbf`. The sha256 and provenance go into `artifacts/programs/CHECKSUMS`. `dump` mode downloads the devnet deployment instead.
  - `pnpm localnet` (`scripts/localnet.sh`): `solana-test-validator` with both programs at their real IDs, checked against `CHECKSUMS` first. Also a mock USDC mint at a stable address (`.keys/localnet-usdc-mint.json`), SOL for every demo key, 1,000 USDC for owner-demo, USDC accounts for merchant and attacker, and `.localnet.json`. Checked from Windows through WSL: both programs executable, owner-demo holding 1,000 USDC.
  - `pnpm devnet:check` (`scripts/devnet-check.ts`): read-only; exits 1 only if a dependency is missing.
  - `.gitattributes` forces LF in every checkout. On Windows, `core.autocrlf=true` had turned the whole tree into CRLF, which failed Biome.
- **Devnet findings, 2026-09-30:**
  - The Subscriptions program is deployed and executable at the canonical ID (last deployed in slot 480013438), so no fallback deployment is needed.
  - The devnet USDC mint `4zMMC9…DncDU` exists: SPL Token, 6 decimals.
  - The Leash program is not deployed yet.
  - The demo keys are unfunded; `pnpm devnet:check` prints the faucet steps.
  - **The devnet Subscriptions binary is newer than the tag** (133,280 vs 119,600 bytes). Upstream's commits after `program-v0.5.0` add `ReclaimExcessRent` and a transfer context that is only used for mints with an active Token-2022 transfer hook, and remove dead code. Transfers of a mint without a hook (USDC) keep the same accounts, data and checks, so the tag build in LiteSVM matches devnet for Leash.

## Next

- Nothing open in the brief. On request: a zod schema for `.localnet.json` in `@leash/contracts`, if an app needs to read it.

## Open items

- Done by WS1 on 2026-09-30: `PROGRAM_IDS.leash` is the real ID (`LEASH_PROGRAM_ID`, [ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md), contracts 1.4.0). The placeholder stays exported.
- Surfpool is not installed on the laptop; `localnet.sh` uses `solana-test-validator`, which the brief allows.
- `AGENTS.md` at the root is written by the `turbo` CLI (a managed agent-guidance block). Kept on purpose.

## Questions for other workstreams

- WS2: please review `test-vectors/policy.json` and `test/reference-evaluator.ts`; parity with your evaluator is the goal.
- WS6: `NEXT_PUBLIC_DATA_SOURCE=fixtures` should read `@leash/contracts/fixtures/*`; the package exports that path.

## Contract changes proposed

- The three ADRs above (accepted with this commit). `CONTRACTS_VERSION` stays 1.0.0: nothing had consumed the contracts yet.
