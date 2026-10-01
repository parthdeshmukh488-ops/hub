import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type StreamServerMessage, StreamServerMessageSchema } from "@leash/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createPipeline } from "../src/pipeline.ts";
import { StreamHub, type StreamHubOptions } from "../src/stream.ts";
import { AS_OF, key, log, storyline, testStore } from "./helpers.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(options: Partial<StreamHubOptions> = {}) {
  const hub = new StreamHub({
    cluster: "devnet",
    now: () => AS_OF,
    log,
    webOrigin: "http://localhost:3000",
    ...options,
  });
  const server: Server = createServer((_req, res) => res.end());
  hub.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const { store, close } = await testStore();
  await store.claim("fixtures");
  cleanups.push(
    close,
    () => new Promise<void>((resolve) => server.close(() => resolve())),
    () => hub.close(),
  );
  return {
    hub,
    store,
    url: `ws://127.0.0.1:${port}/v1/stream`,
    sink: createPipeline(store, hub, () => AS_OF, log),
  };
}

/** A client that collects the (schema-checked) messages it receives. */
async function connect(url: string, headers: Record<string, string> = {}) {
  const socket = new WebSocket(url, { headers });
  const messages: StreamServerMessage[] = [];
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  socket.on("message", (data) =>
    messages.push(StreamServerMessageSchema.parse(JSON.parse(data.toString()))),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  cleanups.push(() => socket.close());
  // Up to 10 s: it returns as soon as the predicate holds, and a loaded CI runner can be slow.
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 1_000 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(predicate()).toBe(true);
  };
  const errors = () => messages.filter((m) => m.type === "error").length;
  /**
   * Resolves once the server has handled everything this client sent so far, and this client
   * has received everything the server sent before that. The server handles one socket's
   * messages in order and answers an unparseable one with an error, so that error is a
   * barrier. No test has to guess how long a message takes.
   */
  const sync = async () => {
    const before = errors();
    socket.send("sync");
    await until(() => errors() > before);
  };
  return {
    socket,
    messages,
    closed,
    until,
    sync,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
  };
}

/** Message types a client received, without the replies to `sync()`. */
const typesOf = (messages: StreamServerMessage[]) =>
  messages.filter((m) => m.type !== "error").map((m) => m.type);

describe("/v1/stream (02-contracts §7.2)", () => {
  it("says hello, then streams events and agent updates for subscribed owners only", async () => {
    const { url, sink } = await start();
    const subscriber = await connect(url);
    const bystander = await connect(url);
    await subscriber.until(() => subscriber.messages.length === 1);
    expect(subscriber.messages[0]).toEqual({ type: "hello", cluster: "devnet", serverTime: AS_OF });

    subscriber.send({ type: "subscribe", owners: [key("owner")] });
    bystander.send({ type: "subscribe", owners: [key("attacker")] });
    await subscriber.sync();
    await bystander.sync();
    await sink.events(storyline.events);

    const events = () => subscriber.messages.filter((m) => m.type === "event");
    await subscriber.until(() => events().length === storyline.events.length);
    expect(events().map((m) => m.type === "event" && m.event.id)).toEqual(
      storyline.events.map((e) => e.id),
    );
    const frozen = subscriber.messages.find(
      (m) => m.type === "agent" && m.agent.status === "frozen",
    );
    expect(frozen?.type === "agent" && frozen.agent.freezeReason).toBe("tripwire");
    await bystander.sync();
    expect(typesOf(bystander.messages)).toEqual(["hello"]);
  });

  it("stops streaming after unsubscribe", async () => {
    const { url, sink } = await start();
    const client = await connect(url);
    client.send({ type: "subscribe", owners: [key("owner")] });
    client.send({ type: "unsubscribe", owners: [key("owner")] });
    await client.sync();
    await sink.events(storyline.events.slice(0, 3));
    // Anything published for the owner would arrive before the reply to this sync.
    await client.sync();
    expect(typesOf(client.messages)).toEqual(["hello"]);
  });

  it("answers malformed messages with an error", async () => {
    const { url } = await start();
    const client = await connect(url);
    client.socket.send("not json");
    client.send({ type: "subscribe", owners: ["not-an-address"] });
    await client.until(() => client.messages.filter((m) => m.type === "error").length === 2);
  });

  it("pings, and drops a client that never answers", async () => {
    // The heartbeat is driven by hand: with a real short interval, a busy machine could delay
    // the polite client's pong past the next beat and drop it too.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    cleanups.push(() => {
      vi.useRealTimers();
    });
    const interval = 20_000;
    const { url } = await start({ pingIntervalMs: interval });
    const silent = await connect(url);
    const polite = await connect(url);
    polite.socket.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "ping") polite.send({ type: "pong" });
    });

    vi.advanceTimersByTime(interval); // pings both
    await polite.until(() => polite.messages.some((m) => m.type === "ping"));
    await polite.sync(); // the server has seen the pong
    vi.advanceTimersByTime(interval); // drops the one that did not answer

    expect(await silent.closed).toBe(1006);
    expect(polite.socket.readyState).toBe(WebSocket.OPEN);
    expect(silent.messages.some((m) => m.type === "ping")).toBe(true);
  });

  it("drops a client that cannot keep up", async () => {
    const { url } = await start({ maxBufferedBytes: -1 });
    const client = await connect(url);
    expect(await client.closed).toBe(1013);
  });

  it("refuses browsers from other origins", async () => {
    const { url } = await start();
    await expect(connect(url, { Origin: "https://evil.example" })).rejects.toThrow(/403/);
    const allowed = await connect(url, { Origin: "http://localhost:3000" });
    await allowed.until(() => allowed.messages.length === 1);
  });
});
