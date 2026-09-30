# @leash/facilitator

An x402 v2 facilitator: the official `@x402/svm` `ExactSvmScheme` with smart-wallet verification on and Leash on the allowlist ([ADR-0003](../../docs/adr/0003-x402-via-official-facilitator.md), [02-contracts §9](../../docs/architecture/02-contracts.md#9-x402-profile-how-leash-payments-travel-over-x402-v2)). It verifies and settles ordinary wallet payments and Leash payments. It contains no verification logic of its own. Owned by **WS3**.

## Run

```bash
pnpm --filter @leash/facilitator start      # or `dev` to restart on changes
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `LEASH_CLUSTER` | `localnet` | `localnet` or `devnet` |
| `LEASH_RPC_URL` | per cluster | RPC for simulation, sending and confirmation |
| `LEASH_PROGRAM_ID` | the real Leash ID | Put another deployment on the allowlist |
| `FACILITATOR_PORT` | `4200` | HTTP port |
| `FACILITATOR_FEE_PAYER_KEYPAIR` | `.keys/facilitator.json` | Solana CLI keypair file, relative to the repo root. It pays SOL fees only. |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS origin for `GET` routes |
| `LOG_LEVEL` | `info` | pino level |

Only `src/env.ts` reads the environment.

## Endpoints

| Route | What |
| --- | --- |
| `POST /verify` | `{ x402Version, paymentPayload, paymentRequirements }` → `VerifyResponse` |
| `POST /settle` | same body → `SettleResponse` |
| `GET /supported` | the kinds and fee payer, which merchants read at start |
| `GET /health` | `{ ok, service, cluster, feePayer, networks }` |

The official `HTTPFacilitatorClient` talks to it unchanged; a test proves it.

## Safety (03-security T8, T9)

- **Rate limit:** 60 `verify`/`settle` requests per client IP per minute.
- **Request size:** at most 64 KB.
- **Validation:** request bodies are checked with the official v2 guards.
- **Handled by the official scheme:** fee-payer isolation, compute-unit caps (400k) and priority-fee caps (50k), simulation before settling, a settlement cache against replays, and a post-settlement check of the transfer.
- **Low balance:** a warning is logged when the fee payer holds less than 0.05 SOL, checked at startup and every 5 minutes.
- **Logs:** every `verify` and `settle` logs `verificationPath` (`static` or `smartWallet`), `isValid`/`invalidReason` or `success`/`errorReason`, `payer`, `payTo`, `amount` and the transaction signature.

## Tests

```bash
pnpm --filter @leash/facilitator test
```

These run on the real `leash.so` in LiteSVM, through `@leash/x402/testing`.
