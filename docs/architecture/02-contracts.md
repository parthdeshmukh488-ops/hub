# Off-chain contracts

> **Status:** v1 draft, normative. Every interface between two workstreams is defined here, and implemented once in `packages/contracts` (TypeScript types plus zod schemas). If this document and the package disagree, fix the package and raise it in the owning workstream's status file. To change a contract, follow [04-conventions.md → Changing a contract](04-conventions.md#6-changing-a-contract).

## 1. `packages/contracts` layout

```text
packages/contracts/
├── src/
│   ├── config.ts        clusters, program IDs, mints, CAIP-2 networks, ports, env var names
│   ├── units.ts         amount/time/label/memo/reference helpers (pure)
│   ├── enums.ts         AgentStatus, FreezeReason, PayeeMode, RequestStatus, DenialReason (+ tables)
│   ├── views.ts         PrincipalView, AgentView, PolicyView, AllowanceView, PayeeView, RequestView, StatsView
│   ├── events.ts        LeashEvent discriminated union
│   ├── api.ts           indexer REST responses, WebSocket messages, API errors
│   ├── x402.ts          Leash x402 profile constants
│   ├── tools.ts         agent tool inputs/outputs (SDK, MCP, demo agent)
│   ├── actions.ts       Solana Actions (Blinks) request/response types
│   ├── alerts.ts        Sentinel alert schema
│   ├── presets.ts       policy presets and pairing links
│   ├── test-vectors.ts  schema of test-vectors/policy.json
│   └── index.ts
├── scripts/             deterministic generators for fixtures/ and test-vectors/
├── idl/leash.json       committed by WS1 after each program change
├── fixtures/            JSON examples, all validated by the schemas in CI
└── test-vectors/
    └── policy.json      shared evaluation vectors (program ⇄ TypeScript parity)
```

Rules: zero runtime dependencies except `zod`; no I/O; every exported schema has a matching exported TypeScript type (`z.infer`); fixtures are parsed by the schemas in the package's own tests.

## 2. Configuration

### 2.1 Clusters

| Key | `localnet` | `devnet` |
| --- | --- | --- |
| RPC | `http://127.0.0.1:8899` | `https://api.devnet.solana.com` (override with `LEASH_RPC_URL`) |
| WebSocket | `ws://127.0.0.1:8900` | `wss://api.devnet.solana.com` |
| CAIP-2 network (x402) | `solana:localnet` (never used with x402 facilitators) | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| USDC mint | created by `scripts/localnet` (mock, 6 decimals) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle devnet USDC; WS0 verifies) |
| Explorer | `https://explorer.solana.com/tx/{sig}?cluster=custom&customUrl=http://127.0.0.1:8899` | `https://explorer.solana.com/tx/{sig}?cluster=devnet` |

Mainnet is intentionally absent. Mainnet CAIP-2, for reference only: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.

### 2.2 Program IDs

| Program | ID |
| --- | --- |
| Leash | set by WS1 (`LEASH_PROGRAM_ID` in `config.ts`) |
| Subscriptions | `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` (devnet fallback ID only if WS0 finds it undeployed) |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Compute Budget | `ComputeBudget111111111111111111111111111111` |

### 2.3 PDA seeds

| PDA | Program | Seeds |
| --- | --- | --- |
| Principal | Leash | `["principal", owner]` |
| Agent | Leash | `["agent", principal, agentKey]` |
| Payee | Leash | `["payee", agent, payeeWallet]` |
| PaymentRequest | Leash | `["request", agent, u64le(nonce)]` |
| Leash event authority | Leash | `["__event_authority"]` (Anchor `#[event_cpi]` convention) |
| Subscription Authority | Subscriptions | `["SubscriptionAuthority", owner, mint]` |
| Delegation | Subscriptions | `["delegation", subscriptionAuthority, owner, agentPda, u64le(nonce)]` |
| Subscriptions event authority | Subscriptions | `["event_authority"]` |

### 2.4 Local ports

| Service | Port |
| --- | --- |
| web | 3000 |
| indexer (REST + WS) | 4100 |
| facilitator | 4200 |
| merchant-demo | 4300 |
| sentinel (health only) | 4400 |

## 3. Units and encodings

