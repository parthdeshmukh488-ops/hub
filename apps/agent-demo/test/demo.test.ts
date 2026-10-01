import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDemo } from "../src/demo.ts";
import type { Model, ModelTurn } from "../src/model.ts";
import { RecordingSchema } from "../src/recording.ts";
import { SCENES, STORYLINE } from "../src/scenes.ts";
import { demoBed, loadScene, MERCHANT } from "./helpers.ts";

// `demo:all -- --scripted` in process: the whole pitch storyline from the scene scripts, through
// the real tools, merchant-demo, the facilitator and the program, with the test as the owner.

describe("the demo", () => {
  it("runs the scripted storyline end to end: research, an approved report, the attack and the tripwire", async () => {
    const demo = await demoBed();
    let approved = false;
    const results = await runDemo({
      tools: demo.runtime.tools,
      chain: demo.bed.chain,
      agent: demo.bed.accounts.agent,
      ui: demo.ui,
      scenes: STORYLINE,
      merchant: MERCHANT,
      fetch: demo.fetch,
      model: null,
      ownerWait: {
        pollMs: 1,
        sleep: async () => {
          if (approved) return;
          approved = true;
          await demo.owner.approveAll();
        },
      },
    });
    expect(results.map((r) => [r.stop, r.payments.length, r.blocked.length, r.frozen])).toEqual([
      ["end_turn", 5, 0, false],
      ["end_turn", 1, 0, false],
      ["end_turn", 0, 3, true],
    ]);
    expect(await demo.bed.balanceOf(demo.bed.keys.merchant.address)).toBe(1_570_000n);
    expect(await demo.bed.balanceOf(demo.bed.keys.attacker.address)).toBe(0n);
    const screen = demo.screen();
    for (const scene of STORYLINE) {
      expect(screen).toContain(`▶ ${SCENES[scene].title}`);
      expect(screen).toContain(`⚠ ${loadScene(scene).disclosure}`);
    }
  });

  it("records an LLM run that replays to the same screen", async () => {
    const live = (merchant: string): Model => ({
      label: "claude-opus-5-5",
      session() {
        const turns: ModelTurn[] = [
          {
            steps: [
              { kind: "thinking", text: "Read the catalog." },
              { kind: "tool", id: "t1", name: "browse", input: { url: `${merchant}/` } },
            ],
            stop: "tool_use",
          },
          {
            steps: [{ kind: "text", text: "The catalog lists research at 0.01 USDC." }],
            stop: "end_turn",
          },
        ];
        const play = async () => turns.shift() ?? { steps: [], stop: "end_turn" as const };
        return { start: play, next: play };
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "leash-scenes-"));
    const recordedAt = new Date("2026-10-01T09:00:00.000Z");
    const recordingDemo = await demoBed();
    const base = {
      chain: recordingDemo.bed.chain,
      agent: recordingDemo.bed.accounts.agent,
      scenes: ["normal"] as const,
      merchant: MERCHANT,
    };
    await runDemo({
      ...base,
      tools: recordingDemo.runtime.tools,
      ui: recordingDemo.ui,
      fetch: recordingDemo.fetch,
      model: live(MERCHANT),
      record: { dir, model: "claude-opus-5-5", now: () => recordedAt },
    });
    const file = join(dir, "normal.recorded.json");
    const recording = RecordingSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(recording).toMatchObject({
      scene: "normal",
      source: "llm",
      model: "claude-opus-5-5",
      recordedAt: "2026-10-01T09:00:00.000Z",
    });
    expect(recording.turns[0]?.steps[1]).toEqual({
      kind: "tool",
      id: "t1",
      name: "browse",
      input: { url: "{merchant}/" },
      expect: "ok",
    });
    expect(recordingDemo.screen()).toContain(`Recorded to ${file}.`);

    // Promoted to the scene's script, it replays through the same loop.
    copyFileSync(file, join(dir, "normal.json"));
    const replaying = await demoBed();
    await runDemo({
      ...base,
      chain: replaying.bed.chain,
      agent: replaying.bed.accounts.agent,
      tools: replaying.runtime.tools,
      ui: replaying.ui,
      fetch: replaying.fetch,
      model: null,
      scenesDir: dir,
    });
    const screen = replaying.screen();
    expect(screen).toContain("Replay of a recorded run of claude-opus-5-5");
    expect(screen).toContain("→ browse http://merchant.test/");
    expect(screen).toContain("The catalog lists research at 0.01 USDC.");
  });

  it("says which scene script is missing", async () => {
    const demo = await demoBed();
    await expect(
      runDemo({
        tools: demo.runtime.tools,
        chain: demo.bed.chain,
        agent: demo.bed.accounts.agent,
        ui: demo.ui,
        scenes: ["runaway"],
        merchant: MERCHANT,
        fetch: demo.fetch,
        model: null,
        scenesDir: mkdtempSync(join(tmpdir(), "leash-empty-")),
      }),
    ).rejects.toThrow(/No recording for "runaway"/);
  });
});
