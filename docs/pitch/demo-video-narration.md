# Demo video: narration

The voice-over of [leash-demo-devnet.mp4](leash-demo-devnet.mp4) (2:21, 1080p, watermarked "Leash · Parth Deshmukh"), part by part. It was generated with OpenAI's `gpt-4o-mini-tts` (voice "onyx") at a normal speaking pace, about 160 words a minute. Read it aloud to record the narration in your own voice.

What the video shows:
- The terminal part replays every line the demo agent printed during a real devnet take on Oct 3, 2026, at its real timing. The owner's wait runs at 4×, labelled on screen.
- The phone clip is Parth's screen recording of Sentinel's real Telegram alerts.
- The on-chain cards are read from devnet with `getTransaction`.
- The control panel shots are sample data of the same story, labelled.

## Title card

AI agents can pay for things now. But what happens when an agent gets fooled? Meet Leash, built by Parth Deshmukh.

## Landing page

Leash is a spending firewall for AI agents on Solana. You give your agent a budget, not your wallet.

## Control panel (sample data)

This is the owner's control panel. It shows every agent, how much of its budget is left, and every payment Leash blocked.

## Scene 1: normal work (real devnet take)

Here's a live run on Solana devnet. Our research agent has five dollars a day. It pays an allowlisted research API a cent or two per call, over x402. Each payment is a real transaction, checked on-chain by the Leash program before any money moves.

## Scene 2: above the limit, the owner approves

Now the agent wants a premium report for a dollar fifty. That's above its one-dollar instant limit, so it can't pay on its own. It sends an approval request instead. The owner approves, and exactly that payment, to that merchant, for that amount, goes through once.

## Scene 3: the attack and the tripwire

Then a buying guide hides an instruction to tip a stranger twenty-five dollars. The fooled agent tries three times. Leash blocks every attempt and records a strike on-chain. After the third strike, the agent freezes itself.

## The owner's phone: Sentinel's Telegram alerts

At the same time, Sentinel follows the chain and alerts the owner on Telegram: when a payment needs approval, and the moment the tripwire fires. From there, the owner can review, approve, or freeze.

## Control panel: approvals inbox (sample data)

In the control panel, payments above the limit wait in this inbox. Approving lets exactly that payment through, once.

## Control panel: the frozen agent (sample data)

Here's the frozen agent: three strikes, all recorded on-chain. Only the owner can unfreeze it.

## On-chain: the approved payment

On-chain, the owner's U S D C went straight to the merchant, through Solana's audited Allowances program. The agent never held the money, and the facilitator paid the fee.

## On-chain: the tripwire freeze

The third blocked attempt is on-chain too. It tripped the wire and froze the agent. The attacker got nothing.

## End card

The model was fooled, but the money wasn't moved. Leash: spending limits and an off switch for AI agents, enforced on Solana. The code is open source on GitHub.