| Concept | On-chain | TypeScript | JSON (APIs, events, fixtures) |
| --- | --- | --- | --- |
| Amount | `u64` base units | `bigint` | decimal **string** of base units, e.g. `"1500000"` = 1.5 USDC |
| Human amount (LLM tools, UI input only) | – | `string` | decimal string in token units, field suffix `Usdc`, e.g. `amountUsdc: "1.50"` |
| Timestamp | `i64` Unix seconds | `number` | `number` Unix seconds; `null` for "never" |
| Address | `Pubkey` | `Address` from `@solana/kit` | base58 string |
| Label | `[u8; 32]` UTF-8, zero-padded | `string` | string (trailing zeros stripped) |
| Memo (purpose) | `[u8; 64]` UTF-8, zero-padded | `string` | string |
| Reference | `[u8; 32]` | `Uint8Array` | lowercase hex, 64 chars |
| Counts | `u16`/`u32`/`u64` | `number` | `number` (u64 nonces are strings) |

Rules: **never use floating point for money.** Converting between `amountUsdc` and base units goes through `units.ts` (`parseUsdc`, `formatUsdc`), which rejects more than 6 decimals. Labels and memos longer than their byte length are rejected, not truncated, except in the agent tools (§8), which truncate `purpose` at a UTF-8 character boundary.

**Reference derivation** (SDK and x402 layer):

1. Paying an approved request: `reference = request.reference`.
2. An x402 payment: `reference = sha256(utf8(memoString))`, where `memoString` is the exact content of the transaction's Memo instruction.
3. Anything else: 32 random bytes.

## 4. Enums (JSON values)

Enum values in JSON are the on-chain variant names in lowerCamelCase. Event `type` values are PascalCase event names. Tool error codes are SCREAMING_SNAKE_CASE.

| Enum | JSON values |
| --- | --- |
| AgentStatus | `"active"`, `"frozen"` |
| FreezeReason | `"none"`, `"owner"`, `"guardian"`, `"tripwire"` |
| PayeeMode | `"allowListOnly"`, `"anyPayee"` |
| RequestStatus | `"pending"`, `"approved"` |
| DelegationKind | `"fixed"`, `"recurring"` |

### DenialReason master table

This single table drives the program errors, the SDK, the tools, the UI copy and the alerts.

| Code | JSON | Anchor error | Tool error code | Strike | Owner-facing copy (UI) |
| --- | --- | --- | --- | --- | --- |
| 1 | `principalFrozen` | 6000 `DeniedPrincipalFrozen` | `PRINCIPAL_FROZEN` | no | All agents are paused |
| 2 | `agentFrozen` | 6001 `DeniedAgentFrozen` | `AGENT_FROZEN` | no | This agent is paused |
| 3 | `agentExpired` | 6002 `DeniedAgentExpired` | `AGENT_EXPIRED` | no | This agent's access has expired |
| 4 | `payeeNotAllowed` | 6003 `DeniedPayeeNotAllowed` | `PAYEE_NOT_ALLOWED` | **yes** | Tried to pay someone not on the allowlist |
| 5 | `exceedsPaymentLimit` | 6004 `DeniedExceedsPaymentLimit` | `EXCEEDS_PAYMENT_LIMIT` | **yes** | Tried to pay more than allowed per payment |
| 6 | `approvalRequired` | 6005 `DeniedApprovalRequired` | `APPROVAL_REQUIRED` | no | Needs your approval |
| 7 | `exceedsPayeePaymentLimit` | 6006 `DeniedExceedsPayeePaymentLimit` | `EXCEEDS_PAYEE_PAYMENT_LIMIT` | **yes** | Tried to pay this payee more than allowed |
| 8 | `exceedsPayeePeriodLimit` | 6007 `DeniedExceedsPayeePeriodLimit` | `EXCEEDS_PAYEE_PERIOD_LIMIT` | no | This payee's budget is used up |
| 9 | `velocityExceeded` | 6008 `DeniedVelocityExceeded` | `VELOCITY_EXCEEDED` | no | Too many payments too fast |
| 10 | `allowanceExpired` | 6009 `DeniedAllowanceExpired` | `ALLOWANCE_EXPIRED` | no | The allowance has expired |
| 11 | `allowanceExceeded` | 6010 `DeniedAllowanceExceeded` | `ALLOWANCE_EXCEEDED` | no | The allowance for this period is used up |
| 12 | `insufficientFunds` | 6011 `DeniedInsufficientFunds` | `INSUFFICIENT_FUNDS` | no | Your wallet balance is too low |

## 5. Views (indexer and SDK read models)

