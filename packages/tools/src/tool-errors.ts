import {
  denialInfo,
  TOOL_ERROR_MESSAGES,
  TOOL_MESSAGE_RECORDED,
  type ToolError,
  type ToolErrorCode,
} from "@leash/contracts";
import {
  ApprovalNotPossibleError,
  LeashNetworkError,
  MerchantRejectedError,
  NotPairedError,
  PaymentDeniedError,
  UnsupportedPaymentError,
} from "@leash/sdk";

/** Codes where calling again later can succeed without changing anything. */
const RETRYABLE: ReadonlySet<ToolErrorCode> = new Set([
  "APPROVAL_REQUIRED",
  "INVALID_INPUT",
  "MERCHANT_REJECTED",
  "NETWORK_ERROR",
]);

/**
 * A tool error with the contract's fixed message (02-contracts §8). The "recorded" sentence is
 * kept only when the attempt really is on-chain. `detail` appends facts the model needs, such
 * as a request address; it never carries text from an underlying error (T17).
 */
export function toolError(
  code: ToolErrorCode,
  options: {
    recorded?: boolean;
    strikes?: number | undefined;
    frozen?: boolean | undefined;
    detail?: string;
  } = {},
): ToolError {
  const recorded = options.recorded ?? false;
  let message = TOOL_ERROR_MESSAGES[code];
  if (!recorded) message = message.replace(`${TOOL_MESSAGE_RECORDED} `, "");
  if (options.detail) message = `${message} ${options.detail}`;
  return {
    ok: false,
    code,
    message,
    recorded,
    ...(options.strikes === undefined ? {} : { strikes: options.strikes }),
    ...(options.frozen === undefined ? {} : { frozen: options.frozen }),
    retryable: RETRYABLE.has(code),
  };
}

/**
 * Translates an error from the SDK or the x402 client. Anything else is a bug, not a policy
 * outcome, and is rethrown so the harness shows it instead of the model guessing.
 */
export function fromError(error: unknown): ToolError {
  if (error instanceof PaymentDeniedError) {
    return toolError(denialInfo(error.reason).toolCode, {
      recorded: error.recorded,
      strikes: error.strikes,
      frozen: error.frozen,
    });
  }
  if (error instanceof ApprovalNotPossibleError) {
    return toolError(error.why === "notNeeded" ? "APPROVAL_NOT_NEEDED" : "TOO_MANY_OPEN_REQUESTS");
  }
  if (error instanceof NotPairedError) return toolError("NOT_PAIRED");
  if (error instanceof UnsupportedPaymentError) return toolError("UNSUPPORTED_PAYMENT");
  if (error instanceof MerchantRejectedError) return toolError("MERCHANT_REJECTED");
  if (error instanceof LeashNetworkError) return toolError("NETWORK_ERROR");
  throw error;
}
