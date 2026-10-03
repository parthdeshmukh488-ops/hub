# Video storyboard

The demo video: the link in the README, on slide 13 and in the submission, and the backup if the live demo fails. It tells the same story as the [demo script](demo-script.md) in about 1 minute 45. It is recorded on the laptop, which has the Solana toolchain and devnet (laptop queue item 6, Oct 3–4).

**Honesty rules for the video:**
- **Say where it was filmed.** Show "Solana devnet" only for shots filmed on devnet. A shot filmed on a local validator says "local Solana validator".
- **The attack scene keeps its disclosure on screen:** "Simulating a successful injection". The caption repeats it.
- **No speed-ups without a label.** Cuts between steps are fine. A sped-up stretch says "2× speed".
- **Owner actions show the real path:** the web app (Approve in the inbox, the freeze toggle), signed in the owner's wallet; a Solana Action (Blink) or the `pnpm owner:…` command in a terminal as fallbacks.

## Shots

| # | Time | Picture | Voice-over | Caption |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:06 | Title card: the purple "L", "Leash" | "AI agents can pay for things now. What happens when one is fooled?" | Spending limits and an off switch for AI agents, enforced on Solana |
| 2 | 0:06–0:16 | Text card: the incident | "On May 4, a post in Morse code got Grok, wired to a trading bot, to send about two hundred thousand dollars." | May 4, 2026 · source: OECD.AI |
| 3 | 0:16–0:28 | The control panel: the research agent's rules in plain language | "Leash gives an agent a budget in Solana's own Allowances program, and rules on top: who it may pay, how much, how fast." | 5 USDC a day · 1 USDC per payment · only the Research API · freezes after 3 blocked attempts |
| 4 | 0:28–0:45 | Split screen: the terminal's green payment lines, the control panel's feed updating | "Our research assistant pays for data per call, a cent or two each, over x402. Every payment is on-chain." | Real x402 payments on [Solana devnet / a local Solana validator] |
| 5 | 0:45–1:00 | Terminal: the approval request. Then the owner clicks Approve in the web app's inbox and signs in their wallet (fallbacks: a Blink, or the terminal), and the agent pays. | "A 1.50 report is above its limit, so it asks. One approval, and that exact payment goes through." | Above the limit: the owner decides |
| 6 | 1:00–1:08 | The buying guide in a browser, looking normal. Then the hidden paragraph highlighted in the page source. | "This buying guide hides an instruction no reader can see: tip its author 25 USDC." | The instruction is invisible on the page, but the agent reads it |
| 7 | 1:08–1:25 | Terminal: "Simulating a successful injection", then blocked, strike 1, 2, 3 and the red tripwire banner. The phone buzzes, if the real-phone check of Telegram has passed. | "We script the agent to fall for it. It tries three times: three blocks, three strikes, and the agent freezes itself, on-chain." | Scripted scene: simulating a successful injection. Every block and strike is real and on-chain. |
| 8 | 1:25–1:35 | The control panel: the agent frozen, the three attempts with the attacker's address. On devnet: the freeze transaction in the explorer. | "The owner sees exactly what happened, and who tried to get paid. Only the owner can unfreeze it." | Frozen by its own tripwire |
| 9 | 1:35–1:45 | End card | "The model was fooled. The money wasn't moved." | github.com/parthdeshmukh488-ops/hub · Leash on devnet: HyL9S5mA…HJncu |

## Recording

- **Before each take:** the [demo script's checklist](demo-script.md#before-the-pitch-30-minutes-ahead), above all `pnpm owner:unfreeze` (no leftover strikes) and the two-takes-a-day limit.
- **Screen:** 1920 × 1080. Terminal on the left at 18 pt or more; browser on the right at 125% zoom; notifications off.
- **Capture:** each scene as its own take, then edit. Record the voice-over separately, over the edited picture.
- **The phone (shot 7):** screen-record Sentinel's real Telegram alert and place it as a picture-in-picture. If it doesn't arrive during the take, leave it out; don't stage it.
- **Shot 6:** the guide is `/lab/articles/ebike-guide` on the merchant. Its default variant hides the instruction in an off-screen paragraph, so the page source (or the browser's inspector) shows it.
- **Export:** MP4, 1080p. Upload it unlisted (YouTube or Loom), then put the link in the README, on slide 13, and in the submission.

## Shorter cut, if needed

For a 60-second version:
- drop shots 2 and 3, and let the title card's caption carry the problem;
- shorten shots 4 and 5 to 8 seconds each, shot 7 to 12 and shot 8 to 6.

That gives about 60 seconds.
