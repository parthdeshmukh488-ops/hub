# The security model states where the devnet upgrade authority really is

- Status: Accepted by Parth, 2026-10-03 (applied to 03-security T15)
- Date: 2026-10-03 (recorded by the architect)
- Workstream: WS1
- Contract change: no

## Context

03-security's threat T15 (upgrade authority compromised) says: "Devnet: deployer key kept offline."

The [WS1 status](../workstreams/status/WS1.md) records what was done on 2026-09-30:
- the upgrade authority of the devnet program is the deployer key `99ngrThAhTqUPshHsXifwRXi2wgwjemZG8ehDtW1CKkS`;
- that is the laptop's Solana CLI default key, kept out of the repo, with a backup held by Parth.

A key on a laptop that signs deployments is not offline. The security model must not claim more than is true: judges read it, and our pitch says we state our limits openly.

## Decision

Replace T15's mitigation for devnet with:

> Devnet: the upgrade authority is the deployer key on Parth's laptop (the Solana CLI key), kept out of the repo, with a backup. Whoever holds it could replace the program. Pitch/production: a timelocked multisig, or a revoked authority.

Nothing else changes. The program, the deployment and the pitch's roadmap (an audit, then a multisig or revoked authority before mainnet) already match it.

## Consequences

- The security model says exactly what protects the devnet program today.
- Moving the authority to a multisig stays on the roadmap; it is not needed for a devnet demo with no real money.

## Alternatives considered

- **Move the authority to a cold key now.** Lost for the hackathon: every program fix would need the cold key. On devnet, with no real funds, the honest sentence is enough.
