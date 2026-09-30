import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/index.ts";

const OWNER = "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9";

describe("configuration", () => {
  it("needs only the owner; everything else has the contract's defaults", () => {
    expect(parseEnv({ AGENT_OWNER: OWNER })).toEqual({
      AGENT_OWNER: OWNER,
      AGENT_KEYPAIR: "~/.config/leash/agent.json",
      LEASH_CLUSTER: "localnet",
      LEASH_PRIORITY_FEE_MICROLAMPORTS: 1,
    });
  });

  it("names what is wrong", () => {
    expect(() => parseEnv({})).toThrow(/AGENT_OWNER/);
    expect(() => parseEnv({ AGENT_OWNER: "not-a-wallet" })).toThrow(/AGENT_OWNER/);
    expect(() => parseEnv({ AGENT_OWNER: OWNER, LEASH_CLUSTER: "mainnet" })).toThrow(
      /LEASH_CLUSTER/,
    );
    expect(() =>
      parseEnv({ AGENT_OWNER: OWNER, LEASH_PRIORITY_FEE_MICROLAMPORTS: "60000" }),
    ).toThrow(/LEASH_PRIORITY_FEE_MICROLAMPORTS/);
    expect(parseEnv({ AGENT_OWNER: OWNER, LEASH_RPC_URL: "" }).LEASH_RPC_URL).toBeUndefined();
  });
});
