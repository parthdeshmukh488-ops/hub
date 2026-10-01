import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { keypairAddress, parseCliArgs, resolveGuardian } from "../src/args.ts";
import { parseEnv } from "../src/env.ts";
import { createIndexerClient, IndexerError } from "../src/indexer-client.ts";
import { formatAlert } from "../src/notifiers/console.ts";
import { key, OWNER, RESEARCH } from "./helpers.ts";

const GUARDIAN = key("guardian");

/** A throwaway keypair file in `solana-keygen` format, and its address. */
function keypairFile(): { path: string; address: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const path = join(mkdtempSync(join(tmpdir(), "sentinel-")), "guardian.json");
  writeFileSync(path, JSON.stringify([...seed, ...pub]));
  return { path, address: getAddressDecoder().decode(pub) };
}

describe("env", () => {
  it("has the defaults of 02 §13, and empty strings count as unset", () => {
    expect(parseEnv({ SENTINEL_WEB_URL: "" })).toEqual({
      LEASH_CLUSTER: "localnet",
      SENTINEL_INDEXER_URL: "http://localhost:4100",
      SENTINEL_AUTOFREEZE: false,
      SENTINEL_WEB_URL: "http://localhost:3000",
      LOG_LEVEL: "info",
    });
  });

  it("only turns autofreeze on for exactly true", () => {
    expect(parseEnv({ SENTINEL_AUTOFREEZE: "true" }).SENTINEL_AUTOFREEZE).toBe(true);
    expect(() => parseEnv({ SENTINEL_AUTOFREEZE: "yes" })).toThrow(/SENTINEL_AUTOFREEZE/);
  });

  it("never repeats the bot token in an error", () => {
    const token = "123456:SECRET-token";
    expect(() => parseEnv({ TELEGRAM_BOT_TOKEN: token, LOG_LEVEL: "loud" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("SECRET") }),
    );
  });
});

describe("command line", () => {
  it("reads --guardian and --config", () => {
    expect(parseCliArgs(["--guardian", GUARDIAN, "--config", "x.json"])).toEqual({
      guardian: GUARDIAN,
      config: "x.json",
    });
    expect(parseCliArgs([])).toEqual({ guardian: null, config: null });
  });

  it("rejects unknown flags and bad addresses, with the usage", () => {
    expect(() => parseCliArgs(["--scripted"])).toThrow(/Usage: sentinel/);
    expect(() => parseCliArgs(["--guardian", "nope"])).toThrow(/not a Solana address/);
  });
});

describe("whose principals to watch", () => {
  it("takes the flag, or the keypair's address", async () => {
    const keypair = keypairFile();
    expect(await keypairAddress(keypair.path)).toBe(keypair.address);
    expect(await resolveGuardian(GUARDIAN, undefined)).toBe(GUARDIAN);
    expect(await resolveGuardian(null, keypair.path)).toBe(keypair.address);
    expect(await resolveGuardian(keypair.address, keypair.path)).toBe(keypair.address);
  });

  it("refuses a flag that differs from the keypair", async () => {
    await expect(resolveGuardian(GUARDIAN, keypairFile().path)).rejects.toThrow(/differs/);
  });

  it("exits with a clear message with neither", async () => {
    await expect(resolveGuardian(null, undefined)).rejects.toThrow(
      /Pass --guardian <address> \(watch-only\), or set SENTINEL_GUARDIAN_KEYPAIR/,
    );
  });

  it("never prints a broken keypair file", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "sentinel-")), "bad.json");
    writeFileSync(path, JSON.stringify([7, 7, 7]));
    await expect(keypairAddress(path)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("7,7") }),
    );
    await expect(keypairAddress(join(path, "missing"))).rejects.toThrow(/Cannot read/);
  });
});

describe("indexer client", () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });

  it("builds the routes of 02 §7.1 and the stream URL", async () => {
    const urls: string[] = [];
    const client = createIndexerClient("https://indexer.example/", async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ items: [], nextBefore: null }));
    });
    await client.ownerEvents(OWNER, { after: `${"A".repeat(64)}:0`, limit: 200 });
    expect(urls).toEqual([
      `https://indexer.example/v1/owners/${OWNER}/events?limit=200&after=${"A".repeat(64)}%3A0`,
    ]);
    expect(client.streamUrl).toBe("wss://indexer.example/v1/stream");
  });

  it("turns error bodies and bad responses into IndexerError", async () => {
    const missing = createIndexerClient(
      "http://x",
      respond(404, { error: { code: "NOT_FOUND", message: "No agent at this address" } }),
    );
    await expect(missing.agent(RESEARCH)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    const odd = createIndexerClient("http://x", respond(200, { owners: ["nope"] }));
    await expect(odd.guardianOwners(GUARDIAN)).rejects.toBeInstanceOf(IndexerError);
  });
});

describe("console notifier", () => {
  it("prints the severity, title, body and links", () => {
    expect(
      formatAlert({
        id: "x",
        severity: "warning",
        kind: "spend_spike",
        owner: OWNER,
        agent: RESEARCH,
        title: "Unusual spending",
        body: "Body.",
        actions: [{ label: "Open agent", url: "http://localhost:3000/app/agents/a" }],
        eventIds: [],
        createdAt: 0,
      }),
    ).toBe(
      "[WARNING] Unusual spending\n  Body.\n  → Open agent: http://localhost:3000/app/agents/a\n",
    );
  });
});
