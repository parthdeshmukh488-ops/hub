import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type StreamServerMessage, StreamServerMessageSchema } from "@leash/contracts";
import { afterEach, describe, expect, it } from "vitest";
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
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 200 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(predicate()).toBe(true);
  };
  return {
    socket,
    messages,
    closed,
    until,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
  };
}

describe("/v1/stream (02-contracts §7.2)", () => {
  it("says hello, then streams events and agent updates for subscribed owners only", async () => {
    const { url, sink } = await start();
    const subscriber = await connect(url);
    const bystander = await connect(url);
    await subscriber.until(() => subscriber.messages.length === 1);
    expect(subscriber.messages[0]).toEqual({ type: "hello", cluster: "devnet", serverTime: AS_OF });

    subscriber.send({ type: "subscribe", owners: [key("owner")] });
    bystander.send({ type: "subscribe", owners: [key("attacker")] });
    await new Promise((r) => setTimeout(r, 50));
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
    expect(bystander.messages.map((m) => m.type)).toEqual(["hello"]);
  });

  it("stops streaming after unsubscribe", async () => {
    const { url, sink } = await start();
    const client = await connect(url);
    client.send({ type: "subscribe", owners: [key("owner")] });
    client.send({ type: "unsubscribe", owners: [key("owner")] });
    await new Promise((r) => setTimeout(r, 50));
    await sink.events(storyline.events.slice(0, 3));
    await new Promise((r) => setTimeout(r, 50));
    expect(client.messages.map((m) => m.type)).toEqual(["hello"]);
  });

  it("answers malformed messages with an error", async () => {
    const { url } = await start();
    const client = await connect(url);
    client.socket.send("not json");
    client.send({ type: "subscribe", owners: ["not-an-address"] });
    await client.until(() => client.messages.filter((m) => m.type === "error").length === 2);
  });

  it("pings, and drops a client that never answers", async () => {
    const { url } = await start({ pingIntervalMs: 40 });
    const silent = await connect(url);
    const polite = await connect(url);
    polite.socket.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "ping") polite.send({ type: "pong" });
    });
    expect(await silent.closed).toBe(1006);
    expect(polite.messages.some((m) => m.type === "ping")).toBe(true);
    expect(polite.socket.readyState).toBe(WebSocket.OPEN);
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