```ts
type PrincipalView = {
  address: string            // Principal PDA
  owner: string
  guardian: string | null
  frozen: boolean
  frozenAt: number | null
  frozenBy: string | null
  agentCount: number
  createdAt: number
}

type PolicyView = {
  maxPerPayment: string      // base units
  maxPerRequest: string      // "0" = approvals off
  payeeMode: "allowListOnly" | "anyPayee"
  velocityMaxPayments: number   // 0 = off
  velocityWindowSecs: number
  tripwireMaxStrikes: number    // 0 = off
  tripwireWindowSecs: number
  requestTtlSecs: number
  validUntil: number | null
}

type AllowanceView = {       // derived from the Subscriptions delegation at `asOf`
  delegation: string
  kind: "recurring" | "fixed"
  mint: string
  amountPerPeriod: string | null     // recurring only
  periodLengthSecs: number | null
  currentPeriodStart: number | null
  pulledInPeriod: string | null
  amountRemaining: string | null     // fixed only
  remaining: string                  // spendable now (both kinds)
  expiresAt: number | null
  asOf: number
}

type AgentStatsView = {
  paymentsCount: number
  totalPaid: string
  deniedCount: number
  lastPaymentAt: number | null
  velocityCount: number
  velocityWindowStart: number | null
  strikes: number
  strikeWindowStart: number | null
  requestNonce: string
}

type AgentView = {
  address: string            // Agent PDA (also the delegatee)
  principal: string
  owner: string
  agentKey: string
  mint: string
  label: string
  status: "active" | "frozen"
  freezeReason: "none" | "owner" | "guardian" | "tripwire"
  frozenAt: number | null
  payeeCount: number
  openRequests: number
  policy: PolicyView
  stats: AgentStatsView
  allowance: AllowanceView | null    // null if no delegation found
  createdAt: number
  updatedAt: number
}

type PayeeView = {
  address: string; agent: string; payee: string; label: string
  maxPerPayment: string; periodLimit: string; periodSecs: number
  periodStart: number | null; spentInPeriod: string
  totalPaid: string; paymentsCount: number; createdAt: number
}

type RequestView = {
  address: string; agent: string; nonce: string; payee: string
  amount: string; reference: string; memo: string
  status: "pending" | "approved"
  createdAt: number; expiresAt: number; approvedAt: number | null; rentPayer: string
}

type StatsView = {
  window: "1h" | "24h" | "7d"
  totals: { paid: string; payments: number; denied: number; strikes: number; frozenAgents: number }
  byAgent: { agent: string; label: string; paid: string; payments: number; denied: number }[]
  byPayee: { payee: string; label: string | null; paid: string; payments: number }[]
}
```

## 6. Events (JSON)

Every on-chain event becomes one `LeashEvent`:

```ts
type EventBase = {
  id: string            // `${signature}:${innerIndex}`, globally unique and stable
  type: LeashEventType  // PascalCase on-chain event name
  signature: string
  slot: number
  blockTime: number     // from the transaction
  timestamp: number     // from the event itself
  principal: string | null
  agent: string | null
}
```

| `type` | Extra fields (JSON encodings per §3) |
| --- | --- |
| `PrincipalInitialized` | `owner, guardian` |
| `GuardianChanged` | `guardian` |
| `PrincipalFrozen` | `by` |
| `PrincipalUnfrozen` | – |
| `AgentCreated` | `agentKey, mint, label, policy: PolicyView` |
| `PolicyUpdated` | `policy: PolicyView` |
| `AgentFrozen` | `reason: FreezeReason, by` |
| `AgentUnfrozen` | – |
| `AgentClosed` | – |
| `PayeeAdded` / `PayeeUpdated` | `payee, label, maxPerPayment, periodLimit, periodSecs` |
| `PayeeRemoved` | `payee` |
| `PaymentExecuted` | `payee, destination, mint, amount, reference, memo, delegation, requestNonce: string \| null, paymentsCount` |
| `PaymentDenied` | `payee, destination, amount, reason: DenialReason, reasonCode, strike: boolean, strikes, tripped, reference, memo` |
| `PaymentRequested` | `request, nonce, payee, amount, reference, memo, expiresAt` |
| `RequestApproved` | `request, nonce` |
| `RequestRejected` | `request, nonce, by` |
| `RequestExpired` | `request, nonce` |

