import Anthropic from "@anthropic-ai/sdk";

// The model behind the agent loop. Claude (LLM mode) and a recording (scripted mode) implement the
// same interface, so both drive the same loop, tools and screen.

export type Step =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown };

/** Why a turn ended: tools to run, done, or a stop the loop reports. */
export type StopKind = "tool_use" | "end_turn" | "max_tokens" | "refusal" | "other";

export type ModelTurn = { steps: Step[]; stop: StopKind };

/** A tool's result as the model sees it: the tool's JSON output. */
export type ToolResult = { id: string; content: string; isError: boolean };

/** One conversation. */
export interface ModelSession {
  /** The first turn, for the user's task. */
  start(task: string): Promise<ModelTurn>;
  /** The next turn, after the tools of the last one ran; `note` adds a message (e.g. the owner decided). */
  next(results: readonly ToolResult[], note?: string): Promise<ModelTurn>;
}

export interface Model {
  /** For the screen: the model ID, or which recording plays. */
  readonly label: string;
  session(): ModelSession;
}

/** The part of the Anthropic client the loop uses (`client.messages`). */
export type MessageStreamer = {
  stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
};

export type ClaudeModelOptions = {
  messages: MessageStreamer;
  /** `AGENT_MODEL`, default `claude-opus-5-5`. */
  model: string;
  system: string;
  tools: ReadonlyArray<Pick<Anthropic.Tool, "name" | "description" | "input_schema">>;
  /** Default `medium`, the model's own default, set explicitly. */
  effort?: "low" | "medium" | "high";
  /** Default 16 000. */
  maxTokens?: number;
};

const STOPS: Partial<Record<Anthropic.StopReason, StopKind>> = {
  tool_use: "tool_use",
  end_turn: "end_turn",
  stop_sequence: "end_turn",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

/** The steps of a Claude message: thinking summaries, text, tool calls, in order. */
export function stepsOf(message: Anthropic.Message): ModelTurn {
  const steps: Step[] = [];
  for (const block of message.content) {
    if (block.type === "thinking" && block.thinking.trim()) {
      steps.push({ kind: "thinking", text: block.thinking });
    } else if (block.type === "text" && block.text.trim()) {
      steps.push({ kind: "text", text: block.text });
    } else if (block.type === "tool_use") {
      steps.push({ kind: "tool", id: block.id, name: block.name, input: block.input });
    }
  }
  return { steps, stop: (message.stop_reason && STOPS[message.stop_reason]) ?? "other" };
}

/** A tool input that could not be parsed at all is asked for again, at most this often. */
const PARSE_RETRIES = 2;

/**
 * Claude through the Messages API: adaptive thinking with summaries shown, explicit effort,
 * streaming (long pages make long inputs), prompt caching of the stable prefix. Tools stream their
 * input eagerly; every input is validated by its tool (zod) before anything runs.
 */
export function claudeModel(options: ClaudeModelOptions): Model {
  const tools: Anthropic.Tool[] = options.tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    input_schema: tool.input_schema,
    eager_input_streaming: true,
  }));
  return {
    label: options.model,
    session() {
      const messages: Anthropic.MessageParam[] = [];
      async function turn(): Promise<ModelTurn> {
        for (let attempt = 0; ; attempt++) {
          const stream = options.messages.stream({
            model: options.model,
            max_tokens: options.maxTokens ?? 16_000,
            system: options.system,
            tools,
            messages,
            thinking: { type: "adaptive", display: "summarized" },
            output_config: { effort: options.effort ?? "medium" },
            cache_control: { type: "ephemeral" },
          });
          let message: Anthropic.Message;
          try {
            message = await stream.finalMessage();
          } catch (error) {
            // API errors are real failures; anything else is a tool input the stream could not parse.
            if (error instanceof Anthropic.APIError || attempt >= PARSE_RETRIES) throw error;
            continue;
          }
          messages.push({ role: "assistant", content: message.content });
          return stepsOf(message);
        }
      }
      return {
        start(task) {
          messages.push({ role: "user", content: task });
          return turn();
        },
        next(results, note) {
          const content: Anthropic.ContentBlockParam[] = results.map((result) => ({
            type: "tool_result",
            tool_use_id: result.id,
            content: result.content,
            ...(result.isError ? { is_error: true } : {}),
          }));
          if (note) content.push({ type: "text", text: note });
          messages.push({ role: "user", content });
          return turn();
        },
      };
    },
  };
}
