# Leash is a policy firewall on top of the Solana Foundation Subscriptions program

- Status: Accepted
- Date: 2026-09-29
- Workstream: architecture
- Contract change: n/a (founding decision)

## Context

- On June 2, 2026 the Solana Foundation shipped **Subscriptions & Allowances** (program `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`): open source (MIT), written in Pinocchio, audited by Cantina (baseline through `d6b3a5dc`, 2026-07-30), live on mainnet, with a Codama TypeScript client `@solana/subscriptions` (0.5.0).
- Its model: for each `(user, mint)` a Subscription Authority PDA becomes the single SPL delegate of the user's token account. **Fixed** delegations (a total cap with optional expiry) and **recurring** delegations (a per-period cap) authorize a *delegatee* to pull funds.
- From the source (`program/src/instructions/transfer_fixed_delegation.rs`): a delegation binds the delegatee and the mint, **not the destination**. The delegatee must sign (`SignerAccount::check`), so a PDA can be the delegatee through `invoke_signed`.
- The Superteam judges will know this program. Our idea (a budget plus an off switch for AI agents) overlaps with its "allowances for AI agents" use case. We have to show what we add, not rebuild what exists.

## Decision

1. The owner's budget for an agent **is** a Subscriptions delegation whose delegatee is the Leash **Agent PDA**. The allowance is the hard ceiling (invariant I1).
2. Leash never holds funds. Tokens stay in the owner's own token account until the moment of payment.
3. The only way the Agent PDA signs a Subscriptions transfer is Leash's `pay` instruction, after the firewall policy passed: payee allowlist, per-payment and per-payee limits, rate limit, expiry, freeze, approvals, tripwire.
4. Leash reads the delegation (layout v1) only to turn "budget exhausted" into a clean denial reason. The CPI remains the authority.

## Consequences

- **Pitch:** "Solana's Allowances decide how much. Leash decides who, how fast, and what happens when the agent is attacked." Composition with the Foundation's primitive reads as ecosystem fluency, not competition.
- **Security:** two independent layers. Even a Leash bug cannot exceed the audited allowance. No custody means no vault to drain.
- **UX:** onboarding needs one extra step: enable the Subscription Authority once per mint. The official client does it, and it can share a transaction with delegation creation (`UNKNOWN_INIT_ID`).
- **Coupling:** Leash depends on the Subscriptions account layout and instruction format (v0.5 line). Mitigation: version check (`version == 1`) and fail closed; pinned devnet/localnet binary in `artifacts/programs/`.
- **Local dev** needs the Subscriptions `.so` loaded into LiteSVM or the validator (WS0).
- The owner's allowance draws from the same token account the owner uses day to day. Owners who want isolation use a dedicated wallet as the Leash owner.

## Alternatives considered

1. **Own vault program** (Leash holds the agent's funds in a PDA). Maximum control, but it reinvents custody and budget periods the audited program already provides, and it invites "why not use Allowances?" with no good answer.
2. **Swig or Squads smart accounts** (both already on the x402 facilitator allowlist). Strong primitives, but role limits cannot express a tripwire, recorded denials or request approvals, and our differentiating logic would end up off-chain.
3. **Delegations only, no Leash program** (the agent key as delegatee, rules off-chain). Allowances don't restrict destinations, so a manipulated agent could pay the attacker up to the full allowance. No on-chain off switch without the owner's signature. Rejected: it fails the core promise.
