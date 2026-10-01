# WS6 (Actions) status: Solana Actions (Blinks)

A carved-out part of WS6: Task C of the second account's [work queue](../messages/20261001-1200-from-architect-to-second-account-work-queue.md).

- Session branch: `claude/compassionate-keller-5rmytv`
- Last updated: 2026-10-01
- Current step: building (plan approved by the architect session)
- Lane:
  - `apps/web/src/app/api/actions/**`
  - `apps/web/src/app/actions.json/**`
  - `apps/web/src/server/actions/**`
  - `apps/web/test/actions*.test.ts`
  - `apps/web/package.json` (dependencies)
  - `"actionLinks"` in `services/sentinel/sentinel.config.json`
  - this file

## Plan (approved)

1. **Layout.**
   - Thin route handlers (GET, POST, OPTIONS) in `apps/web/src/app/api/actions/{freeze,freeze-all,approve,reject}/route.ts`, and `apps/web/src/app/actions.json/route.ts`.
   - The logic lives in `apps/web/src/server/actions/` as functions of `(request, deps)`, with `deps = { chain: LeashChain, webUrl }`, so tests inject the LiteSVM testbed's chain.
   - Production uses `rpcChain` on `resolveClusterConfig(env.NEXT_PUBLIC_LEASH_CLUSTER, { rpcUrl: env.NEXT_PUBLIC_RPC_URL }).rpcUrl`.
   - No new env variables: `env.ts` belongs to session 1.
2. **Headers on every response**, errors and OPTIONS included:
   - `ACTIONS_CORS_HEADERS`;
   - `X-Action-Version: 2.4` (`@solana/actions-spec` 2.4.2 on npm; the header takes major.minor);
   - `X-Blockchain-Ids: ACTIONS_BLOCKCHAIN_ID`.
3. **GET for a Blink client** (an `Accept` without `text/html`) returns `{ type: "action", icon, title, description, label }`, described from the chain through `@leash/sdk`:
   - approve: "Approve 1.50 USDC to Research API" (the payee label, else a short address); the description names the agent and quotes the memo;
   - reject: the same wording with "Reject";
   - freeze: "Freeze <agent label>"; freeze-all: "Freeze all agents".
   - Labels and memos are untrusted: control and format characters are stripped, and the text is clipped.
   - An agent or principal already frozen, or a request that is not pending: `disabled: true`, with a description saying why.
   - `icon`: an SVG of the web app's purple "L", served by `api/actions/icon`. Its URL is absolute, from `NEXT_PUBLIC_APP_URL`, else the request's origin.
4. **GET from a browser** (`Accept` includes `text/html`) redirects with 302 to the web app: approve and reject to `/app/approvals`, freeze to `/app/agents/<agent>`, freeze-all to `/app`.
5. **POST `{ account }`:**
   - parse the body (`ActionPostRequestSchema`) and the query (`ActionQuerySchemas`);
   - read the accounts with `fetchRequestView`, `fetchAgentView` and `fetchPrincipalView`;
   - check the signer before building: approve needs the owner; freeze, freeze-all and reject need the owner or the principal's guardian; anyone else gets 403;
   - build with the SDK builders and `createNoopSigner(account)`, then `buildTransactionMessage` (fee payer = account, `chain.getLatestBlockhash()`), `compileTransaction`, `getBase64EncodedWireTransaction`;
   - answer `{ type: "transaction", transaction, message }`. The server never signs (I6).
6. **Errors** are `{ message }` (`ActionErrorSchema`):
   - 400: a bad query or body;
   - 403: a signer who may not sign;
   - 404: a missing request, agent or principal;
   - 409: already frozen, or not pending;
   - 502: the RPC is unreachable.
7. **Tests** (`apps/web/test/actions.test.ts`, on the testbed of `@leash/sdk/testing`):
   - each action's GET and POST;
   - the returned transaction, signed by the right key, succeeds on-chain;
   - a wrong signer gets 403, and a direct wrong-authority transaction fails on-chain;
   - 400s, headers everywhere, `actions.json`, the browser redirect, and no signatures in the returned transaction.
8. **Order:** headers, `actions.json`, the icon, freeze and freeze-all first; then approve and reject, which need `fetchRequestView` in `@leash/sdk`.
9. **Then** `"actionLinks": true` in `sentinel.config.json`, with Sentinel's tests still passing.
10. **README:** `apps/web/src/server/actions/README.md`, including the laptop's phone demo through a cloudflared tunnel and `dial.to`.

## Done
- Plan recorded.

## Next
- Build steps 1–8 in the order above.

## Open items
- `fetchRequestView` is on the architect's branch (`864dcb5`), not yet on `main`.

## Questions for other workstreams
- None.
