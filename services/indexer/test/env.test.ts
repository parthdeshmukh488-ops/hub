import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.ts";

describe("env", () => {
  it("has the contract's defaults: chain mode on localnet, port 4100", () => {
    expect(parseEnv({})).toMatchObject({
      LEASH_CLUSTER: "localnet",
      INDEXER_PORT: 4100,
      INDEXER_SOURCE: "chain",
      INDEXER_BACKFILL_LIMIT: 1000,
      INDEXER_POLL_INTERVAL_MS: 15_000,
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
      LEASH_RPC_URL: "https://devnet.helius-rpc.com/",
    });
    expect(env).toMatchObject({
      LEASH_RPC_URL: "https://devnet.helius-rpc.com/",
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
