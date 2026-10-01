import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.ts";
import { parseEnv } from "../src/env.ts";
import { parseScenes, STORYLINE } from "../src/scenes.ts";

const OWNER = "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9";
const llm = { AGENT_MODE: "llm" as const, ANTHROPIC_API_KEY: "test-key" };
const noKey = { AGENT_MODE: "llm" as const, ANTHROPIC_API_KEY: undefined };

describe("command line", () => {
  it("runs the storyline by default, or the scenes named", () => {
    expect(STORYLINE).toEqual(["normal", "approval", "injection"]);
    expect(parseArgs([], llm)).toEqual({ scenes: STORYLINE, scripted: false, record: false });
    expect(parseArgs(["all", "--scripted"], noKey)).toEqual({
      scenes: STORYLINE,
      scripted: true,
      record: false,
    });
    expect(parseArgs(["--", "--scripted"], noKey)).toEqual({
      scenes: STORYLINE,
      scripted: true,
      record: false,
    });
    expect(parseArgs(["runaway", "normal", "--record"], llm)).toMatchObject({
      scenes: ["runaway", "normal"],
      record: true,
    });
    expect(
      parseArgs(["injection"], { AGENT_MODE: "scripted", ANTHROPIC_API_KEY: undefined }),
    ).toMatchObject({
      scripted: true,
    });
  });

  it("explains what is wrong", () => {
    expect(() => parseArgs(["dance"], llm)).toThrow(/Unknown scene "dance"/);
    expect(() => parseScenes(["normal", "nope"])).toThrow(
      /Scenes: normal, approval, injection, runaway, all/,
    );
    expect(() => parseArgs(["--fast"], llm)).toThrow(/Unknown option --fast/);
    expect(() => parseArgs(["--scripted", "--record"], llm)).toThrow(/does not combine/);
    expect(() => parseArgs(["normal"], noKey)).toThrow(/needs ANTHROPIC_API_KEY.*--scripted/);
  });
});

describe("configuration", () => {
  it("needs the owner; the rest has the contract's defaults, and the API key is optional", () => {
    expect(parseEnv({ AGENT_OWNER: OWNER })).toEqual({
      AGENT_OWNER: OWNER,
      AGENT_KEYPAIR: "~/.config/leash/agent.json",
      AGENT_MODE: "llm",
      AGENT_MODEL: "claude-opus-5-5",
      AGENT_MERCHANT_URL: "http://localhost:4300",
      LEASH_CLUSTER: "localnet",
      LEASH_PRIORITY_FEE_MICROLAMPORTS: 1,
    });
    expect(() => parseEnv({})).toThrow(/AGENT_OWNER/);
    expect(() => parseEnv({ AGENT_OWNER: OWNER, AGENT_MODE: "chaos" })).toThrow(/AGENT_MODE/);
    expect(() => parseEnv({ AGENT_OWNER: OWNER, AGENT_MERCHANT_URL: "merchant" })).toThrow(
      /AGENT_MERCHANT_URL/,
    );
    expect(
      parseEnv({ AGENT_OWNER: OWNER, ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY,
    ).toBeUndefined();
  });
});
