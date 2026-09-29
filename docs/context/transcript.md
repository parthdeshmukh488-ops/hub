# Founding conversation: from hackathon flyer to architecture

- **Date:** 2026-09-29
- **Participants:** Parth (repo owner, WHU hackathon participant) and Claude (Claude Code session on branch `claude/whu-hackathon-ideas-lz8trx`)
- **Purpose of this file:** give every later Claude session the full context: what the challenge is, which ideas were considered, why we build Leash, and the research behind the architecture.

User messages are reproduced verbatim. Claude's replies are reproduced verbatim, except that account-specific links are shortened. Tool work (file reads, web research) is summarized in *italics*. Attachments are summarized in the [Attachments](#attachments) section at the end.

## Decision log

| # | Decision | Where it is recorded |
| --- | --- | --- |
| 1 | Enter the Superteam Germany Solana Challenge at WHU; deadline Oct 4, 2026, 23:59 | [../hackathon-brief.md](../hackathon-brief.md) |
| 2 | Claude acts as a judge on the 18 ideas in Parth's idea book; recommends the rent deposit escrow (22/25) with AI agent budgets a close second (21/25) | Turns 3–4 below |
| 3 | **Parth chooses the AI agent idea**: budgets and an off switch for AI agents, enforced on Solana | Turn 5 |
| 4 | Build it as a firewall on top of the Solana Foundation's Subscriptions & Allowances program; x402-compatible through the official facilitator; split into ten architecture-based workstreams | Turn 6, [../architecture/](../architecture/00-overview.md), [../adr/](../adr/README.md), [../workstreams/](../workstreams/README.md) |

---

## Turn 1

**Parth:**

> check this out i have been to whu hacakhaon and the deadline is of 4 oct check this out and i will give you the the probelms and solutions im thinking to go for and we will decide one from them

