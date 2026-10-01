# WS6 (Actions) status: Solana Actions (Blinks)

A carved-out part of WS6: Task C of the second account's [work queue](../messages/20261001-1200-from-architect-to-second-account-work-queue.md).

- Session branch: `claude/compassionate-keller-5rmytv`
- Last updated: 2026-10-01
- Current step: built and tested; waiting on two decisions before the PR (see Open items)
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
- Plan recorded (first commit).
- **The four Actions, `actions.json` and the icon**, built as planned (`apps/web/src/server/actions/`, thin `route.ts` files):
  - freeze and freeze-all: owner or guardian;
  - approve: owner only, disabled when not pending or expired;
  - reject: owner or guardian, disabled when not pending.
  - Headers on every response; the browser redirect; errors 400/403/404/409/502 as `{ message }`; no signature in any returned transaction.
  - Labels and memos are stripped of `\p{Cc}`/`\p{Cf}` and clipped.
- **26 tests** in `apps/web/test/actions.test.ts` on the LiteSVM testbed (real `leash.so`):
  - every action, signed by each allowed key, succeeds on-chain and changes the state;
  - wrong signers get 403, and a hand-built instruction with that signer fails on-chain;
  - disabled states and 409s, 400s and 404s, the redirect, OPTIONS, `actions.json`, the icon, a memo with bidi and control characters.
  - The web app's whole suite passes: 66 tests.
- **README:** `apps/web/src/server/actions/README.md`, with the phone demo (cloudflared, `dial.to`).
- New dependencies of `@leash/web`: `@solana/kit` 8.4.0 (noop signer, compile, base64) and, dev, `litesvm` 1.5.0 (the testbed).
- **How approve and reject were tested:** against `fetchRequestView` from the architect's commit `864dcb5`, applied temporarily and not committed.

## Next
- Once `864dcb5` is on `main`: merge `main`, run `pnpm check`, open the PR into `main`.

## Open items
- **`fetchRequestView` is not on `main` yet** (architect's branch, `864dcb5`). Until it is, `apps/web` does not typecheck on this branch (`request.ts` imports it), so no PR yet. Parth: merge the architect's branch into `main`.
- **`"actionLinks": true` in `sentinel.config.json` breaks one Sentinel test.** `services/sentinel/test/config.test.ts` checks that the committed file equals the code defaults (`actionLinks: false`). Two fixes, both outside this lane:
  - (a) set the default to `true` in `services/sentinel/src/config.ts`, and change that test's "leaves Action links off" line;
  - (b) change the test to compare only the thresholds.
  Waiting for Parth's choice (or WS5's OK).

## Questions for other workstreams
- None.
