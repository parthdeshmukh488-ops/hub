// The x402 middleware reads the facilitator's payment kinds once, when it is created. If the
// facilitator is not up yet, that read fails and the first paid request answers 500. So the
// merchant waits for the facilitator before it builds its app.

export type WaitOptions = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry, with the number of failed attempts so far. */
  onWaiting?: (attempts: number) => void;
  intervalMs?: number;
};

/** Resolves once `GET <url>/supported` answers 200. Retries forever: the operator sees why. */
export async function waitForFacilitator(url: string, options: WaitOptions = {}): Promise<void> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const supported = `${url.replace(/\/+$/, "")}/supported`;
  for (let attempts = 1; ; attempts += 1) {
    const up = await fetchFn(supported).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    options.onWaiting?.(attempts);
    await sleep(options.intervalMs ?? 1_000);
  }
}
