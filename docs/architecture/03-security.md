# Security model

Leash is a security product, so the judges' first technical question will be "what can still go wrong?". This document is the honest answer, and the checklist every workstream designs against.

## 1. Assets and adversaries

**Assets:** the owner's tokens, the owner's control over their agents, and the integrity of the audit trail.

| Adversary | Capability we assume |
| --- | --- |
| **Content attacker** | Controls text the agent reads (web pages, API responses, messages). Cannot touch the agent host. *The main threat.* |
| **Malicious merchant** | Runs an x402 endpoint: sets any price and any `payTo`, returns any content |
| **Host attacker** | Steals the agent key (compromised server, leaked env file) |
| **Service attacker** | Compromises the indexer, Sentinel or facilitator |
| **Phisher** | Tricks the owner into opening a link or signing a transaction |

Out of scope: a compromised owner wallet (use a hardware wallet or a multisig as the owner), and bugs in Solana itself or in audited SPL programs.

## 2. Threats and mitigations

| # | Threat | Mitigation | Residual risk |
| --- | --- | --- | --- |
| T1 | **Prompt injection** makes the agent pay the attacker | The allowlist blocks non-listed payees (I2). Every blocked attempt is a strike; three strikes freeze the agent (I4). Tool messages tell the model to stop, not to retry. Large payments need owner approval. | The model may still do useless *allowed* things (e.g. buy allowed data it didn't need), bounded by the limits |
| T2 | **Runaway loop**: a buggy agent pays again and again | Velocity limit, per-payee period limits, allowance ceiling (I1) | Spend up to the configured limits |
| T3 | **Agent key stolen** | The key holds no funds and can only pay allowlisted payees within limits. The owner freezes the agent or revokes the delegation. | The thief can spend up to the limits, but only to allowlisted merchants, which are legitimate businesses, not the thief |
| T4 | **Merchant overcharges** in its 402 challenge | Per-payment and per-payee caps. Requests above the instant limit need approval. | None beyond the caps |
| T5 | **Allowlisted merchant's `payTo` swapped** to an attacker | Leash checks the **owner of the destination token account** against the allowlist, not the merchant's URL | None |
| T6 | **Account substitution**: another agent's payee entry, another owner's delegation, a wrong mint or token program | Explicit checks in `pay` and `report_denied_attempt` ([01 §6.2](01-onchain-program.md#62-agent-instructions)); account-substitution tests ([01 §11](01-onchain-program.md#11-testing-requirements)) | None if the tests pass |
| T7 | **Fake strikes** used to frame an agent | `report_denied_attempt` re-evaluates the policy and fails if the payment would be allowed. Only the agent key can report. | Someone holding the agent key can freeze the agent (fail-safe, see T12) |
| T8 | **Facilitator fee griefing**: failing transactions drain its SOL | The official scheme simulates before settling, enforces fee-payer isolation and caps compute units and priority fees. Rate limits per client IP. | Small SOL loss under attack (devnet) |
| T9 | **Replay** of a payment transaction | Blockhash expiry, the facilitator's settlement cache, and the x402 memo nonce. The SDK is idempotent per `reference`. | None known |
| T10 | **Owner phishing**: a malicious link asks the owner to sign a harmful transaction | The web app shows a plain-language summary before every signature. Actions only build Leash instructions for accounts owned by the signer. Pairing shows the agent key fingerprint for comparison. | An owner who ignores the summary can still be tricked |
| T11 | **Pairing-link hijack**: the attacker's agent key gets paired | The pairing page asks the owner to compare the key fingerprint with what their agent printed. Low default budgets. The allowlist still applies. | Bounded by the limits and allowlist |
| T12 | **Strike DoS**: an attacker deliberately freezes an agent | Accepted as fail-safe: a frozen agent is better than a drained one. The owner is alerted and can raise the threshold. | Availability loss until the owner acts |
| T13 | **Indexer lies or is stale** | The indexer is read-only convenience. Before any owner signature, the web app re-reads the accounts from RPC. The chain enforces everything. | Wrong display, never wrong enforcement |
| T14 | **Sentinel compromised** | The guardian key can only freeze and reject requests. It cannot unfreeze, pay or change policy. | DoS by freezing |
| T15 | **Upgrade authority compromised** | Devnet: deployer key kept offline. Pitch/production: timelocked multisig or revoked authority. | Stated openly in the pitch |
| T16 | **Subscriptions program changes** | Pinned to the audited v0.5 line. Leash refuses delegation accounts with `version != 1`. Any semantic change makes the CPI fail (fail closed). | Liveness, not safety |
| T17 | **Secrets reach the model** | The agent key lives in a file; tools and the MCP server never return key material; logs redact it | None |
| T18 | **Stored XSS** through labels or memos (owner- or agent-controlled strings) | Render as text only; escape in Telegram messages; zod length limits | None if escaping is tested |
| T19 | **Clock skew** | Validator time can drift by seconds. Windows are coarse (minutes to days). | Negligible |
| T20 | **Request spam** | `MAX_OPEN_REQUESTS = 8`; requests need an allowlisted payee; rent is paid by the requester | None |

## 3. Invariant tests

Each invariant gets named tests. WS9 wires them into one "security" CI job so the pitch can say "these run on every commit".

| Invariant | Test (where) |
| --- | --- |
| I1 Hard ceiling | Property test: random sequences of `pay` by the agent key never transfer more than the delegation's allowance (program, LiteSVM) |
| I2 Firewall | A non-allowlisted destination never receives funds, whatever combination of optional accounts is passed (program) |
| I2 Firewall | `report_denied_attempt` never changes any token balance (program) |
| I3 Off switch | After `freeze_agent` or `freeze_principal`, every `pay` fails; the guardian cannot unfreeze (program) |
| I4 Tripwire | `tripwireMaxStrikes` strike reports within the window freeze the agent; non-strike denials never do (program + test vectors) |
| I5 Audit | Every successful `pay` emits exactly one `PaymentExecuted`; every report emits exactly one `PaymentDenied` (program); the indexer stores both (indexer) |
| I6 Non-custodial | Static check: no service config contains an owner key; guardian and fee-payer keys are the only server keys (WS0 CI script) |
| Parity | The TypeScript evaluator and the program agree on every case in `test-vectors/policy.json` (SDK + program) |
| x402 | The official facilitator, configured per [02 §9](02-contracts.md#9-x402-profile-how-leash-payments-travel-over-x402-v2), verifies and settles a Leash payment, and rejects a denied one (x402, LiteSVM or localnet) |

## 4. Program security checklist (WS1, reviewed again by WS9)

- [ ] Every signer is checked (agent key vs `agent.agent_key`, owner vs `principal.owner`, guardian vs `principal.guardian`).
- [ ] Every PDA is verified with its canonical bump; bumps are stored and reused.
- [ ] Every foreign account's owner program is checked (token accounts, mint, delegation, Subscription Authority).
- [ ] The CPI target program ID is checked against the constant.
- [ ] All arithmetic is checked (`checked_add`, `checked_sub`, `saturating_*` only where specified).
- [ ] Closed accounts are zeroed and their lamports moved; no re-initialization path.
- [ ] No `UncheckedAccount` without a comment explaining why and the manual checks performed.
- [ ] Optional accounts: `None` behaves exactly as specified.
- [ ] `pay` has no path that returns `Ok` without a transfer.
- [ ] The compute budget of `pay` is measured and recorded.

## 5. Key management

| Key | Where it lives | Notes |
| --- | --- | --- |
| Owner | The owner's wallet | Never touches our servers |
| Agent | `AGENT_KEYPAIR` path on the agent host (default `~/.config/leash/agent.json`, mode 600) | Generated locally on first run |
| Guardian | `SENTINEL_GUARDIAN_KEYPAIR` path | Optional; set on-chain with `set_guardian` |
| Facilitator fee payer | `FACILITATOR_FEE_PAYER_KEYPAIR` path | Holds a little devnet SOL only |
| Program deployer / upgrade authority | Local, outside the repo | |

Repository rules: `.keys/`, `*.keypair.json` and `.env*` (except `.env.example`) are gitignored. CI fails if a 64-byte JSON keypair array is committed (WS0 adds the check).

## 6. What we say in the pitch

"Leash is fail-closed and non-custodial. Your money never leaves your wallet, and the most any agent can ever spend is the allowance you set in Solana's own audited program. Leash can only make that smaller. It doesn't matter if the model is fooled: the rules live on-chain, not in the prompt."
