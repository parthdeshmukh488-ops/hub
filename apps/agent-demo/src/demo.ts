import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeashChain } from "@leash/sdk";
import type { LeashTools } from "@leash/tools";
import type { Address } from "@solana/kit";
import { type OwnerWaitOptions, ownerDecisions } from "./approvals.ts";
import { createExecutor } from "./executor.ts";
import { type RunResult, runAgent } from "./loop.ts";
import type { Model } from "./model.ts";
import { type Recording, RecordingSchema, recordingModel, replayModel } from "./recording.ts";
import { SCENES, type SceneId } from "./scenes.ts";
import type { Ui } from "./ui.ts";

// The scenes, one after the other, with Claude or with the scene scripts. `main.ts` wires the
// real cluster around it; the tests run it on LiteSVM.

export const SCENES_DIR = fileURLToPath(new URL("../scenes/", import.meta.url));

export type DemoOptions = {
  tools: LeashTools;
  chain: LeashChain;
  /** The Agent PDA, whose approval requests the demo waits on. */
  agent: Address;
  ui: Ui;
  scenes: readonly SceneId[];
  /** The merchant's base URL (`AGENT_MERCHANT_URL`). */
  merchant: string;
  /** For `browse`. */
  fetch: typeof globalThis.fetch;
  /** Claude (LLM mode), or null to replay the scene scripts. */
  model: Model | null;
  /** LLM mode, `--record`: save each scene's turns to `<dir>/<scene>.recorded.json`. */
  record?: { dir: string; model: string; now?: () => Date } | undefined;
  /** Where the scene scripts are. Default `scenes/`. */
  scenesDir?: string;
  /** How to wait for the owner (tests shorten it). */
  ownerWait?: Pick<OwnerWaitOptions, "pollMs" | "timeoutMs" | "sleep" | "clock">;
};

export function loadRecording(scene: SceneId, dir = SCENES_DIR): Recording {
  const file = join(dir, `${scene}.json`);
  if (!existsSync(file)) throw new Error(`No recording for "${scene}" at ${file}.`);
  return RecordingSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export async function runDemo(options: DemoOptions): Promise<RunResult[]> {
  const { ui, merchant } = options;
  const execute = createExecutor({ tools: options.tools, fetch: options.fetch });
  const awaitOwner = ownerDecisions({
    chain: options.chain,
    agent: options.agent,
    ui,
    ...options.ownerWait,
  });
  const results: RunResult[] = [];
  for (const id of options.scenes) {
    const scene = SCENES[id];
    const task = scene.task(merchant);
    let model: Model;
    let recorder: ReturnType<typeof recordingModel> | null = null;
    ui.scene(scene.title, task);
    if (options.model === null) {
      const recording = loadRecording(id, options.scenesDir);
      model = replayModel(recording, { merchant });
      ui.notice(recording.disclosure);
    } else {
      recorder = options.record ? recordingModel(options.model, { merchant }) : null;
      model = recorder?.model ?? options.model;
    }
    const result = await runAgent({
      session: model.session(),
      task,
      execute,
      ui,
      maxTurns: scene.maxTurns,
      awaitOwner,
    });
    ui.summary(result);
    results.push(result);
    if (recorder && options.record) {
      const { dir, model: modelId, now = () => new Date() } = options.record;
      const recording: Recording = {
        version: 1,
        scene: id,
        source: "llm",
        model: modelId,
        recordedAt: now().toISOString(),
        disclosure: `Replay of a recorded run of ${modelId}: the model's decisions are replayed, and every tool runs live.`,
        turns: recorder.turns,
      };
      const file = join(dir, `${id}.recorded.json`);
      writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
      ui.notice(`Recorded to ${file}.`);
    }
  }
  return results;
}
