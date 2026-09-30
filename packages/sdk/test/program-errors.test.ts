import { LEASH_ERRORS } from "@leash/contracts";
import {
  type Address,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SolanaError,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  ApprovalNotPossibleError,
  findLeashFailure,
  LEASH_PROGRAM_ADDRESS,
  LeashProgramError,
  leashFailureFromCode,
  PaymentDeniedError,
  toSdkError,
} from "../src/index.ts";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111" as Address;
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;
/** `[compute budget, Leash pay, memo]`, the x402 shape. */
const message = {
  instructions: [
    { programAddress: COMPUTE_BUDGET },
    { programAddress: LEASH_PROGRAM_ADDRESS },
    { programAddress: MEMO },
  ],
};
const custom = (code: number, index: number) =>
  new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, { code, index });

describe("leashFailureFromCode", () => {
  it("names every Leash code and marks the twelve denials", () => {
    LEASH_ERRORS.forEach((name, i) => {
      const failure = leashFailureFromCode(6000 + i);
      expect(failure?.name).toBe(name);
      expect(failure?.denial !== null).toBe(i < 12);
    });
    expect(leashFailureFromCode(6003)?.denial).toBe("payeeNotAllowed");
    expect(leashFailureFromCode(5999)).toBeNull();
    expect(leashFailureFromCode(6000 + LEASH_ERRORS.length)).toBeNull();
  });
});

describe("findLeashFailure", () => {
  it("finds a custom error raised by the Leash instruction", () => {
    expect(findLeashFailure(custom(6003, 1), message)).toEqual({
      code: 6003,
      name: "DeniedPayeeNotAllowed",
      denial: "payeeNotAllowed",
      instructionIndex: 1,
    });
  });

  it("follows the cause chain of a preflight failure", () => {
    const preflight = new SolanaError(
      SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
      {
        accounts: null,
        logs: null,
        returnData: null,
        unitsConsumed: 0n,
        cause: custom(6013, 1),
      } as never,
    );
    expect(findLeashFailure(preflight, message)?.name).toBe("InvalidPolicy");
  });

  it("reads the raw error of a simulation", () => {
    expect(findLeashFailure({ InstructionError: [1, { Custom: 6010 }] }, message)?.denial).toBe(
      "allowanceExceeded",
    );
  });

  it("ignores custom errors of other programs and other failures", () => {
    expect(findLeashFailure(custom(6003, 2), message)).toBeNull();
    expect(findLeashFailure({ InstructionError: [0, { Custom: 1 }] }, message)).toBeNull();
    expect(findLeashFailure(new Error("network down"), message)).toBeNull();
    expect(findLeashFailure("AccountInUse", message)).toBeNull();
    expect(findLeashFailure(null, message)).toBeNull();
    expect(findLeashFailure(custom(1, 1), message)).toBeNull();
  });

  it("stops at a cause that is not an error", () => {
    expect(findLeashFailure(new Error("wrapped", { cause: { Custom: 6003 } }), message)).toBeNull();
  });

  it("stops on a cause cycle", () => {
    const loop = new Error("a") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(findLeashFailure(loop, message)).toBeNull();
  });
});

describe("toSdkError", () => {
  const attempted = { to: "merchant", amount: 10n };
  const failure = (code: number) => {
    const found = leashFailureFromCode(code);
    if (!found) throw new Error(`unknown code ${code}`);
    return found;
  };

  it("turns a denial into an unrecorded PaymentDeniedError", () => {
    const error = toSdkError(failure(6004), attempted);
    expect(error).toBeInstanceOf(PaymentDeniedError);
    expect(error).toMatchObject({ reason: "exceedsPaymentLimit", recorded: false, attempted });
  });

  it("turns refused approval requests into ApprovalNotPossibleError", () => {
    expect(toSdkError(failure(6027), attempted)).toEqual(new ApprovalNotPossibleError("notNeeded"));
    expect(toSdkError(failure(6028), attempted)).toEqual(
      new ApprovalNotPossibleError("tooManyOpen"),
    );
  });

  it("wraps everything else as a LeashProgramError", () => {
    const error = toSdkError(failure(6019), attempted);
    expect(error).toBeInstanceOf(LeashProgramError);
    expect(error).toMatchObject({
      code: "PROGRAM_ERROR",
      programError: "DelegationMismatch",
      errorCode: 6019,
    });
  });
});
