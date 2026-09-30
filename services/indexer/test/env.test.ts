import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.ts";

describe("env", () => {
  it("has working defaults (fixture replay on port 4100)", () => {
    expect(parseEnv({})).toMatchObject({
      LEASH_CLUSTER: "localnet",
      INDEXER_PORT: 4100,
      INDEXER_SOURCE: "fixtures",
      INDEXER_REPLAY_SPEED: 1,
      INDEXER_REPLAY_LOOP: true,
      WEB_ORIGIN: "http://localhost:3000",
    });
  });

  it("parses values and treats empty strings as unset", () => {
    const env = parseEnv({
      INDEXER_REPLAY_SPEED: "0",
      INDEXER_REPLAY_LOOP: "false",
      INDEXER_PORT: "",
      LEASH_CLUSTER: "devnet",
    });
    expect(env).toMatchObject({
      INDEXER_REPLAY_SPEED: 0,
      INDEXER_REPLAY_LOOP: false,
      INDEXER_PORT: 4100,
      LEASH_CLUSTER: "devnet",
    });
  });

  it("fails fast with a readable message", () => {
    expect(() => parseEnv({ INDEXER_SOURCE: "blockchain", INDEXER_REPLAY_SPEED: "-1" })).toThrow(
      /INDEXER_SOURCE[\s\S]*INDEXER_REPLAY_SPEED/,
    );
  });
});
