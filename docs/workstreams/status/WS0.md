# WS0 status: Platform and shared contracts

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (the architecture session)
- Last updated: 2026-09-29
- Current build step: steps 1, 2, 3 and 5 done; step 4 (environments) waits for a machine with the Solana toolchain

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

## Next

- **Step 4: environments.** Needs a machine with the Solana toolchain and devnet access (not possible in this cloud session):
  - `scripts/keys.ts`: generate the demo keypairs into `.keys/`.
  - `scripts/subscriptions-artifact.sh`: build `artifacts/programs/subscriptions.so` from tag `program-v0.5.0`, or dump it from devnet, and write `CHECKSUMS`.
  - `scripts/localnet.sh`: start Surfpool or `solana-test-validator` with both programs, create the mock USDC mint, fund the keys, and write `.localnet.json`.
  - `scripts/devnet-check.ts`: verify that the Subscriptions program and the devnet USDC mint exist, and print balances and faucet steps.

## Open items

- `LEASH_PROGRAM_ID_PLACEHOLDER` stays until WS1 generates the program keypair. WS1 then updates `PROGRAM_IDS.leash` through a one-line contract-change ADR.
- The devnet USDC mint (`4zMMC9sr…DncDU`) and the canonical Subscriptions deployment on devnet are unverified until `devnet-check` runs.
- `AGENTS.md` at the root is written by the `turbo` CLI (a managed agent-guidance block). Kept on purpose.

## Questions for other workstreams

- WS1: the IDL's error list must equal `LEASH_ERRORS` in `enums.ts` (the order matters: codes 6000–6031). Please add a test that compares them once the IDL exists.
- WS2: please review `test-vectors/policy.json` and `test/reference-evaluator.ts`; parity with your evaluator is the goal.
- WS6: `NEXT_PUBLIC_DATA_SOURCE=fixtures` should read `@leash/contracts/fixtures/*`; the package exports that path.

## Contract changes proposed

- The three ADRs above (accepted with this commit). `CONTRACTS_VERSION` stays 1.0.0: nothing had consumed the contracts yet.
