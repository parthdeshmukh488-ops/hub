import { buildPairingUrl, type Cluster, type PresetId } from "@leash/contracts";
import { NotPairedError } from "@leash/sdk";

export type PairingOptions = {
  /** `LeashAgent`: `status()` throws `NotPairedError` until the Agent PDA exists. */
  agent: { readonly address: string; status(): Promise<unknown> };
  /** Base URL of the web app that opens pairing links. */
  webUrl: string;
  /** The name the owner sees (at most 32 bytes). */
  label: string;
  preset?: PresetId;
  cluster: Cluster;
  /** Called once, with the pairing link, when the agent turns out not to be paired. */
  onUnpaired(link: string): void;
  /** Called when pairing completes after `onUnpaired`. */
  onPaired?(): void;
  /** Anything but "not paired", e.g. an unreachable RPC. Polling continues. */
  onError?(error: unknown): void;
  /** Default 5 000. */
  intervalMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** Waits `ms`, or less if `signal` aborts first. */
function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Pairing (02-contracts §11): if the Agent PDA does not exist yet, hands out the pairing link once,
 * then polls until the owner has paired the agent. Resolves true once paired (at once if it already
 * is), false if `signal` aborts first.
 */
export async function waitForPairing(options: PairingOptions): Promise<boolean> {
  const sleep = options.sleep ?? sleepUnlessAborted;
  let announced = false;
  while (!options.signal?.aborted) {
    try {
      await options.agent.status();
      if (announced) options.onPaired?.();
      return true;
    } catch (error) {
      if (!(error instanceof NotPairedError)) options.onError?.(error);
      else if (!announced) {
        announced = true;
        options.onUnpaired(
          buildPairingUrl(options.webUrl, {
            agentKey: options.agent.address,
            label: options.label,
            preset: options.preset ?? "custom",
            cluster: options.cluster,
          }),
        );
      }
    }
    await sleep(options.intervalMs ?? 5_000, options.signal);
  }
  return false;
}