The SDK owns decoding (`decodeLeashEvents(transaction) → LeashEvent[]`); the indexer and tests reuse it. Nobody else parses raw event bytes.

## 7. Indexer API (`services/indexer`, prefix `/v1`)

### 7.1 REST

| Method and path | Response |
| --- | --- |
| `GET /v1/health` | `{ ok, cluster, programId, lastProcessedSlot, lastEventAt, lagSeconds }` |
| `GET /v1/owners/:owner` | `{ principal: PrincipalView \| null, agents: AgentView[] }` |
| `GET /v1/agents/:agent` | `{ agent: AgentView, payees: PayeeView[], requests: RequestView[] }` |
| `GET /v1/owners/:owner/events?agent&types&before&after&limit` | `{ items: LeashEvent[], nextBefore: string \| null }` |
| `GET /v1/agents/:agent/events?types&before&after&limit` | same |
| `GET /v1/owners/:owner/requests?status` | `{ items: RequestView[] }` |
| `GET /v1/owners/:owner/stats?window=1h\|24h\|7d` | `StatsView` |
| `GET /v1/guardians/:guardian/owners` | `{ owners: string[] }` (principals whose guardian is this key; used by Sentinel) |

- Cursors are event ids. `before` pages backwards (newest first, the default); `after` returns newer events in ascending order (used to fill gaps after a reconnect). `limit` defaults to 50, max 200. `types` is a comma-separated list of event types.
- Errors: HTTP 4xx/5xx with `{ "error": { "code": "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL", "message": string } }`.
- CORS: allow the web origin (`WEB_ORIGIN`). No authentication: the indexer only serves public on-chain data.

### 7.2 WebSocket `GET /v1/stream`

| Direction | Message |
| --- | --- |
| client → server | `{ "type": "subscribe", "owners": string[] }`, `{ "type": "unsubscribe", "owners": string[] }`, `{ "type": "pong" }` |
| server → client | `{ "type": "hello", "cluster", "serverTime" }` |
| server → client | `{ "type": "event", "event": LeashEvent }` |
| server → client | `{ "type": "agent", "agent": AgentView }` (after any change to that agent) |
| server → client | `{ "type": "ping" }` every 20 s, `{ "type": "error", "error": {...} }` |

Delivery is at-least-once, ordered by slot per owner. Clients dedupe by `event.id`, and after reconnecting they backfill with `GET …/events?after=<lastSeenId>`.

## 8. Agent tools (SDK, MCP server, demo agent)

One contract: `@leash/tools` implements it on top of `@leash/sdk` and `@leash/x402`; `@leash/mcp` exposes it over MCP; `apps/agent-demo` gives it to Claude. Tool names are exact.

| Tool | Input | Success output |
| --- | --- | --- |
| `leash_fetch` | `{ url: string (http or https; http is for local development), method?: "GET"\|"POST", headers?: Record<string,string>, body?: string, purpose: string }` | `{ ok: true, status, contentType, body (≤ 20 000 chars), payment: PaymentReceipt \| null }` |
| `leash_pay` | `{ to: string (wallet), amountUsdc: string, purpose: string }` | `{ ok: true, payment: PaymentReceipt }` |
| `leash_request_approval` | `{ to: string, amountUsdc: string, purpose: string }` | `{ ok: true, request: { address, nonce, expiresAt, status: "pending" } }` |
| `leash_status` | `{}` | `{ ok: true, agent: { label, status, freezeReason }, allowance: { remainingUsdc, perPeriodUsdc \| null, periodEndsAt \| null, expiresAt \| null }, limits: { maxPerPaymentUsdc, maxPerRequestUsdc }, payees: { label, wallet, maxPerPaymentUsdc \| null, remainingInPeriodUsdc \| null }[], strikes, tripwireMaxStrikes }` |

```ts
type PaymentReceipt = {
  signature: string; explorerUrl: string
  amountUsdc: string; payee: string; payeeLabel: string | null
  purpose: string; requestNonce: string | null
}

type ToolError = {
  ok: false
  code: ToolErrorCode      // denial codes from §4, or one of the codes below
  message: string          // safe to show the model; see rules below
  recorded: boolean        // true if the attempt is now on-chain (report_denied_attempt)
  strikes?: number
  frozen?: boolean
  retryable: boolean
}
// extra codes: UNSUPPORTED_PAYMENT (network/asset/scheme we can't pay), MERCHANT_REJECTED,
//              NETWORK_ERROR, INVALID_INPUT, NOT_PAIRED
```

