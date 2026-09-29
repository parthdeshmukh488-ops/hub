/** Error codes thrown by the SDK. Tool and denial codes come from @leash/contracts. */
export type LeashSdkErrorCode = "UNSUPPORTED_DELEGATION" | "INVALID_ACCOUNT_DATA";

/** Base class of every error the SDK throws. `code` is stable; `message` is for humans. */
export class LeashSdkError extends Error {
  readonly code: LeashSdkErrorCode;

  constructor(code: LeashSdkErrorCode, message: string) {
    super(message);
    this.name = "LeashSdkError";
    this.code = code;
  }
}
