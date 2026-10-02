# Solana Actions (Blinks)

Leash's owner actions as [Solana Actions](https://solana.com/docs/advanced/actions) ([02-contracts §10](../../../../../docs/architecture/02-contracts.md#10-solana-actions-blinks-appsweb)). A wallet, a Blink client or a tap on a Sentinel alert can then approve a payment or pull the brake. The server describes the action and builds an **unsigned** transaction; the wallet signs it. The server never holds a key (I6), and the program checks every signer anyway (01 §6.1).

| Route | Transaction (POST) | Who may sign |
| --- | --- | --- |
| `GET/POST /api/actions/freeze?agent=<agent PDA>` | `freeze_agent` | owner or guardian |
| `GET/POST /api/actions/freeze-all?owner=<owner>` | `freeze_principal` | owner or guardian |
| `GET/POST /api/actions/approve?request=<request PDA>` | `approve_request` | owner |
| `GET/POST /api/actions/reject?request=<request PDA>` | `reject_request` | owner or guardian |
| `GET /actions.json` | – | `ACTIONS_JSON`: tells Blink clients the routes above are Actions |
| `GET /api/actions/icon` | – | the purple "L" (SVG) |

## What each request gets

**Every response** carries `ACTIONS_CORS_HEADERS`, `X-Action-Version: 2.4` and `X-Blockchain-Ids` (devnet). That includes errors, redirects and `OPTIONS`.

**GET from a Blink client** (an `Accept` without `text/html`) gets `{ type: "action", icon, title, description, label }`, read from the chain through `@leash/sdk`:
- approve: "Approve 1.50 USDC to Research API". The payee's allowlist label is used, else its short address. The description names the agent and quotes the memo.
- reject: the same, with "Reject".
- freeze: "Freeze Research Assistant"; freeze-all: "Freeze all agents".
- Labels and memos are untrusted (a manipulated agent writes the memo): control and format characters such as bidi overrides are stripped, and the text is clipped.
- **Disabled**, with the reason as the description: an agent or principal already frozen; for approve, a request already approved or expired (from its `expiresAt` second on, as the program counts).
- **Reject also works on an approved request** that is not paid yet: it withdraws the approval, and the description says so.

**GET from a browser** (`Accept: text/html`) is redirected (302) to the web app:
- approve and reject → `/app/approvals`;
- freeze → `/app/agents/<agent>`;
- freeze-all → `/app`.

A tap on a Sentinel link in Telegram therefore opens the app, not raw JSON.

**POST `{ "account": "<wallet>" }`** gets `{ type: "transaction", transaction, message }`:
- `transaction` is a base64 v0 transaction with fee payer `account` and a recent blockhash, built with the SDK's builders and no signatures.
- The server checks the signer first, so a wallet that may not sign gets a clear 403 instead of a failing transaction.

**Errors** are `{ "message": "…" }`:

| Status | When |
| --- | --- |
| 400 | Bad query (`?agent=` etc. is not an address) or body |
| 403 | `account` may not sign this (the message says who may) |
| 404 | No such agent or principal; a request that was executed, rejected or expired |
| 409 | Already frozen; for approve, already approved or expired |
| 502 | The Solana RPC is not reachable |

## Code

| File | Role |
| --- | --- |
| `route-handlers.ts` | `actionHandlers(definition, deps)` → `GET`, `POST`, `OPTIONS`: parsing, headers, errors, redirect, the unsigned transaction |
| `freeze.ts`, `freeze-all.ts`, `approve.ts`, `reject.ts` | One definition each: `describe` (the GET) and `build` (who may sign, then the instructions) |
| `reads.ts`, `request.ts` | Chain reads through the SDK, with the 404s; the request's words and why it may be blocked |
| `transaction.ts` | `createNoopSigner(account)` for the builders, and the base64 wire transaction |
| `http.ts`, `text.ts`, `icon.ts` | Headers and responses; safe text; the icon |
| `deps.ts` | Production: `rpcChain` on `NEXT_PUBLIC_RPC_URL` (else the cluster's default), links from `NEXT_PUBLIC_APP_URL` (else the request's origin) |

The route files in `src/app/api/actions/*/route.ts` and `src/app/actions.json/route.ts` only wire a definition to `productionDeps`.

## Test

```bash
pnpm --filter @leash/web test -- actions
```

`test/actions.test.ts` runs every route on the LiteSVM testbed (`@leash/sdk/testing`, the real `leash.so`). For each action:
- the GET parses as `ActionGetResponseSchema`;
- the POST's transaction has no signatures;
- signed by the right key (owner, or guardian where allowed), it succeeds on-chain and changes the state;
- a wrong signer gets 403, and the same instruction built by hand with that signer fails on-chain.

It also covers disabled states and 409s, 400s and 404s, the browser redirect, `OPTIONS`, `actions.json`, the icon, and a memo with bidi and control characters.

## Demo on a phone (laptop)

Telegram only makes buttons of public https links, and Blink clients need a public URL. A tunnel gives the local web app one:

```bash
cloudflared tunnel --url http://localhost:3000        # prints https://<random>.trycloudflare.com
```

Then start the web app and Sentinel with that URL:

```bash
NEXT_PUBLIC_APP_URL=https://<random>.trycloudflare.com NEXT_PUBLIC_LEASH_CLUSTER=devnet pnpm --filter @leash/web dev
SENTINEL_WEB_URL=https://<random>.trycloudflare.com ... pnpm --filter @leash/sentinel start
```

- **Telegram:** with `"actionLinks": true` in `services/sentinel/sentinel.config.json`, Sentinel's alerts carry Approve, Reject and Freeze buttons that point at these routes. Tapped in Telegram, a button opens the web app (the browser redirect).
- **A Blink client** (any Actions-aware wallet, or dial.to) opens an action as:
  `https://dial.to/?action=solana-action:<URL-encoded action URL>&cluster=devnet`
  For example, the action URL `https://<random>.trycloudflare.com/api/actions/approve?request=<request PDA>`. It shows the title and the button; the wallet signs; the agent can pay.
