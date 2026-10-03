# Sentinel's rules skip what the owner or the program already handled

- Status: Proposed (implemented, on `main`)
- Date: 2026-10-03 (recorded by the architect; built in WS5's steps 1–5 and Task C)
- Workstream: WS5
- Contract change: no. The alert kinds and the `Alert` shape of 02 §12 are unchanged. This refines the rule table in the [WS5 brief](../workstreams/WS5-sentinel.md).

## Context

The WS5 brief's rule table was written before the rules met the demo story. Run against the storyline and the real program, three rules alerted on something the owner had chosen, or that the program had already dealt with. One of them would have made the guardian freeze more than the attack required:

- **`burst_denials`.** The storyline's injection makes three blocked attempts by one agent, and the third trips its tripwire.
  - Taken literally, the rule would also alert on that burst and, with autofreeze on, freeze the whole principal: every other agent of the owner, for an attack the program had already stopped.
  - `tripwire_fired` alerts on it anyway, at a higher severity.
- **`spend_spike` and `new_payee_spend`.** The 1.50 USDC report is paid through a request the owner approved. Counting it as a spike, or as a large first payment to a new payee, alerts the owner about their own decision.

## Decision

1. **`burst_denials`:** a burst whose denials all come from one agent whose tripwire fired does not alert (and so never freezes the principal). A burst across two or more agents still alerts and, with autofreeze on, freezes the principal: it may be one attack heading for the rest.
2. **`spend_spike` and `new_payee_spend`:** payments made through an approved request (`PaymentExecuted.requestNonce` set) are not counted.
3. **Action links on by default** (`actionLinks: true`): alerts carry the Solana Action URLs the brief lists (freeze, approve, reject; 02 §10). Turning them off leaves the web app links.
4. **Telegram messages are plain text with entities** (no `parse_mode`). Untrusted text (labels, memos) is defanged and stripped of bidi control characters. This is stronger than the brief's "escape every string": no markup is parsed at all.

## Consequences

- The storyline produces exactly the alerts the pitch describes: the approval request, then the tripwire. The guardian adds no second freeze.
- A single compromised agent that trips its wire leaves the owner's other agents running, which is what the tripwire is for.
- An owner who wants every burst alerted, tripped or not, can't configure that today. Add a setting if someone asks.

## Alternatives considered

- **Keep the literal rules and rely on cooldowns.** Lost: the cooldown is per rule, so the first burst still freezes the principal.
- **Let the guardian freeze only the agent on a burst.** Lost: for one agent the program already did that; for several, freezing them one by one is slower than `freeze_principal`.
