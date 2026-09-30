// A per-client fixed-window rate limit for /verify and /settle (03-security T8): failing
// transactions would otherwise let anyone make the fee payer simulate, or pay fees, for free.

export type RateLimiter = {
  /** True if `client` may make another request now. */
  allow(client: string, nowMs?: number): boolean;
};

export function createRateLimiter(options: { limit: number; windowMs: number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(client, nowMs = Date.now()) {
      const window = windows.get(client);
      if (window === undefined || nowMs - window.start >= options.windowMs) {
        // Forget stale clients now and then, so the map stays small.
        if (windows.size > 10_000) {
          for (const [key, value] of windows) {
            if (nowMs - value.start >= options.windowMs) windows.delete(key);
          }
        }
        windows.set(client, { start: nowMs, count: 1 });
        return true;
      }
      window.count += 1;
      return window.count <= options.limit;
    },
  };
}
