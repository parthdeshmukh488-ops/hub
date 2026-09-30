import type { ModelSession, ModelTurn, ToolResult } from "./model.ts";
import { emptyOutcome, type Outcome, tally } from "./outcome.ts";
import type { Ui } from "./ui.ts";

// The agent loop: the model decides, the tools act, the screen shows each step. The loop has no
// policy logic: what a payment may do is decided by the SDK and the program.

export type ToolExecution = { output: unknown; isError: boolean };
export type Executor = (name: string, input: unknown) => Promise<ToolExecution>;

export type RunOptions = {
  session: ModelSession;
  task: string;
  execute: Executor;
  ui: Ui;
  /** Model turns at most. Default 24. */
  maxTurns?: number;
  /**
   * Called when the model ends its turn while an approval request it caused is open. Returns a
   * message for the model (the owner's decision), or null to end the scene.
   */
  awaitOwner?: () => Promise<string | null>;
};

export type RunResult = Outcome & { stop: ModelTurn["stop"] | "max_turns" };

/** What the model gets when a tool itself fails: no details (T17), and a clear stop. */
export const TOOL_FAILURE = {
  ok: false,
  error: "The tool failed internally. Stop and tell your user; do not retry payments.",
} as const;

const approvalRequired = (output: unknown) =>
  (output as { code?: unknown } | null)?.code === "APPROVAL_REQUIRED";

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const { session, execute, ui } = options;
  const maxTurns = options.maxTurns ?? 24;
  const outcome = emptyOutcome();
  let awaitingOwner = false;
  let turn = await session.start(options.task);
  for (let count = 1; ; count++) {
    const results: ToolResult[] = [];
    for (const step of turn.steps) {
      if (step.kind === "thinking") ui.thinking(step.text);
      else if (step.kind === "text") ui.say(step.text, turn.stop !== "tool_use");
      else if (turn.stop === "tool_use") {
        ui.call(step.name, step.input);
        let run: ToolExecution;
        try {
          run = await execute(step.name, step.input);
        } catch (error) {
          ui.error(
            `${step.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          run = { output: TOOL_FAILURE, isError: true };
        }
        ui.result(step.name, run.output);
        if (tally(outcome, run.output)) ui.tripwire();
        if (approvalRequired(run.output)) awaitingOwner = true;
        results.push({ id: step.id, content: JSON.stringify(run.output), isError: run.isError });
      }
    }
    if (count >= maxTurns && (results.length > 0 || awaitingOwner)) {
      ui.notice(`Stopped after ${maxTurns} model turns.`);
      return { ...outcome, stop: "max_turns" };
    }
    if (results.length > 0) {
      turn = await session.next(results);
      continue;
    }
    if (turn.stop === "end_turn" && awaitingOwner && options.awaitOwner) {
      awaitingOwner = false;
      const note = await options.awaitOwner();
      if (note) {
        turn = await session.next([], note);
        continue;
      }
    }
    if (turn.stop === "refusal") ui.notice("The model declined to continue (refusal).");
    if (turn.stop === "max_tokens") ui.notice("The model ran out of output tokens.");
    return { ...outcome, stop: turn.stop };
  }
}