*Attachments: a photo of the "Solana Challenge by Superteam Germany" flyer and a zip of 10 phone screenshots of the Superteam Earn listing (see [Attachment: challenge flyer and listing](#attachment-challenge-flyer-and-listing)).*

*Claude read all images, tried to open the live listing, idea bank, solana.new and X (all blocked by the container's network), checked USDG's MiCA status and the Colosseum 2026 dates by web search, wrote `docs/hackathon-brief.md`, and committed it. The push failed (403: the Claude GitHub App has no access to the repo).*

**Claude:**

> I've read the flyer and all 10 screenshots. Here's what matters for picking the idea.
>
> **How it's judged**
> 1. **Useful idea:** a clear problem for a specific person
> 2. **Working prototype:** you can show the core idea working
> 3. **Clear role for Solana:** Solana makes the product better
> 4. **Potential to grow:** who would use it, and how you'd reach the first users
>
> **What I think wins**
> - **"Why Solana" is where most entries lose.** If a normal database plus PayPal would do the same job, the judges will notice.
> - **A prototype that really works stands out.** The challenge is open to people with no blockchain experience, so many entries will be thin. Real transactions on devnet (Solana's free test network) that judges can click through will set you apart.
> - **In Germany, everyday payments are already solved** by PayPal, Wero and SEPA Instant, so "Venmo on Solana" is weak here. Solana's real strengths are sending money across borders, very small payments, programmable money (escrow, splits, streaming), payments made by AI agents, and ownership anyone can verify.
> - **Use a regulated stablecoin for payment ideas.** Prizes are paid in USDG, which is regulated under MiCA, the EU's crypto rules. USDC, EURC or USDG is the credible choice for an EU audience.
> - **Pick something you'd keep building.** The listing points to continuing through Colosseum, whose fall hackathon runs until Nov 2. That's a second, much bigger chance for the same project.
>
> **Timeline (5 days)**
> - **Tue (today):** pick the idea and cut it down to one core flow
> - **Wed–Fri:** build that flow
> - **Sat:** polish, record a demo video, make the pitch deck
> - **Sun Oct 4:** spare time. Submit in the afternoon, not at 23:59.
>
> **Must-haves:** a public pitch-deck link, a public GitHub repo, and following @SuperteamDE on X. Submitting costs 1 of your 3 credits, so submit only once it's final.
>
> **How I'll score your ideas:** 1–5 on the problem, why Solana, whether it's buildable by Saturday, a 60-second demo, reachable first users, and whether we'd keep building it. An idea that scores 2 or less on "why Solana" or "buildable" is out.
>
> Send your ideas whenever you're ready. Rough notes are fine. For each one, tell me:
> - **Problem:** who has it, and what hurts
> - **Solution:** what the user actually does
> - **Solana's role:** where you think it comes in
>
> Also tell me how many people are on your team and who can code, and in what. That decides what we can realistically build by Saturday.
>
> **Two notes:**
> - **The brief isn't on GitHub yet.** I saved it with the checklist and scorecard in `docs/hackathon-brief.md` and committed it here, but the push failed because Claude doesn't have access to `parthdeshmukh488-ops/hub`. To fix that, reconnect GitHub at https://claude.ai/connect-github. If the Claude GitHub App isn't installed on the repo, install it from the same page, and I'll push right after.
> - **I worked from your screenshots only.** This container can't open superteam.fun, X or YouTube, so I couldn't check the live listing or the idea bank.
>
> Sources: [USDG launches in the EU under MiCA (Paxos)](https://www.paxos.com/newsroom/global-dollar-%28usdg%29-launches-in-the-eu) · [Colosseum hackathon](https://colosseum.com/hackathon) · [Colosseum 2026 dates](https://x.com/SuperteamBLKN/status/2011135917986140610)

## Turn 2

**Parth:**

> now act as a judge for picking up a problem for this hacakhton im going to send you the ideas and you tell me your view on that

**Claude:**

> Ready. I'll judge the way the Superteam panel would, and I'll be blunt. It's better to drop a weak idea today than find out on Oct 4.
>
> For each idea you'll get:
> - **Verdict:** strong, maybe or drop
> - **Scores (1–5)** on the four official criteria: useful idea, working prototype, role for Solana, potential to grow. Plus a score for whether you can build it by Saturday.
> - **The toughest question** a judge would ask, and whether the idea survives it
> - **What would make it stronger**
>
> Once I've seen them all, I'll rank them and recommend one.
>
> If you can, send them all in one message so I can compare them side by side. One at a time works too. Rough notes are fine, as long as each one says who has the problem, what the user does, and where you think Solana comes in.

## Turn 3

**Parth:** *(sent `Solana_Challenge_at_WHU_Idea_Book.docx` with no message; see [Attachment: idea book](#attachment-idea-book))*

*Claude extracted the document (18 scored ideas, 15 dropped ideas, the team's pick with a flow diagram, and sources) and re-scored the ideas on the official criteria.*

**Claude:**

> **Verdict: build the rent deposit escrow.** I agree with your pick. The idea book is strong: the claims are sourced, and each idea says honestly why it might lose. As a judge, though, I'd change your runner-up, cut the build down to one flow, and make you answer two questions that could sink the pitch.
>
> **My scores** (useful · demo · Solana · growth · buildable, out of 25)
> - **Rent deposit escrow: 22** (5 · 5 · 5 · 3 · 4)
> - **Budgets and an off switch for AI agents: 21** (3 · 5 · 5 · 3 · 5)
> - **Everything else: 13 to 17.** There's a clear top two.
>
> **Where I disagree with your scoreboard**
> - **AI agent budgets should be #2, not #5.** It has the most dramatic demo on the list: an agent gets a malicious message live, tries to pay, and the Solana program refuses. The rules live on-chain, so no message can change them, and your Hourglass code already covers much of it. It loses to the deposit only because every judge has rented a flat, and few have run an agent.
> - **Drop truck carriers and battery passports.** Both are slow business-to-business sales that need an industry insider to pitch credibly. Signed records in an ordinary database would do most of the job. "Blockchain for supply chains" is also one of the most worn-out pitches in crypto.
> - **Credit history is a feature, not a product.** The trust comes from whoever issues the credentials, not from Solana, and the EU's own digital identity wallet is coming. Keep it as a roadmap slide for the deposit, as you already suggest.
> - **Your rubric scores the wrong things.** Judges don't score area fit or depth; the listing calls the areas "starting points". They do judge the working demo, and the listing asks for ease of use, but your rubric skips both. Parallel Claude Code sessions speed up writing code, not wiring it together, testing on devnet or making it feel simple. Re-scored on the official criteria, your pick still wins.
> - **The rest:** I agree with dropping them, for the reasons your book gives.
>
> **What judges will ask about the deposit**
> 1. **"Why would a landlord give up control?"** This is your weakest spot, because GetMomo already removes the paperwork.
>    - Pitch to student-housing operators, not private landlords. For them the deposit is money they must keep separate and can't use, so control is worth little, while refunds cost staff time.
>    - Refunds are hardest for international students who've gone home outside the EU: a slow, costly bank transfer, where EURC reaches their wallet in seconds.
>    - Refunds guaranteed by code also help operators win students who fear rental scams.
> 2. **"Who can actually move the money?"** A Solana judge will ask this, so make "nobody controls it" literally true:
>    - At launch, revoke the program's upgrade authority so nobody can change the rules, including you.
>    - Let anyone trigger the refund once the claim window ends.
>    - Let the mediator only split disputed euros between landlord and tenant, never send them anywhere else.
>
>    Your flow diagram is the slide for this.
> 3. **"Tenants don't have EURC."** They log in with an email-based wallet, so there's no seed phrase to manage. Later, a licensed partner turns a bank transfer into EURC. For the demo, EURC on devnet is fine.
> 4. **"Is it legal?"** § 551(3) BGB allows another form of holding the deposit if both sides agree, and your rules are friendlier to tenants than the law. Present the lawyer check as your next step.
>
> **Cut the build to one flow**
> 1. The landlord sets the terms and gets a Solana Pay QR code.
> 2. The tenant pays €1,500 in EURC by scanning it.
> 3. At move-out, the landlord claims €150 with a timestamped photo.
> 4. The tenant accepts or disputes, and the rest comes back without the landlord's signature.
> 5. A mediator splits anything disputed.
>
> For the demo, set the claim window to 60 seconds. If there's time, add your "arrive safely" refund before the key handover; it's the strongest hook for students paying from abroad. Put these on a roadmap slide instead of building them: instalments, shared-flat tokens, rolling the deposit into the next flat, rental records and the bridge loan. The bridge loan needs a lending licence, which is the same reason you dropped student microloans.
>
> **Get proof this week:** ask 20 WHU students how long their last deposit took to come back and whether they ever had to pay two at once. Also get one quote from a student-housing operator. Numbers you collected yourself beat national statistics on a slide.
>
> If you agree, next I'll write the MVP spec: the program's accounts and instructions, the demo script, and how to split the build across your Claude Code sessions. The GitHub push is still blocked; the fix from my first message still applies.

## Turn 4

**Parth:**

> zBudgets and an off switch for AI agents: 21 (3 · 5 · 5 · 3 · 5) so you think this is our idea to build right

**Claude:**

> No, my pick is the **rent deposit escrow (22)**. The AI agent budgets idea is a close second (21).
>
> **Why the deposit wins:**
> - **Judges know the problem firsthand.** Every judge has rented a flat and waited for a deposit, but few have run an AI agent with a wallet. The first thing the listing asks is to "find a real problem and explain who you're solving it for."
> - **There's less competition.** Nobody offers a neutral on-chain deposit escrow in Germany, but bigger players already sell spending limits for agents. Your book names Ramp.
>
> **Where the agent idea is better:**
> - **It's lower risk.** There are no landlords to convince and no legal question, and your Hourglass code already covers much of it.
> - **Its demo is more dramatic:** a live attack on the agent that fails on-chain.
>
> I'd only switch to the agent idea if your team is clearly more excited about it, or if you don't find my answer to "why would a landlord accept this?" convincing. Motivation matters in a five-day sprint. Either way, decide today and build only one.

## Turn 5

**Parth:**

> we going with the ai agent idea

**Claude** *(interrupted by Parth's next message while researching)*:

> Agent budgets it is. Before I write the build plan, I'll look for your Hourglass code, since the idea book says the agent idea reuses it. I'll also check what's current for AI-agent payments on Solana.

## Turn 6

**Parth:**

> now as we decided the project so now ive got multiple claude codes so what i want you to do is dont thnik about the deadline dont think about the steps think about the archeticure of building this project in that means i can make my mind work and make sure not everything is vibe coded i mean it will be but if the project is devided in archetivre basis i can exel one by one and not just say do this project and give me and it will give me something shitty that will not even be close to the winning so i want the backend front end everything to be a master work as they would want so take a good amount of time to make a architectire based devided work and then i can do work from all my multiple calude codes and one more thing that do not forget to to write the transcript in the repo so my other caludes and pick up the context and start working on what i say i want a clean systematic work with consistancy to master the project and win the hacakaton

### Research done in this turn (summary)

*These findings shaped the architecture. Details and sources are in the ADRs.*

1. **Solana Foundation Subscriptions & Allowances** (shipped June 2, 2026; program `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`; MIT; Pinocchio; audited by Cantina; client `@solana/subscriptions` 0.5.0). Claude read the source. Fixed and recurring delegations cap an amount (per period or in total) for a *delegatee*, but **do not restrict the destination**. The delegatee must sign, so a program PDA can be the delegatee. → [ADR-0001](../adr/0001-build-on-subscriptions-program.md): Leash is a firewall on top of it and never holds funds.
2. **x402 on Solana.** The exact-scheme spec has a simulation-based "smart wallet" path for transfers made by CPI. The official `@x402/svm` 2.27 facilitator implements it (`enableSmartWalletVerification`) with a **configurable** program allowlist (`smartWalletAllowedPrograms`; defaults: Squads, Swig, SPL Governance, Metaplex Core, Lighthouse). ComputeBudget and Memo are exempt from the allowlist check. v2 headers: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`. Devnet CAIP-2: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. → [ADR-0003](../adr/0003-x402-via-official-facilitator.md).
3. **Landscape:** Swig and Squads smart accounts (spending limits, on the x402 allowlist); open-source agent-wallet projects (SolAgent Pay; "onchain-agent-wallets" and "x402-agent-wallet" by nirholas); Openfort, Crossmint and others; **Ramp**, which serves 70,000+ organizations overall and was testing x402 agent wallets on Solana with business customers in a limited alpha. *Note for the pitch: the idea book says "Ramp's corporate AI wallets already serve more than 70,000 businesses". The 70,000 is Ramp's total customer base; the agent wallets were an alpha.* Our differentiation: destination allowlist + tripwire + approvals + off switch, on-chain, non-custodial, on top of the official allowance, for small developer teams.
4. **Environment:** cloud Claude Code sessions reach npm and crates.io, but not Solana RPC, the Solana/Anchor installers or GitHub release downloads. → [ADR-0007](../adr/0007-environments-and-artifacts.md).
5. **Current package versions (npm, 2026-09-29):** `@solana/kit` 8.4, `@anchor-lang/core` 1.2 (Anchor is on 1.x), `codama` 1.11, `litesvm` 1.5, `@x402/*` 2.27, `next` 16.3, `hono` 4.13, `zod` 4.6, `vitest` 5.0, `@biomejs/biome` 2.5, `turbo` 2.11, `drizzle-orm` 0.45, `@modelcontextprotocol/sdk` 1.31, `@anthropic-ai/sdk` 0.129.
6. **Hourglass code:** not found in any GitHub repository this session can see. If Parth wants to reuse it, it needs to be added to the repo (for example under `reference/hourglass/`).
7. **GitHub:** pushing from this session still fails with 403 until the Claude GitHub App is installed on the repo or GitHub is reconnected.

### What was produced

| Path | Content |
| --- | --- |
| `CLAUDE.md` | Rules every Claude session loads automatically |
| `README.md` | Product README |
| `docs/architecture/00-overview.md` … `04-conventions.md` | Overview, program spec, off-chain contracts, security model, conventions |
| `docs/adr/0001` … `0007` | Founding decisions |
| `docs/workstreams/README.md`, `WS0` … `WS9`, `status/` | Ten session briefs with starter prompts, plus status files |
| `docs/context/transcript.md` | This file |

**Claude** *(final reply of the conversation)*:

> The architecture is ready and committed on `claude/whu-hackathon-ideas-lz8trx`: system design, contracts, security model, 7 decision records, 10 session briefs, CLAUDE.md, a README and this transcript. The push to GitHub is still blocked, so the other sessions can't see it until access is fixed.
>
> The key design decision: the Solana Foundation's official Allowances program limits how much a delegate can spend, not who it pays. So Leash is a firewall on top of it. The owner's money stays in the owner's wallet, and the allowance is the hard ceiling. The Leash program checks every payment against an allowlist, per-payment and per-payee limits, a rate limit and an approval threshold. Blocked attempts are recorded on-chain as strikes, and three strikes freeze the agent. The owner or a guardian can freeze any agent in one tap. Payments are standard x402, and the official facilitator accepts them with a small configuration change.
>
> The work is split into ten workstreams (WS0–WS9). Each brief ends with a starter prompt to paste into a new Claude Code session. The session reads CLAUDE.md and its brief, shows Parth a plan, and waits for approval before writing code. WS0 goes first. WS1 (the Solana program) needs a machine with the Solana toolchain.

---

## Attachments

### Attachment: challenge flyer and listing

Flyer: "Solana Challenge by Superteam Germany. Build an MVP using a Solana feature." Listing: `superteam.fun/earn/listing/build-at-whu` (Germany only). Everything relevant is in [../hackathon-brief.md](../hackathon-brief.md): mission, focus areas, judging criteria (useful idea, working prototype, clear role for Solana, potential to grow), prizes (1,500 / 1,000 / 500 USDG), deadline (Oct 4, 2026, 23:59), winners by Oct 8, submission requirements (pitch-deck link in "Bounty submission link", public GitHub repo, follow @SuperteamDE on X, 1 credit to submit), resources (solana.new, Superteam Germany BuildStation, project idea bank), and the contact for questions.

### Attachment: idea book

`Solana_Challenge_at_WHU_Idea_Book.docx`, by @Parth, Sept 29, 2026. The team's own rubric scored six questions from 1 to 5 (real problem, visible core Solana feature, focus-area fit, "judges nod", growth, depth; build time deliberately not scored because several Claude Code sessions build in parallel). The listing showed 3 submissions on Sept 29.

**Scoreboard (the team's scores, out of 30):**

| Idea | Total | | Idea | Total |
| --- | --- | --- | --- | --- |
| Rent deposit nobody controls (team pick) | 27 | | Pay per shift for student jobs | 22 |
| Credit history for newcomers | 25 | | On-chain savings circles | 21 |
| Stopping fake truck carriers | 24 | | Pay-per-use AI tools | 21 |
| EU battery passports | 24 | | Paid when AI uses your content | 21 |
| **Budgets and an off switch for AI agents** | **23** | | Share your private EV charger | 21 |
| Balcony solar to neighbors | 23 | | Money from home for students | 20 |
| Rent applications without documents | 22 | | Pay-per-article news | 20 |
| | | | Students co-own dorm solar | 19 |
| | | | Hourglass crypto safe (backup) | 19 |
| | | | Refundable viewing deposit | 18 |
| | | | Prove you're 18 without a passport | 17 |

Fifteen more ideas were dropped early (campus café payments, escrow for second-hand deals, splitting rent, freelancer invoices, student microloans, student-status proofs, verified degrees, anti-bot ticketing, event tickets, café loyalty, invoice financing, carbon credits, dorm laundry, parking sharing, air-quality sensors), mostly because a mainstream product already solves them or they are hackathon clichés.

**The chosen idea, verbatim from the idea book:**

> ## Budgets and an off switch for AI agents
>
> Give an AI agent a spending budget and an off switch that it cannot get around, enforced on Solana. It is timely and reuses our Hourglass code, but big players already sell it. It scores 23 of 30. Area: AI and agent payments.
>
> **Problem.** AI agents now pay for things on their own: Solana carried 23.2 million x402 agent payments in the four weeks to Sept 22, 2026, 76% of all of them ([Solana Compass](https://solanacompass.com/news/solana-processes-76-of-all-x402-ai-agent-transactions-232-million-in-four-weeks)). An agent follows the text that reaches it, so a crafted message can make it pay the wrong party. On May 4, 2026, a message in Morse code on X got Grok, wired to the Bankr trading bot, to send tokens worth about $150,000–200,000 ([OECD.AI](https://oecd.ai/en/incidents/2026-05-04-4a73)).
>
> **Solution.** The agent's key can only spend through a Solana program whose rules a human sets: a daily budget, approved payees, and a delay plus human approval above a limit. One tap on the owner's phone freezes the agent's wallet. The rules live on-chain, not in the prompt, so no message can change them.
>
> **Why it may not win.** Ramp's corporate AI wallets already serve more than 70,000 businesses and settle on Solana, so judges may see a crowded field. We would need a sharper first user, such as small developer teams that big platforms ignore.

**Related backup idea, summarized:** *Hourglass*, a time-delay crypto safe. Big withdrawals wait 72 hours and trusted guardians can cancel them; a panic PIN opens a decoy wallet. A working prototype exists (the source was not available to this session). Its guardian and delay concepts influenced Leash's guardian role and the approval flow.

**The team's original pick, summarized:** a rent deposit held in a Solana escrow that neither landlord nor tenant controls: EURC via Solana Pay, a 30-day claim window with photo evidence, automatic refund without the landlord's signature, a mediator for disputes, and roll-over into the next flat. It was the judge's recommendation (22/25), but Parth chose the AI agent idea.
