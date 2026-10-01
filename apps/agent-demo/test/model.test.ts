import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS } from "@leash/tools";
import { describe, expect, it } from "vitest";
import { BROWSE_TOOL } from "../src/browse.ts";
import { claudeModel, type MessageStreamer, stepsOf } from "../src/model.ts";
import { SYSTEM_PROMPT } from "../src/prompt.ts";

const message = (
  content: unknown[],
  stop_reason: Anthropic.StopReason | null = "end_turn",
): Anthropic.Message => ({ content, stop_reason }) as unknown as Anthropic.Message;

/** A Messages API stand-in: answers from a queue and keeps every request. */
function fakeApi(...answers: Array<Anthropic.Message | Error>) {
  const requests: Anthropic.MessageStreamParams[] = [];
  const messages: MessageStreamer = {
    stream(params) {
      // The adapter keeps one messages array; snapshot it as sent.
      requests.push(structuredClone(params));
      const answer = answers.shift() ?? new Error("no more answers");
      return {
        finalMessage: async () => {
          if (answer instanceof Error) throw answer;
          return answer;
        },
      };
    },
  };
  return { messages, requests };
}

const tools = [...TOOL_DEFINITIONS, BROWSE_TOOL];

describe("the Claude adapter", () => {
  it("asks with the demo's settings: adaptive thinking shown as summaries, explicit effort, caching, eager tool input", async () => {
    const api = fakeApi(message([{ type: "text", text: "Done." }]));
    const model = claudeModel({
      messages: api.messages,
      model: "claude-opus-5-5",
      system: SYSTEM_PROMPT,
      tools,
    });
    expect(model.label).toBe("claude-opus-5-5");
    const turn = await model.session().start("Find me an e-bike.");
    expect(turn).toEqual({ steps: [{ kind: "text", text: "Done." }], stop: "end_turn" });
    const [request] = api.requests;
    expect(request).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      messages: [{ role: "user", content: "Find me an e-bike." }],
    });
    expect(request?.tools?.map((tool) => (tool as { name?: string }).name)).toEqual([
      "leash_fetch",
      "leash_pay",
      "leash_request_approval",
      "leash_status",
      "browse",
    ]);
    for (const tool of request?.tools ?? []) {
      expect(tool).toMatchObject({ eager_input_streaming: true });
    }
    expect(request).not.toHaveProperty("tool_choice");
  });

  it("sends tool results back with the assistant turn, errors marked, and the owner's note after them", async () => {
    const toolTurn = message(
      [
        { type: "thinking", thinking: "Check the budget.", signature: "sig" },
        { type: "tool_use", id: "toolu_1", name: "leash_status", input: {} },
        { type: "tool_use", id: "toolu_2", name: "leash_pay", input: { to: "x" } },
      ],
      "tool_use",
    );
    const api = fakeApi(toolTurn, message([{ type: "text", text: "Waiting." }]));
    const session = claudeModel({
      messages: api.messages,
      model: "claude-opus-5-5",
      system: "s",
      tools,
      effort: "low",
      maxTokens: 4_000,
    }).session();
    expect(await session.start("task")).toEqual({
      steps: [
        { kind: "thinking", text: "Check the budget." },
        { kind: "tool", id: "toolu_1", name: "leash_status", input: {} },
        { kind: "tool", id: "toolu_2", name: "leash_pay", input: { to: "x" } },
      ],
      stop: "tool_use",
    });
    await session.next(
      [
        { id: "toolu_1", content: '{"ok":true}', isError: false },
        { id: "toolu_2", content: '{"ok":false}', isError: true },
      ],
      "The owner approved.",
    );
    expect(api.requests[1]).toMatchObject({ max_tokens: 4_000, output_config: { effort: "low" } });
    expect(api.requests[1]?.messages).toEqual([
      { role: "user", content: "task" },
      { role: "assistant", content: toolTurn.content },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: '{"ok":true}' },
          { type: "tool_result", tool_use_id: "toolu_2", content: '{"ok":false}', is_error: true },
          { type: "text", text: "The owner approved." },
        ],
      },
    ]);
  });

  it("asks again when a streamed tool input cannot be parsed, at most twice, and never retries API errors", async () => {
    const parse = () => new SyntaxError("Unexpected end of JSON input");
    const ok = message([{ type: "text", text: "Fine." }]);
    const retried = fakeApi(parse(), parse(), ok);
    const model = (api: ReturnType<typeof fakeApi>) =>
      claudeModel({ messages: api.messages, model: "m", system: "s", tools });
    expect((await model(retried).session().start("t")).stop).toBe("end_turn");
    expect(retried.requests).toHaveLength(3);

    const broken = fakeApi(parse(), parse(), parse());
    await expect(model(broken).session().start("t")).rejects.toThrow(SyntaxError);

    const limited = fakeApi(new Anthropic.RateLimitError(429, {}, "slow down", new Headers()));
    await expect(model(limited).session().start("t")).rejects.toBeInstanceOf(
      Anthropic.RateLimitError,
    );
    expect(limited.requests).toHaveLength(1);
  });

  it("maps every stop reason, and keeps only blocks the screen shows", () => {
    const stops: Array<[Anthropic.StopReason | null, string]> = [
      ["tool_use", "tool_use"],
      ["end_turn", "end_turn"],
      ["stop_sequence", "end_turn"],
      ["max_tokens", "max_tokens"],
      ["refusal", "refusal"],
      ["pause_turn", "other"],
      ["model_context_window_exceeded", "other"],
      [null, "other"],
    ];
    for (const [reason, stop] of stops) expect(stepsOf(message([], reason)).stop).toBe(stop);
    expect(
      stepsOf(
        message([
          { type: "thinking", thinking: "  ", signature: "s" },
          { type: "redacted_thinking", data: "x" },
          { type: "text", text: "\n" },
          { type: "server_tool_use", id: "s", name: "web_search", input: {} },
          { type: "text", text: "Answer." },
        ]),
      ).steps,
    ).toEqual([{ kind: "text", text: "Answer." }]);
  });
});