**Tool message rules.** Messages steer the model to stop, not to route around the policy. A denial message states what was blocked and why, says the owner has been notified, and says not to retry through another route. Example for `PAYEE_NOT_ALLOWED`: *"Blocked by the owner's spending policy: this recipient is not on the allowlist. The attempt was recorded and the owner was notified. Do not retry or try another recipient; continue the task without paying, or ask the owner."* The exact strings live in `tools.ts`.

**Automatic behaviour in `leash_fetch`:** on `APPROVAL_REQUIRED` it creates a payment request and returns `APPROVAL_REQUIRED` with the request address in `message`. Once the request is approved, a later call to the same URL pays with it.

**Which denials are recorded on-chain** ([ADR](../adr/20260929-ws0-denial-reporting-policy.md)): the SDK sends `report_denied_attempt` before returning, and sets `recorded: true`, for every strike-type denial, and for every other denial except `approvalRequired` (which becomes a payment request instead). Non-strike denials are reported at most once per reason per agent every `NON_STRIKE_REPORT_COOLDOWN_SECS` (60 s), so a loop that hits the rate limit cannot flood the chain. The lists live in `tools.ts` (`REPORTED_DENIAL_CODES`).

## 9. x402 profile (how Leash payments travel over x402 v2)

| Item | Rule |
| --- | --- |
| Protocol | x402 v2 through the official packages: `@x402/core`, `@x402/svm`, `@x402/hono`, `@x402/fetch`. Never hand-roll headers or encodings. |
| Headers | `PAYMENT-REQUIRED` (server → client, the 402 challenge), `PAYMENT-SIGNATURE` (client → server), `PAYMENT-RESPONSE` (server → client) |
| Accepted requirements | `scheme: "exact"`, `network` = configured CAIP-2, `asset` = the agent's mint, `extra.feePayer` present. Anything else → `UNSUPPORTED_PAYMENT`. |
| Transaction | Versioned (v0), fee payer = `extra.feePayer`, instructions exactly: `SetComputeUnitLimit`, `SetComputeUnitPrice`, `leash::pay`, `Memo`. Signed only by the agent key; the fee-payer signature is left empty. |
| Memo | `extra.memo` if the merchant sent one, otherwise hex of 16 random bytes. No signer accounts on the Memo instruction. |
| Leash `pay` args | `amount` = requirement amount; `reference` per §3; `memo` = the tool's `purpose` |
| Compute budget | Simulate with a limit of 400 000, then set `ceil(unitsConsumed × 1.15)` (max 400 000). Price: `LEASH_PRIORITY_FEE_MICROLAMPORTS` (default 1, max 50 000). |
| Facilitator | `ExactSvmScheme` from `@x402/svm/exact/facilitator` with `{ enableSmartWalletVerification: true, smartWalletAllowedPrograms: [...X402_DEFAULT_SMART_WALLET_PROGRAMS, LEASH_PROGRAM_ID], smartWalletMaxComputeUnits: 400_000, smartWalletMaxPriorityFeeMicroLamports: 50_000 }` |
| Default allowlist (copied from `@x402/svm` 2.27) | Squads v4 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, Squads Smart Account `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG`, Swig `SWiGmQedKzMz1tiTqoJCWeGDnGXfNBp2PkXLkpCAtQo`, Swig v2 `swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB`, SPL Governance `GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw`, Metaplex Core `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`, Lighthouse (`LIGHTHOUSE_PROGRAM_ADDRESS` from the package) |

Why this works: the facilitator's static path rejects our transaction (unknown program at index 2). Its smart-wallet path then accepts it because Leash is on the allowlist, and simulation shows exactly one matching `TransferChecked` (Subscriptions → Token CPI) and a fee payer that appears in no instruction. See [ADR-0003](../adr/0003-x402-via-official-facilitator.md).

## 10. Solana Actions (Blinks) (`apps/web`)

| Route | Transaction the POST returns | Who may sign (enforced on-chain) |
| --- | --- | --- |
| `GET/POST /api/actions/freeze?agent=<agentPda>` | `freeze_agent` | owner or guardian |
| `GET/POST /api/actions/freeze-all?owner=<owner>` | `freeze_principal` | owner or guardian |
| `GET/POST /api/actions/approve?request=<requestPda>` | `approve_request` | owner |
| `GET/POST /api/actions/reject?request=<requestPda>` | `reject_request` | owner or guardian |

