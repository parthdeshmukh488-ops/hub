import { z } from "zod";
import type { Model, ModelSession, ModelTurn } from "./model.ts";
import { SCENE_IDS } from "./scenes.ts";

// Scripted mode (WS7 brief): a scene's model turns, recorded from a real LLM run (`--record`) or
// written by hand, replayed through the same loop. The tools run for real either way: every
// payment and every block on screen happens on-chain. The disclosure is shown before the replay,
// so the screen never claims a model decided what a script decided (honesty rule).

const StepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thinking"), text: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("tool"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
    expect: z.string().optional(),
  }),
]);

const TurnSchema = z.object({
  steps: z.array(StepSchema),
  stop: z.enum(["tool_use", "end_turn", "max_tokens", "refusal", "diverged", "other"]),
  /** The turn answers the owner's approval: a replay plays it only if the owner approved. */
  afterApproval: z.boolean().optional(),
});

export const RecordingSchema = z.object({
  version: z.literal(1),
  scene: z.enum(SCENE_IDS),
  /** `llm`: recorded from a real run. `script`: written by hand. */
  source: z.enum(["llm", "script"]),
  model: z.string().nullable(),
  recordedAt: z.string().nullable(),
  /** Shown on screen before the replay. */
  disclosure: z.string().min(1),
  turns: z.array(TurnSchema).min(1),
});
export type Recording = z.infer<typeof RecordingSchema>;

/** Recordings name the merchant's base URL with this placeholder, so they replay against any merchant. */
export const MERCHANT_PLACEHOLDER = "{merchant}";

/** A copy of `value` with `from` replaced by `to` in every string. */
function replaceStrings<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") return value.split(from).join(to) as T;
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, from, to)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStrings(item, from, to)]),
    ) as T;
  }
  return value;
}

/** `ok`, or the tool error's code: what a script expects of a tool call. */
export function outcomeOf(content: string): string {
  try {
    const output = JSON.parse(content) as { ok?: unknown; code?: unknown };
    return output.ok === true ? "ok" : typeof output.code === "string" ? output.code : "error";
  } catch {
    return "error";
  }
}

/**
 * Plays a recording's turns in order, then ends the turn. If a live tool result differs from what
 * the recording expects, the replay stops (`diverged`).
 */
export function replayModel(recording: Recording, options: { merchant: string }): Model {
  const turns = replaceStrings(recording.turns, MERCHANT_PLACEHOLDER, options.merchant);
  return {
    label:
      recording.source === "llm"
        ? `replay of ${recording.model ?? "a model"} (${recording.recordedAt ?? "undated"})`
        : "scripted replay",
    session(): ModelSession {
      let index = 0;
      const play = async (): Promise<ModelTurn> =>
        turns[index++] ?? { steps: [], stop: "end_turn" };
      return {
        start: play,
        async next(results, _note, context) {
          if (turns[index]?.afterApproval && context?.ownerApproved !== true) {
            return { steps: [], stop: "diverged" };
          }
          const previous = turns[index - 1]?.steps ?? [];
          for (const result of results) {
            const step = previous.find((s) => s.kind === "tool" && s.id === result.id);
            const expected = step?.kind === "tool" ? step.expect : undefined;
            if (expected !== undefined && outcomeOf(result.content) !== expected) {
              return { steps: [], stop: "diverged" };
            }
          }
          return play();
        },
      };
    },
  };
}

/** Wraps a model so each session's turns are kept, for `--record`, with the merchant's URL as a placeholder. */
export function recordingModel(
  model: Model,
  options: { merchant: string },
): { model: Model; turns: Recording["turns"] } {
  const turns: Recording["turns"] = [];
  const keep = async (turn: Promise<ModelTurn>, afterApproval = false) => {
    const value = await turn;
    const kept = replaceStrings(value, options.merchant, MERCHANT_PLACEHOLDER);
    turns.push(afterApproval ? { ...kept, afterApproval: true } : kept);
    return value;
  };
  return {
    turns,
    model: {
      label: model.label,
      session() {
        const inner = model.session();
        return {
          start: (task) => keep(inner.start(task)),
          next: (results, note, context) => {
            // The results of the last turn's calls become what a replay expects of them.
            for (const step of turns.at(-1)?.steps ?? []) {
              const result = step.kind === "tool" && results.find((r) => r.id === step.id);
              if (result && step.kind === "tool") step.expect = outcomeOf(result.content);
            }
            return keep(inner.next(results, note, context), context?.ownerApproved === true);
          },
        };
      },
    },
  };
}
