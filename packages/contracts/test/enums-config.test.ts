import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AddressSchema,
  anchorErrorCodeFor,
  DEFAULT_PORTS,
  DENIAL_REASON_NAMES,
  DENIAL_REASONS,
  DENIAL_TOOL_CODES,
  denialFromAnchorErrorCode,
  denialFromCode,
  ENV_VARS,
  explorerTxUrl,
  isLeashProgramIdPlaceholder,
  isStrike,
  LEASH_ERRORS,
  LEASH_PROGRAM_ID_PLACEHOLDER,
  leashErrorName,
  leashSmartWalletAllowlist,
  PROGRAM_IDS,
  resolveClusterConfig,
  X402_DEFAULT_SMART_WALLET_PROGRAMS,
} from "../src/index.ts";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

describe("DenialReason master table", () => {
  it("has codes 1–12 in order, matching the name list", () => {
    expect(DENIAL_REASONS.map((d) => d.code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(DENIAL_REASONS.map((d) => d.name)).toEqual([...DENIAL_REASON_NAMES]);
    expect(DENIAL_REASONS.map((d) => d.toolCode)).toEqual([...DENIAL_TOOL_CODES]);
  });

  it("maps denials to Anchor codes 6000–6011 and back", () => {
    for (const denial of DENIAL_REASONS) {
      const code = anchorErrorCodeFor(denial.name);
      expect(code).toBe(6000 + denial.code - 1);
      expect(denialFromAnchorErrorCode(code)).toBe(denial.name);
      expect(leashErrorName(code)).toBe(denial.anchorError);
    }
    expect(denialFromAnchorErrorCode(6012)).toBeNull();
    expect(denialFromCode(0)).toBeNull();
    expect(denialFromCode(13)).toBeNull();
  });

  it("strikes exactly the reasons that signal manipulation or a bug", () => {
    expect(DENIAL_REASONS.filter((d) => isStrike(d.name)).map((d) => d.name)).toEqual([
      "payeeNotAllowed",
      "exceedsPaymentLimit",
      "exceedsPayeePaymentLimit",
    ]);
  });
});

describe("LeashError list (01-onchain-program §10)", () => {
  it("has the documented codes", () => {
    expect(LEASH_ERRORS).toHaveLength(32);
    expect(leashErrorName(6012)).toBe("Unauthorized");
    expect(leashErrorName(6029)).toBe("AttemptWouldSucceed");
    expect(leashErrorName(6031)).toBe("MathOverflow");
    expect(leashErrorName(6032)).toBeNull();
    expect(new Set(LEASH_ERRORS).size).toBe(LEASH_ERRORS.length);
  });
});

describe("config", () => {
  it("derives the program-ID placeholder from its documented hash", () => {
    const digest = createHash("sha256").update("leash:program-id-placeholder").digest();
    expect(base58(digest)).toBe(LEASH_PROGRAM_ID_PLACEHOLDER);
    expect(isLeashProgramIdPlaceholder(PROGRAM_IDS.leash)).toBe(true);
  });

  it("has valid addresses for every program", () => {
    for (const id of Object.values(PROGRAM_IDS)) expect(AddressSchema.parse(id)).toBe(id);
  });

  it("resolves defaults and overrides without reading the environment", () => {
    const devnet = resolveClusterConfig("devnet");
    expect(devnet.x402Network).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    expect(devnet.usdcMint).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const custom = resolveClusterConfig("localnet", {
      rpcUrl: "http://localhost:9999",
      leashProgramId: PROGRAM_IDS.memo,
    });
    expect(custom.rpcUrl).toBe("http://localhost:9999");
    expect(custom.programIds.leash).toBe(PROGRAM_IDS.memo);
    expect(custom.usdcMint).toBeNull();
  });

  it("builds explorer links per cluster", () => {
    expect(explorerTxUrl(resolveClusterConfig("devnet"), "sig")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=devnet",
    );
    expect(explorerTxUrl(resolveClusterConfig("localnet"), "sig")).toContain(
      "customUrl=http%3A%2F%2F127.0.0.1%3A8899",
    );
  });

  it("lists every environment variable once, with keypairs only as paths", () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const v of ENV_VARS) {
      expect(v.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      if (v.name.endsWith("_KEYPAIR")) expect(v.keypairPath).toBe(true);
    }
  });

  it("keeps ports distinct", () => {
    const ports = Object.values(DEFAULT_PORTS);
    expect(new Set(ports).size).toBe(ports.length);
  });
});

describe("x402 allowlist", () => {
  it("adds Leash to the official defaults without dropping any", () => {
    const list = leashSmartWalletAllowlist(PROGRAM_IDS.leash);
    expect(list).toEqual([...X402_DEFAULT_SMART_WALLET_PROGRAMS, PROGRAM_IDS.leash]);
  });
});
