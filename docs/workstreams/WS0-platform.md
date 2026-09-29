# WS0: Platform and shared contracts

## Mission

Build the foundation every other session stands on: the monorepo, the toolchain, CI, the environment scripts, and **`packages/contracts`**, the single off-chain source of truth. If WS0 is sloppy, ten sessions inherit the mess. If it is excellent, they all move fast and stay consistent.

## Read first

[00-overview](../architecture/00-overview.md) · [02-contracts](../architecture/02-contracts.md) (you implement all of it) · [04-conventions](../architecture/04-conventions.md) · [01-onchain-program §7](../architecture/01-onchain-program.md#7-evaluation) (for the test vectors) · [ADR-0006](../adr/0006-monorepo-and-service-stack.md) · [ADR-0007](../adr/0007-environments-and-artifacts.md)

## You own

Root configs (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `.nvmrc`, `.env.example`), `.github/`, `scripts/` (except `scripts/demo/`), `packages/contracts/` (except `idl/`), `artifacts/programs/subscriptions.so` and `artifacts/programs/CHECKSUMS`.

## You provide

- A workspace where `pnpm install && pnpm turbo run lint typecheck test` passes from a fresh clone.
- A **skeleton for every workspace package** (`packages/{contracts,sdk,x402,tools,mcp}`, `services/{indexer,sentinel,facilitator}`, `apps/{web,agent-demo,merchant-demo}`, `e2e`), each with `package.json` (name, standard scripts), `tsconfig.json`, `README.md` stub and `src/index.ts`. After that, each package belongs to its workstream.
- `@leash/contracts`: everything in 02-contracts, with tests.
- Environment scripts and the Subscriptions binary.

## Design notes

- **Internal packages without a build step:** libraries in `packages/*` export TypeScript source (`"exports": { ".": "./src/index.ts" }`). Next.js consumes them through `transpilePackages`. Services run with `tsx` in dev and bundle with `tsup` for start. Vitest runs TypeScript directly. This avoids build-order problems between ten packages. If you choose differently, write an ADR.
- **Standard scripts** in every package: `dev`, `build`, `lint` (`biome check`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Turborepo pipelines: `build` depends on `^build`; `test` and `typecheck` depend on `^build` only where needed.
- **Biome:** recommended rules, plus `noExplicitAny: error` and `noNonNullAssertion: error` (off for `**/*.test.ts`). 2-space indent, 100 columns, double quotes, trailing commas.
- **`packages/contracts`:** zod schemas are the source; types are `z.infer`. Export `CONTRACTS_VERSION = "1.0.0"`. `units.ts` has property-based tests (fast-check) for `parseUsdc`/`formatUsdc` round trips. `config.ts` resolves the cluster config from explicit arguments; **it never reads `process.env`**. Apps pass env values in.
- **Fixtures:** write them by hand from the spec: realistic addresses, a coherent storyline (the demo in [WS9](WS9-integration-story.md#the-demo-storyline)), every event type at least once. A test parses every fixture with its schema.
- **Policy test vectors:** at least one case per evaluation step (1–11 in 01 §7.1), boundary cases at exactly the limit and one unit above, window roll-over cases, approved-request cases, and error cases (`InvalidAmount`, request mismatch). Aim for 40 or more cases. Every case has a descriptive `name`.
- **Scripts** (TypeScript run with `tsx`, or bash where simpler):

  | Script | Does |
  | --- | --- |
  | `scripts/keys.ts` | Generates the demo keypairs into `.keys/` (owner-demo, agent, merchant, attacker, guardian, facilitator) and prints their public keys. Never overwrites. |
  | `scripts/subscriptions-artifact.sh` | Produces `artifacts/programs/subscriptions.so` from the audited tag (`program-v0.5.0`), either by `just build-program` in a checkout or `solana program dump`. Writes source, tag and sha256 into `CHECKSUMS`. |
  | `scripts/localnet.sh` | Starts Surfpool or `solana-test-validator` with both programs (`--bpf-program`), creates the mock USDC mint, funds the demo keys, and writes `.localnet.json` with all addresses. |
  | `scripts/devnet-check.ts` | Checks that the Subscriptions program is deployed and executable on devnet, that the USDC mint exists, and prints the SOL and USDC balances of the demo keys, with faucet instructions for what's missing. |

- **CI** (`.github/workflows/ci.yml`): install with the frozen lockfile, `turbo run lint typecheck test`, a Rust job (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`) once `programs/` exists, and a **secret scan** step that fails on committed 64-number keypair arrays or `.env` files.
- **I6 check** (`scripts/check-no-owner-keys.ts`, run in CI): fails if any service `.env.example` or config refers to an owner key.

## Build order (quality gates)

1. **Skeleton.** Root configs and every workspace package skeleton. `pnpm install` works. `turbo run lint typecheck test` is green on empty packages. CI runs on push.
2. **Contracts.** Everything in 02-contracts implemented, with tests for every schema and the unit helpers. `CONTRACTS_VERSION` 1.0.0. Fixtures written and validated.
3. **Test vectors.** `test-vectors/policy.json` with 40+ cases, plus a README explaining the format and how WS1 (Rust) and WS2 (TypeScript) consume it. Ask WS1 and WS2 (through Parth) to review.
4. **Environments.** Keys script, Subscriptions artifact and checksum, localnet script, devnet check. Document "how to run a local chain" in the root README section your status file points to.
5. **Guards.** Secret scan and the I6 check in CI.

## Definition of done (in addition to the general one)

- A fresh clone passes `pnpm install && pnpm turbo run lint typecheck test` with no manual steps.
- Every schema in 02-contracts exists, is exported and is exercised by at least one fixture or test.
- Nobody needs to ask "how do I run X": each script prints usage with `--help`.

## Pitfalls

- Don't let packages read `process.env` directly (convention §2.4).
- Pin versions exactly in the root; don't use `latest`.
- The devnet USDC mint and the Subscriptions deployment are assumptions until `devnet-check` proves them. Record the result in your status file.

## Starter prompt

```text
You are the WS0 (Platform and shared contracts) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS0-platform.md and every document its "Read first" section lists.
3. Read docs/workstreams/status/WS0.md (create it from the template in docs/workstreams/status/README.md if missing) and any ADRs newer than it.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it, and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit the paths WS0 owns; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
