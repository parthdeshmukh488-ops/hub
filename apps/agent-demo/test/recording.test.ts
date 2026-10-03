import { describe, expect, it } from "vitest";
import type { Model, ModelTurn } from "../src/model.ts";
import { outcomeOf, type Recording, recordingModel, replayModel } from "../src/recording.ts";

const turns: ModelTurn[] = [
  {
    steps: [
      { kind: "thinking", text: "Look at http://localhost:4300/ first." },
      { kind: "tool", id: "t1", name: "browse", input: { url: "http://localhost:4300/" } },
      {
        kind: "tool",
        id: "t2",
        name: "leash_fetch",
        input: { url: "http://localhost:4300/api/research?q=x", purpose: "p" },
      },
    ],
    stop: "tool_use",
  },
  { steps: [{ kind: "text", text: "Done." }], stop: "end_turn" },
];

const fakeModel = (): Model => ({
  label: "claude-opus-5-5",
  session() {
    const queue = structuredClone(turns);
    const play = async () => queue.shift() ?? { steps: [], stop: "end_turn" as const };
    return { start: play, next: play };
  },
});

describe("recording and replay", () => {
  it("records a run with the merchant's URL as a placeholder and each call's outcome", async () => {
    const recorder = recordingModel(fakeModel(), { merchant: "http://localhost:4300" });
    const session = recorder.model.session();
    expect(recorder.model.label).toBe("claude-opus-5-5");
    // The live run still sees the real URL.
    expect((await session.start("t")).steps[1]).toMatchObject({
      input: { url: "http://localhost:4300/" },
    });
    await session.next([
      { id: "t1", content: '{"ok":true,"status":200}', isError: false },
      { id: "t2", content: '{"ok":false,"code":"PAYEE_NOT_ALLOWED"}', isError: true },
    ]);
    expect(recorder.turns).toEqual([
      {
        steps: [
          { kind: "thinking", text: "Look at {merchant}/ first." },
          { kind: "tool", id: "t1", name: "browse", input: { url: "{merchant}/" }, expect: "ok" },
          {
            kind: "tool",
            id: "t2",
            name: "leash_fetch",
            input: { url: "{merchant}/api/research?q=x", purpose: "p" },
            expect: "PAYEE_NOT_ALLOWED",
          },
        ],
        stop: "tool_use",
      },
      { steps: [{ kind: "text", text: "Done." }], stop: "end_turn" },
    ]);
  });

  it("replays against any merchant, stops on a different live result, then ends the turn", async () => {
    const recording: Recording = {
      version: 1,
      scene: "normal",
      source: "llm",
      model: "claude-opus-5-5",
      recordedAt: "2026-10-01T00:00:00.000Z",
      disclosure: "Replay of a recorded run.",
      turns: [
        {
          steps: [
            { kind: "tool", id: "t1", name: "browse", input: { url: "{merchant}/" }, expect: "ok" },
          ],
          stop: "tool_use",
        },
        { steps: [{ kind: "text", text: "Done." }], stop: "end_turn" },
      ],
    };
    const model = replayModel(recording, { merchant: "http://merchant.test" });
    expect(model.label).toBe("replay of claude-opus-5-5 (2026-10-01T00:00:00.000Z)");
    const same = model.session();
    expect((await same.start("t")).steps[0]).toMatchObject({
      input: { url: "http://merchant.test/" },
    });
    expect(await same.next([{ id: "t1", content: '{"ok":true}', isError: false }])).toMatchObject({
      stop: "end_turn",
    });
    expect(await same.next([])).toEqual({ steps: [], stop: "end_turn" });

    const other = model.session();
    await other.start("t");
    expect(
      await other.next([
        { id: "t1", content: '{"ok":false,"code":"NETWORK_ERROR"}', isError: true },
      ]),
    ).toEqual({
      steps: [],
      stop: "diverged",
    });
    expect(
      replayModel({ ...recording, source: "script", model: null }, { merchant: "x" }).label,
    ).toBe("scripted replay");
    expect(
      replayModel({ ...recording, model: null, recordedAt: null }, { merchant: "x" }).label,
    ).toBe("replay of a model (undated)");
  });

  it("plays a turn written for the owner's approval only after an approval", async () => {
    const recording: Recording = {
      version: 1,
      scene: "approval",
      source: "script",
      model: null,
      recordedAt: null,
      disclosure: "Scripted.",
      turns: [
        { steps: [{ kind: "text", text: "Asked the owner." }], stop: "end_turn" },
        {
          steps: [{ kind: "text", text: "Approved, buying." }],
          stop: "end_turn",
          afterApproval: true,
        },
      ],
    };
    const declined = replayModel(recording, { merchant: "x" }).session();
    await declined.start("t");
    expect(await declined.next([], "declined", { ownerApproved: false })).toEqual({
      steps: [],
      stop: "diverged",
    });
    const approved = replayModel(recording, { merchant: "x" }).session();
    await approved.start("t");
    expect((await approved.next([], "approved", { ownerApproved: true })).steps).toEqual([
      { kind: "text", text: "Approved, buying." },
    ]);
    // Recording marks the turn that answered an approval.
    const recorder = recordingModel(fakeModel(), { merchant: "http://localhost:4300" });
    const session = recorder.model.session();
    await session.start("t");
    await session.next([], "The owner approved.", { ownerApproved: true });
    expect(recorder.turns[1]?.afterApproval).toBe(true);
    expect(recorder.turns[0]?.afterApproval).toBeUndefined();
  });

  it("reads a tool's outcome from its JSON", () => {
    expect(outcomeOf('{"ok":true}')).toBe("ok");
    expect(outcomeOf('{"ok":false,"code":"AGENT_FROZEN"}')).toBe("AGENT_FROZEN");
    expect(outcomeOf('{"ok":false,"error":"x"}')).toBe("error");
    expect(outcomeOf("not json")).toBe("error");
  });

  it("tells a paid fetch from a free or failed one", () => {
    const paid = '{"ok":true,"status":200,"payment":{"signature":"s"}}';
    expect(outcomeOf(paid, "leash_fetch")).toBe("paid");
    expect(outcomeOf('{"ok":true,"status":200,"payment":null}', "leash_fetch")).toBe("ok");
    expect(outcomeOf('{"ok":true,"status":500,"payment":null}', "leash_fetch")).toBe("http_500");
    expect(outcomeOf('{"ok":true,"status":502,"payment":{"signature":"s"}}', "leash_fetch")).toBe(
      "http_502",
    );
    // Other tools keep `ok`: a browse that meets a 402 is the expected answer.
    expect(outcomeOf('{"ok":true,"status":402}', "browse")).toBe("ok");
    expect(outcomeOf(paid, "leash_pay")).toBe("ok");
  });
});
