import {
  type ClusterUrl,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isJsonRpcPayload,
  isSolanaError,
  type RpcTransport,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";

// Retrying what a throttled or flaky RPC refuses. Public RPCs answer HTTP 429 when a client sends
// too much, and on devnet every service of the demo shares one IP. `rpcChain` retries its own
// calls with these rules; `retryingTransport` applies them to any kit RPC, such as the one the
// official x402 facilitator package sends and confirms settlements through.

/** Waits between attempts after a transient failure: 250 ms, 500 ms, 1 s, then 2 s. */
export const BACKOFF_MS = [250, 500, 1_000, 2_000] as const;

/** The longest `Retry-After` honoured, in milliseconds. */
const MAX_RETRY_AFTER_MS = 5_000;

export type RetryOptions = {
  /** Further attempts after a transient failure (default 4; 0 disables). */
  retries?: number;
  /** Test hook: how to wait between attempts. */
  sleep?: (ms: number) => Promise<void>;
};

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** HTTP 429: the RPC refused the request before processing it, so even a send may be repeated. */
export function isThrottled(error: unknown): boolean {
  return (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    error.context.statusCode === 429
  );
}

/** Worth another try for a read: throttled, a failure on the RPC's side (5xx), or no connection. */
export function isTransient(error: unknown): boolean {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = error.context.statusCode;
    return status === 429 || status >= 500;
  }
  // `fetch` rejects with a TypeError when the connection fails or drops.
  return error instanceof TypeError;
}

/** How long a throttled answer asks us to wait (`Retry-After`, in seconds), if it says. */
function retryAfterMs(error: unknown): number {
  if (!isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) return 0;
  const seconds = Number(error.context.headers?.get?.("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS)
    : 0;
}

/** Runs `call` again after a failure `worthRetry` accepts, up to `retries` times, backing off. */
export async function withRetries<T>(
  call: () => Promise<T>,
  worthRetry: (error: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? BACKOFF_MS.length;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= retries || !worthRetry(error)) throw error;
      const backoff = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 2_000;
      await sleep(Math.max(backoff, retryAfterMs(error)));
    }
  }
}

/**
 * A kit RPC transport that retries what `rpcChain` retries: `sendTransaction` only when throttled
 * (any other failure may have reached the network), every other method also on a 5xx or a dropped
 * connection. An aborted request is never retried. Don't hand an RPC built on it to `rpcChain`,
 * which retries by itself.
 */
export function retryingTransport<TTransport extends RpcTransport>(
  transport: TTransport,
  options: RetryOptions = {},
): TTransport {
  const retrying: RpcTransport = (config) => {
    const { payload, signal } = config;
    const read = isJsonRpcPayload(payload) && payload.method !== "sendTransaction";
    return withRetries(
      () => transport(config),
      (error) => !signal?.aborted && (read ? isTransient(error) : isThrottled(error)),
      options,
    );
  };
  return retrying as TTransport;
}

/**
 * `createSolanaRpc(url)` over `retryingTransport`, for RPCs the SDK doesn't wrap, such as the one
 * handed to the official x402 facilitator package.
 */
export function createRetryingSolanaRpc<TClusterUrl extends ClusterUrl>(
  url: TClusterUrl,
  options: RetryOptions = {},
) {
  return createSolanaRpcFromTransport(
    retryingTransport(createDefaultRpcTransport({ url }), options),
  );
}
