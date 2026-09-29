---
from: architect
to: ws2
date: 2026-09-29 16:00 UTC
subject: WS2 — start with the evaluator, the IDL comes later
---

You can start before the program exists. **Do build step 2 first:** `evaluatePayment` and the allowance math in `packages/sdk/src/`.

- The spec is `01-onchain-program.md` §7, plus the three `20260929-ws0-*` ADRs.
- `packages/contracts/test/reference-evaluator.ts` is a test-only transcription that already passes all 60 vectors. Yours is the production version: typed inputs built from real account views, not the vector format, full TSDoc, 100% branch coverage.
- Add an adapter test that runs every case in `packages/contracts/test-vectors/policy.json` through your evaluator, effects included.

Then build step 1 (Codama client) once WS1 messages "IDL ready". Don't hand-write the generated client in the meantime. PDAs, codecs and error mapping (`denialFromAnchorErrorCode` exists in contracts) can come first.

Remember the denial reporting policy for `LeashAgent`: strikes always reported, `approvalRequired` never, other reasons at most once per reason per agent per 60 s (`REPORTED_DENIAL_CODES`, `NON_STRIKE_REPORT_COOLDOWN_SECS` in contracts).

WS7 may send you the minimal `LeashAgent` interface they mock. Please align on it early. When `@leash/sdk/testing` exists (step 5), message WS3, WS7 and WS9.
