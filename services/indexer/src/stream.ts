import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  API_ROUTES,
  type Cluster,
  STREAM_PING_INTERVAL_MS,
  StreamClientMessageSchema,
  type StreamServerMessage,
} from "@leash/contracts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Logger } from "./logger.ts";

// `GET /v1/stream` (02-contracts §7.2): per-owner subscriptions, an application-level heartbeat,
// and backpressure. Delivery is at-least-once; clients dedupe by event id.

export type StreamHubOptions = {
  cluster: Cluster;
  now: () => number;
  log: Logger;
  /** Browser origin allowed to connect. Clients without an Origin header (services) are allowed. */
  webOrigin: string;
  pingIntervalMs?: number;
  /** A client with more unsent bytes than this is too slow and is dropped. */
  maxBufferedBytes?: number;
};

type Client = { socket: WebSocket; owners: Set<string>; alive: boolean };

export class StreamHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private readonly clients = new Set<Client>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly options: StreamHubOptions) {
    this.heartbeat = setInterval(
      () => this.beat(),
      options.pingIntervalMs ?? STREAM_PING_INTERVAL_MS,
    );
    this.heartbeat.unref();
  }

  /** Handles WebSocket upgrades on `server` for the stream path. */
  attach(server: Server): void {
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? "/", "http://indexer").pathname;
      const origin = request.headers.origin;
      if (
        path !== API_ROUTES.stream ||
        (origin !== undefined && origin !== this.options.webOrigin)
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.connect(ws));
    });
  }

  /** Sends `message` to every client subscribed to `owner`. */
  publish(owner: string, message: StreamServerMessage): void {
    for (const client of this.clients) {
      if (client.owners.has(owner)) this.send(client, message);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.socket.close(1001, "indexer shutting down");
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private connect(socket: WebSocket): void {
    const client: Client = { socket, owners: new Set(), alive: true };
    this.clients.add(client);
    socket.on("message", (data, isBinary) => this.receive(client, data, isBinary));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", (err) => this.options.log.warn({ err }, "stream client error"));
    this.send(client, {
      type: "hello",
      cluster: this.options.cluster,
      serverTime: this.options.now(),
    });
  }

  private receive(client: Client, data: RawData, isBinary: boolean): void {
    let json: unknown;
    try {
      json = isBinary ? undefined : JSON.parse(data.toString());
    } catch {
      json = undefined;
    }
    const parsed = StreamClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.send(client, {
        type: "error",
        error: { code: "BAD_REQUEST", message: "Expected subscribe, unsubscribe or pong as JSON" },
      });
      return;
    }
    const message = parsed.data;
    if (message.type === "pong") client.alive = true;
    else if (message.type === "subscribe")
      for (const owner of message.owners) client.owners.add(owner);
    else for (const owner of message.owners) client.owners.delete(owner);
  }

  private send(client: Client, message: StreamServerMessage): void {
    const { socket } = client;
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > (this.options.maxBufferedBytes ?? 1_000_000)) {
      this.options.log.warn({ owners: [...client.owners] }, "dropping a slow stream client");
      socket.close(1013, "too slow: reconnect and backfill with ?after=");
      this.clients.delete(client);
      return;
    }
    socket.send(JSON.stringify(message));
  }

  /** Pings every client; drops those that did not answer the previous ping. */
  private beat(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket.terminate();
        this.clients.delete(client);
        continue;
      }
      client.alive = false;
      this.send(client, { type: "ping" });
    }
  }
}
