import type { AgentView } from "@leash/contracts";

/**
 * Colour semantics (04-conventions §8): executed = green, blocked = red, needs approval = amber,
 * frozen = blue. A tone is never shown alone: components pair it with an icon and a label.
 */
export type Tone = "ok" | "blocked" | "approval" | "frozen" | "neutral";

export type StatusInfo = { tone: Tone; label: string; detail: string | null };

/** The status of an agent as the owner should read it. */
export function agentStatus(agent: AgentView, principalFrozen: boolean): StatusInfo {
  if (agent.status === "frozen") {
    return { tone: "frozen", label: "Frozen", detail: freezeReasonCopy(agent) };
  }
  if (principalFrozen) {
    return { tone: "frozen", label: "Paused", detail: "All agents are frozen" };
  }
  if (agent.openRequests > 0) {
    const n = agent.openRequests;
    return {
      tone: "approval",
      label: "Needs approval",
      detail: `${n} request${n === 1 ? "" : "s"} waiting`,
    };
  }
  return { tone: "ok", label: "Active", detail: null };
}

function freezeReasonCopy(agent: AgentView): string {
  switch (agent.freezeReason) {
    case "tripwire":
      return `Froze itself after ${agent.policy.tripwireMaxStrikes} blocked attempts`;
    case "guardian":
      return "Frozen by your guardian";
    case "owner":
      return "Frozen by you";
    case "none":
      return "Frozen";
  }
}
