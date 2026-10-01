import { describe, expect, it, vi } from "vitest";
import { type Executor, runAgent, TOOL_FAILURE } from "../src/loop.ts";
import type { ModelSession, ModelTurn, ToolResult } from "../src/model.ts";
import { createUi } from "../src/ui.ts";

/** A model that plays the given turns and keeps what the loop sends back. */
function scripted(...turns: ModelTurn[]) {
  const sent: Array<{ results: readonly ToolResult[]; note: string | undefined }> = [];
  const play = async (): Promise<ModelTurn> => turns.shift() ?? { steps: [], stop: "end_turn" };
  const session: ModelSession = {
    start: play,
    next: async (results, note) => {
      sent.push({ results, note });
      return play();
    },
  };
  return { session, sent };
}

function harness(execute: Executor = async () => ({ output: { ok: true }, isError: false })) {
  const lines: string[] = [];
  const ui = createUi({ write: (line) => lines.push(line), color: false, explorer: (s) => s });
  return { ui, lines, execute };
}

const call = (id: string, name = "noop"): ModelTurn["steps"][number] => ({
  kind: "tool",
  id,
  name,
  input: {},
});

describe("the agent loop", () => {
  it("runs each call, sends the results back, and prints the answer in full", async () => {
    const { session, sent } = scripted(
      {
        steps: [{ kind: "text", text: "Checking first." }, call("a"), call("b")],
        stop: "tool_use",
      },
      { steps: [{ kind: "text", text: "Line one.\nLine two." }], stop: "end_turn" },
    );
    const { ui, lines, execute } = harness();
    const result = await runAgent({ session, task: "t", execute, ui });
    expect(result.stop).toBe("end_turn");
    expect(sent).toEqual([
      {
        results: [
          { id: "a", content: '{"ok":true}', isError: false },
          { id: "b", content: '{"ok":true}', isError: false },
        ],
        note: undefined,
      },
    ]);
    expect(lines).toEqual([
      "  » Checking first.",
      "  → noop {}",
      "    ✓",
      "  → noop {}",
      "    ✓",
      "",
      "  Line one.",
      "  Line two.",
    ]);
  });

  it("tells the model to stop when a tool itself fails, and shows the failure", async () => {
    const { session, sent } = scripted({ steps: [call("a", "leash_pay")], stop: "tool_use" });
    const { ui, lines } = harness();
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });
    await runAgent({ session, task: "t", execute, ui });
    expect(sent[0]?.results).toEqual([
      { id: "a", content: JSON.stringify(TOOL_FAILURE), isError: true },
    ]);
    expect(lines).toContain("  ! leash_pay failed: boom");
    const strings = vi.fn(async () => Promise.reject("plain string"));
    await runAgent({
      session: scripted({ steps: [call("b")], stop: "tool_use" }).session,
      task: "t",
      execute: strings,
      ui,
    });
    expect(lines).toContain("  ! noop failed: plain string");
  });

  it("never runs the calls of a turn that did not end in tool_use, and says why it stopped", async () => {
    for (const [stop, notice] of [
      ["max_tokens", "The model ran out of output tokens."],
      ["refusal", "The model declined to continue (refusal)."],
      ["diverged", "A live result differs from the script, so the replay stops here."],
    ] as const) {
      const execute = vi.fn();
      const { ui, lines } = harness(execute);
      const result = await runAgent({
        session: scripted({ steps: [call("a")], stop }).session,
        task: "t",
        execute,
        ui,
      });
      expect(result.stop).toBe(stop);
      expect(execute).not.toHaveBeenCalled();
      expect(lines).toContain(`  ⚠ ${notice}`);
    }
  });

  it("stops at the turn limit", async () => {
    const forever = Array.from(
      { length: 5 },
      (_, i): ModelTurn => ({ steps: [call(`c${i}`)], stop: "tool_use" }),
    );
    const { ui, lines, execute } = harness();
    const result = await runAgent({
      session: scripted(...forever).session,
      task: "t",
      execute,
      ui,
      maxTurns: 3,
    });
    expect(result.stop).toBe("max_turns");
    expect(lines.filter((line) => line.includes("→ noop"))).toHaveLength(3);
    expect(lines).toContain("  ⚠ Stopped after 3 model turns.");
  });

  it("waits for the owner only after an approval request, and ends if there is no news", async () => {
    const approval = async () => ({
      output: {
        ok: false,
        code: "APPROVAL_REQUIRED",
        message: "m",
        recorded: false,
        retryable: true,
      },
      isError: true,
    });
    const awaitOwner = vi.fn(async () => null);
    const { ui } = harness();
    const { session, sent } = scripted(
      { steps: [call("a", "leash_fetch")], stop: "tool_use" },
      { steps: [{ kind: "text", text: "Asked the owner." }], stop: "end_turn" },
    );
    const result = await runAgent({ session, task: "t", execute: approval, ui, awaitOwner });
    expect(awaitOwner).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ stop: "end_turn", approvals: 1 });
    expect(sent).toHaveLength(1);
    // Without an approval request, the owner is never waited for.
    const quiet = vi.fn(async () => "news");
    await runAgent({
      session: scripted({ steps: [], stop: "end_turn" }).session,
      task: "t",
      execute: approval,
      ui,
      awaitOwner: quiet,
    });
    expect(quiet).not.toHaveBeenCalled();
  });
});
