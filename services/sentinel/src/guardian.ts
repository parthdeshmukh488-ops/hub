import type { Alert } from "@leash/contracts";
import {
  buildFreezeAgent,
  buildFreezePrincipal,
  fetchAgentView,
  fetchPrincipalView,
  type LeashChain,
  sendInstructions,
} from "@leash/sdk";
import type { Address, TransactionSigner } from "@solana/kit";
import { activityPageUrl, agentPageUrl } from "./links.ts";
import type { Logger } from "./logger.ts";
import { ALERT_SEVERITY } from "./rules/evaluate.ts";
import type { SentinelAction } from "./rules/types.ts";
import { clip, shortAddress, untrusted } from "./text.ts";

// Guardian freezes (build step 4). The rules only ask; this decides, and it is the only code in
// Sentinel that sends a transaction. It sends one only when:
//   1. autofreeze is on (SENTINEL_AUTOFREEZE=true) and the guardian keypair is loaded, and
//   2. the principal's on-chain guardian is that key (read fresh before every freeze), and
//   3. the target is not frozen yet.
// Each request is tried once, never in a loop: a failure is logged and the alert stands. The
// guardian can only freeze and reject (01 §6.1); unfreezing stays with the owner (I3).

export interface GuardianOptions {
  /** Chain access through the SDK. */
  chain: LeashChain;
  /** The guardian key; `null` when no keypair was given (watch-only). */
  signer: TransactionSigner | null;
  /** `SENTINEL_AUTOFREEZE`. */
  autofreeze: boolean;
  webUrl: string;
  log: Logger;
  /** Unix seconds, for `createdAt`. */
  clock?: () => number;
}

export interface Guardian {
  /** Carries out the freezes the rules asked for; returns a `guardian_freeze` alert per freeze. */
  act(actions: readonly SentinelAction[], alerts: readonly Alert[]): Promise<Alert[]>;
}

export function createGuardian(options: GuardianOptions): Guardian {
  const { chain, signer, log } = options;
  const clock = options.clock ?? (() => Math.floor(Date.now() / 1000));

  async function freeze(action: SentinelAction, trigger: Alert | undefined): Promise<Alert | null> {
    if (!options.autofreeze || !signer) {
      log.info({ action }, "freeze asked for; autofreeze is off, nothing sent");
      return null;
    }
    const owner = action.owner as Address;
    const principal = await fetchPrincipalView(chain, owner);
    if (!principal) {
      log.warn({ owner }, "no principal on-chain for this owner; not freezing");
      return null;
    }
    if (principal.guardian !== signer.address) {
      log.warn(
        { owner, guardian: principal.guardian, ours: signer.address },
        "this principal's guardian is not Sentinel's key; not freezing",
      );
      return null;
    }
    if (principal.frozen) {
      log.info({ owner }, "principal already frozen; nothing to do");
      return null;
    }

    let what: string;
    let link: { label: string; url: string };
    let instruction: Awaited<ReturnType<typeof buildFreezePrincipal>>;
    if (action.type === "freezePrincipal") {
      what = "all agents";
      link = { label: "Open activity", url: activityPageUrl(options.webUrl) };
      instruction = await buildFreezePrincipal({ authority: signer, owner });
    } else {
      const agent = await fetchAgentView(chain, action.agent as Address);
      if (!agent || agent.owner !== action.owner) {
        log.warn({ owner, agent: action.agent }, "agent not found under this owner; not freezing");
        return null;
      }
      if (agent.status === "frozen") {
        log.info({ agent: action.agent }, "agent already frozen; nothing to do");
        return null;
      }
      what = untrusted(agent.label) || shortAddress(agent.address);
      link = { label: "Open agent", url: agentPageUrl(options.webUrl, agent.address) };
      instruction = await buildFreezeAgent({
        authority: signer,
        owner,
        agent: agent.address as Address,
      });
    }

    const record = await sendInstructions(chain, { feePayer: signer, instructions: [instruction] });
    log.warn({ owner, action, signature: record.signature }, "guardian freeze sent");
    const reason = trigger ? `: ${trigger.title}` : "";
    return {
      id: `guardian_freeze:${action.type === "freezeAgent" ? action.agent : action.owner}:${action.alertId}`,
      severity: ALERT_SEVERITY.guardian_freeze,
      kind: "guardian_freeze",
      owner: action.owner,
      agent: action.type === "freezeAgent" ? action.agent : null,
      title: clip(`Sentinel froze ${what}`, 80),
      body: clip(
        `Sentinel froze ${what} as your guardian${reason}. Payments stay blocked until you unfreeze; ` +
          "only you can.",
        500,
      ),
      actions: [link],
      eventIds: trigger?.eventIds ?? [],
      createdAt: clock(),
    };
  }

  return {
    async act(actions, alerts) {
      const done: Alert[] = [];
      for (const action of actions) {
        try {
          const alert = await freeze(
            action,
            alerts.find((a) => a.id === action.alertId),
          );
          if (alert) done.push(alert);
        } catch (error) {
          // Once, never in a loop: the next alert after the cooldown may ask again.
          log.error(
            { action, err: error instanceof Error ? error.message : String(error) },
            "guardian freeze failed",
          );
        }
      }
      return done;
    },
  };
}
