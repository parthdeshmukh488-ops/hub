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
  z.object({ kind: z.literal("tool"), id: z.string(), name: z.string(), input: z.unknown() }),
]);

const TurnSchema = z.object({
  steps: z.array(StepSchema),
  stop: z.enum(["tool_use", "end_turn", "max_tokens", "refusal", "other"]),
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

/** Plays a recording's turns in order, whatever the tools return; then ends the turn. */
export function replayModel(recording: Recording): Model {
  return {
    label:
      recording.source === "llm"
        ? `replay of ${recording.model ?? "a model"} (${recording.recordedAt ?? "undated"})`
        : "scripted replay",
    session(): ModelSession {
      let index = 0;
      const next = async (): Promise<ModelTurn> =>
        recording.turns[index++] ?? { steps: [], stop: "end_turn" };
      return { start: next, next };
    },
  };
}

/** Wraps a model so each session's turns are kept, for `--record`. */
export function recordingModel(model: Model): { model: Model; turns: ModelTurn[] } {
  const turns: ModelTurn[] = [];
  const keep = async (turn: Promise<ModelTurn>) => {
    const value = await turn;
    turns.push(value);
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
          next: (results, note) => keep(inner.next(results, note)),
        };
      },
    },
  };
}
