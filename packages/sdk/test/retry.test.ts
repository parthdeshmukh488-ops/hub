import {
  type RpcTransport,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
} from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetryingSolanaRpc, retryingTransport } from "../src/index.ts";

const httpError = (statusCode: number, retryAfter?: string) =>
  new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}),
    message: `HTTP ${statusCode}`,
    statusCode,
  });

const payload = (method: string) => ({ jsonrpc: "2.0", id: 1, method, params: [] });

/** A transport that fails with `failures` in order, then answers `{ ok: true }`. */
function flaky(failures: unknown[]) {
  const calls: unknown[] = [];
  const transport = (async (config: { payload: unknown }) => {
    calls.push(config.payload);
    const failure = failures[calls.length - 1];
    if (failure !== undefined) throw failure;
    return { jsonrpc: "2.0", id: 1, result: { ok: true } };
  }) as RpcTransport;
  return { transport, calls };
}

function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe("retryingTransport", () => {
  it("retries a read that is throttled, failed on the RPC's side or lost its connection", async () => {
    const { transport, calls } = flaky([
      httpError(429),
      httpError(503),
      new TypeError("fetch failed"),
    ]);
    const { waits, sleep } = recordingSleep();
    const response = await retryingTransport(transport, { sleep })({
      payload: payload("getSignatureStatuses"),
    });
    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([250, 500, 1_000]);
  });

  it("honours Retry-After up to 5 s", async () => {
    const { transport } = flaky([httpError(429, "3"), httpError(429, "60")]);
    const { waits, sleep } = recordingSleep();
    await retryingTransport(transport, { sleep })({ payload: payload("getLatestBlockhash") });
    expect(waits).toEqual([3_000, 5_000]);
  });

  it("does not retry an answer that will not change, and stops after the last retry", async () => {
    const badRequest = flaky([httpError(400)]);
    await expect(
      retryingTransport(badRequest.transport, recordingSleep())({ payload: payload("getSlot") }),
    ).rejects.toMatchObject({ context: { statusCode: 400 } });
    expect(badRequest.calls).toHaveLength(1);

    const down = flaky(Array.from({ length: 10 }, () => httpError(503)));
    const { waits, sleep } = recordingSleep();
    await expect(
      retryingTransport(down.transport, { sleep })({ payload: payload("getSlot") }),
    ).rejects.toMatchObject({ context: { statusCode: 503 } });
    expect(down.calls).toHaveLength(5);
    expect(waits).toEqual([250, 500, 1_000, 2_000]);

    const once = flaky([httpError(429)]);
    await expect(
      retryingTransport(once.transport, { retries: 0, ...recordingSleep() })({
        payload: payload("getSlot"),
      }),
    ).rejects.toMatchObject({ context: { statusCode: 429 } });
    expect(once.calls).toHaveLength(1);
  });

  it("repeats a send only when throttled, since any other failure may have reached the network", async () => {
    const send = { payload: payload("sendTransaction") };
    const throttled = flaky([httpError(429)]);
    await retryingTransport(throttled.transport, recordingSleep())(send);
    expect(throttled.calls).toHaveLength(2);

    for (const failure of [httpError(503), new TypeError("connection reset")]) {
      const failed = flaky([failure]);
      const transport = retryingTransport(failed.transport, recordingSleep());
      await expect(transport(send)).rejects.toBe(failure);
      expect(failed.calls).toHaveLength(1);
    }
  });

  it("treats a payload it cannot read like a send", async () => {
    const batch = flaky([httpError(503)]);
    const transport = retryingTransport(batch.transport, recordingSleep());
    await expect(
      transport({ payload: [payload("getSlot"), payload("sendTransaction")] }),
    ).rejects.toMatchObject({ context: { statusCode: 503 } });
    expect(batch.calls).toHaveLength(1);
  });

  it("never retries an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport, calls } = flaky([httpError(429)]);
    const retrying = retryingTransport(transport, recordingSleep());
    await expect(
      retrying({ payload: payload("getSlot"), signal: controller.signal }),
    ).rejects.toMatchObject({ context: { statusCode: 429 } });
    expect(calls).toHaveLength(1);
  });
});

describe("createRetryingSolanaRpc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets through a throttling RPC with kit's own HTTP transport", async () => {
    const methods: string[] = [];
    let answered = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const request = JSON.parse(init.body) as { id: unknown; method: string };
        methods.push(request.method);
        answered++;
        if (answered === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "retry-after": "1" },
          });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: 4242 }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { waits, sleep } = recordingSleep();
    const rpc = createRetryingSolanaRpc("http://rpc.test", { sleep });
    expect(await rpc.getSlot().send()).toBe(4242n);
    expect(methods).toEqual(["getSlot", "getSlot"]);
    expect(waits).toEqual([1_000]);
  });
});
