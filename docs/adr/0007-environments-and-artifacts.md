# Environments: localnet and devnet only; program binaries committed; what cloud sessions can do

- Status: Accepted
- Date: 2026-09-29
- Workstream: architecture (WS0 implements)
- Contract change: n/a (founding decision)

## Context

Network checks from a Claude Code on the web session (2026-09-29):

| Reachable | Blocked |
| --- | --- |
| `registry.npmjs.org`, `pypi.org`, `index.crates.io`, `static.crates.io`, `static.rust-lang.org`, `api.anthropic.com`, public GitHub repos via `git clone` | Solana RPC (`api.devnet.solana.com`, `api.mainnet-beta.solana.com`, Helius), `release.anza.xyz` (Solana CLI installer), GitHub release downloads (Anchor, platform-tools, Surfpool binaries), `run.surfpool.run`, `faucet.circle.com` |

So a cloud session can install JS packages and Rust crates and run host-side Rust tests. It cannot build SBF programs (`cargo build-sbf` downloads platform-tools from GitHub releases), deploy, or talk to devnet.

## Decision

1. **Two chains only:** `localnet` (development) and `devnet` (demo). No mainnet.
2. **Committed binaries:** `artifacts/programs/leash.so` (built by WS1 after each program change) and `artifacts/programs/subscriptions.so` (WS0 builds it from the audited tag, or dumps it from devnet/mainnet), with `artifacts/programs/CHECKSUMS` recording the source and version. LiteSVM tests load these, so they run anywhere.
3. **Where each kind of work runs:**

   | Work | Cloud session | Local machine (Solana toolchain) |
   | --- | --- | --- |
   | TypeScript packages, services, web UI, unit tests | ✓ | ✓ |
   | LiteSVM tests with committed `.so` | ✓ | ✓ |
   | Building `leash.so`, `anchor build`, IDL generation | ✗ | ✓ |
   | localnet validator, devnet deploy, end-to-end runs | ✗ | ✓ |

4. To run everything in the cloud instead, the repo owner can allow these hosts in the cloud environment's network settings: `api.devnet.solana.com` (and WebSocket), `release.anza.xyz`, `github.com` release downloads plus `objects.githubusercontent.com` / `release-assets.githubusercontent.com`, `faucet.solana.com`. See https://code.claude.com/docs/en/claude-code-on-the-web.
5. **Fixtures first:** UI, indexer and Sentinel are developed against `packages/contracts/fixtures` and switch to live data when a chain is available.

## Consequences

- WS1 (program) and the parts of WS0/WS9 that touch a chain need a machine with the Solana toolchain, or a cloud environment with the extra hosts allowed.
- Every program change ships its `.so` and IDL in the same commit, or other sessions test against stale behaviour.
- Devnet SOL and devnet USDC (Circle faucet) are fetched manually by the repo owner for the demo wallets; `scripts/` prints what is needed.

## Alternatives considered

- **Devnet-only development:** needs network access every session and is slow and flaky for tests.
- **Mock-chain simulator in TypeScript:** duplicates the program's behaviour and could drift. LiteSVM runs the real binaries instead.