- `GET /actions.json` → `{ "rules": [{ "pathPattern": "/api/actions/**", "apiPath": "/api/actions/**" }] }`
- GET returns `{ type: "action", icon, title, description, label }`. POST body `{ account }` returns `{ type: "transaction", transaction: <base64 v0 tx>, message }`.
- Response headers on every route: Actions CORS headers, `X-Action-Version` (the current Actions spec version; WS6 checks it), `X-Blockchain-Ids: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- Types live in `actions.ts`. We do not depend on `@solana/actions` (it pulls in web3.js v1).

## 11. Pairing link

`{WEB_URL}/pair?agentKey=<base58>&label=<urlencoded, ≤ 32 bytes UTF-8>&preset=<presetId>&cluster=<localnet|devnet>`

The agent runtime prints it (and a terminal QR code) when its Agent PDA does not exist yet, then polls until it does. The web app pre-fills the wizard from the preset; the owner can change everything before signing.

Presets (`presets.ts`):

| id | Allowance | `maxPerPayment` | `maxPerRequest` | Velocity | Tripwire | Payees |
| --- | --- | --- | --- | --- | --- | --- |
| `research-assistant` | 5 USDC per day, 30 days | 1 USDC | 5 USDC | 30 per 60 s | 3 strikes per 600 s | merchant-demo wallet (max 2 USDC per payment, 3 USDC per day) |
| `custom` | owner enters everything | | | | | |

## 12. Alerts (`services/sentinel`)

```ts
type Alert = {
  id: string
  severity: "info" | "warning" | "critical"
  kind: "tripwire_fired" | "burst_denials" | "approval_requested" | "spend_spike"
      | "new_payee_spend" | "allowance_low" | "guardian_freeze"
  owner: string
  agent: string | null
  title: string                // ≤ 80 chars
  body: string                 // ≤ 500 chars, plain text
  actions: { label: string; url: string }[]   // web deep links and Action URLs
  eventIds: string[]
  createdAt: number
}
```

## 13. Environment variables

`LEASH_*` variables are shared; the others belong to one service. Each app ships an `.env.example` listing exactly the variables it reads. Keypair variables hold **file paths**, never secrets.

| Variable | Used by | Default | Meaning |
| --- | --- | --- | --- |
| `LEASH_CLUSTER` | all | `localnet` | `localnet` or `devnet` |
| `LEASH_RPC_URL` / `LEASH_WS_URL` | all | per cluster | Override RPC endpoints (e.g. a Helius devnet URL) |
| `LEASH_PROGRAM_ID` | all | from `config.ts` | Override the Leash program ID |
| `LEASH_SUBSCRIPTIONS_PROGRAM_ID` | all | canonical | Override for a devnet fallback deployment |
| `LEASH_USDC_MINT` | all | per cluster | Override the mint |
| `LEASH_PRIORITY_FEE_MICROLAMPORTS` | sdk, x402 | `1` | |
| `INDEXER_PORT` | indexer | `4100` | |
| `INDEXER_DB_URL` | indexer | `file:./data/indexer.db` | libSQL URL |
| `INDEXER_BACKFILL_LIMIT` | indexer | `1000` | Signatures fetched at startup |
| `INDEXER_SOURCE` | indexer | `chain` | `chain`, or `fixtures` to replay `fixtures/demo-storyline.json` without a chain |
| `INDEXER_POLL_INTERVAL_MS` | indexer | `15000` | Backfill polling interval (covers WebSocket gaps) |
| `INDEXER_REPLAY_SPEED` | indexer | `1` | Fixture mode: `1` real time, `10` ten times faster, `0` everything at once |
| `INDEXER_REPLAY_LOOP` | indexer | `true` | Fixture mode: replay the storyline again after it ends |
| `WEB_ORIGIN` | indexer, facilitator | `http://localhost:3000` | CORS |
| `FACILITATOR_PORT` | facilitator | `4200` | |
| `FACILITATOR_FEE_PAYER_KEYPAIR` | facilitator | – | Path to the fee-payer keypair JSON |
| `MERCHANT_PORT` | merchant-demo | `4300` | |
| `MERCHANT_PAY_TO` | merchant-demo | – | Merchant wallet (receives payments) |
| `MERCHANT_FACILITATOR_URL` | merchant-demo | `http://localhost:4200` | |
| `LAB_ATTACKER_WALLET` | merchant-demo | – | Wallet the adversarial lab tries to get paid |
| `MERCHANT_PAYMENTS` | merchant-demo | `on` | `off` serves paid routes for free (development before the x402 layer is ready) |
| `SENTINEL_INDEXER_URL` | sentinel | `http://localhost:4100` | |
| `SENTINEL_GUARDIAN_KEYPAIR` | sentinel | – | Path; the key must be set as guardian on the principals it protects |
| `SENTINEL_AUTOFREEZE` | sentinel | `false` | Allow rule-triggered guardian freezes |
| `SENTINEL_WEB_URL` | sentinel | `http://localhost:3000` | For links in alerts |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | sentinel | – | Alerts are logged only if unset |
| `AGENT_KEYPAIR` | agent-demo, mcp | `~/.config/leash/agent.json` | Path; created on first run if missing |
| `AGENT_OWNER` | agent-demo, mcp | – | Owner wallet whose principal holds this agent |
| `AGENT_MODE` | agent-demo | `llm` | `llm` (Claude) or `scripted` (deterministic replay) |
| `AGENT_MODEL` | agent-demo | `claude-opus-5-5` | Any current Claude model ID |
| `ANTHROPIC_API_KEY` | agent-demo | – | |
| `AGENT_MERCHANT_URL` | agent-demo | `http://localhost:4300` | |
| `NEXT_PUBLIC_LEASH_CLUSTER`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_INDEXER_WS_URL`, `NEXT_PUBLIC_APP_URL` | web | per cluster | Browser-visible config |
| `NEXT_PUBLIC_DATA_SOURCE` | web | `indexer` | `indexer`, or `fixtures` to build the UI without any backend |
| `LOG_LEVEL` | all services | `info` | pino log level |

## 14. Fixtures and test vectors

- `fixtures/owner-overview.json` (a `GET /v1/owners/:owner` response), `fixtures/agent-detail.json`, `fixtures/requests.json`, `fixtures/stats-24h.json`, and `fixtures/demo-storyline.json`: the full event sequence of the pitch demo (normal payments, approval, injection, three strikes, tripwire). The UI, indexer and Sentinel are all built against these before the chain is live.
- Since contracts 1.1.0 the storyline also carries `accounts`: each agent's Subscriptions delegation as created, and the address of each allowlist entry. No event says either, and the indexer needs both to rebuild the views ([ADR](../adr/20260930-ws4-fixture-replay.md)). Replaying the storyline must reproduce the four view fixtures exactly; the indexer's tests check this.
- `test-vectors/policy.json`:

```json
{
  "version": 1,
  "keys": { "owner": "…", "agentKey": "…", "merchant": "…", "attacker": "…" },
  "cases": [
    {
      "name": "allowlisted payee within all limits is allowed",
      "now": 1790000000,
      "principal": { "frozen": false },
      "agent": { "status": "active", "policy": { "...": "PolicyView" }, "stats": { "...": "AgentStatsView" } },
      "payee": { "payee": "merchant", "maxPerPayment": "0", "periodLimit": "0", "periodSecs": 0, "periodStart": 0, "spentInPeriod": "0" },
      "request": null,
      "delegation": { "kind": "recurring", "amountPerPeriod": "5000000", "periodLengthSecs": 86400, "currentPeriodStart": 1789990000, "pulledInPeriod": "0", "expiresAt": 0 },
      "sourceAmount": "100000000",
      "payment": { "amount": "10000", "destinationOwner": "merchant" },
      "expect": { "outcome": "allowed" }
    }
  ]
}
```

The exact format is `PolicyTestVectorsSchema` in `src/test-vectors.ts`, which supersedes the example above. `expect` is one of `{ outcome: "allowed", effects? }`, `{ outcome: "denied", reason: "<DenialReason JSON>" }` or `{ outcome: "error", error: "<LeashError variant>" }`; `effects` lists post-payment counters to check. Symbolic names in `keys` map to deterministic test keypairs whose ed25519 seed is `sha256("leash:test-key:" + name)`. Time fields use on-chain semantics: 0 means "never started" or "no expiry". WS0 writes the first cases from [01-onchain-program.md §7](01-onchain-program.md#7-evaluation) (at least one per check, plus boundary cases at exactly the limit). WS1 and WS2 add cases whenever they find an edge; a case is never deleted.
