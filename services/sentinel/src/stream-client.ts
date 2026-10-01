import {
  STREAM_PING_INTERVAL_MS,
  type StreamClientMessage,
  type StreamServerMessage,
  StreamServerMessageSchema,
} from "@leash/contracts";
import WebSocket from "ws";
import type { Logger } from "./logger.ts";

// The indexer's `/v1/stream` (02-contracts §7.2), kept connected: it answers pings, reconnects
// with exponential backoff, and drops a connection that went silent. Gaps are the caller's to
// fill: `onOpen` runs before the subscription is sent, so the caller can queue a backfill ahead
// of the live messages.

export type StreamData = Extract<StreamServerMessage, { type: "event" | "agent" }>;

export interface StreamHandlers {
  /** A connection opened (the first or a reconnect). Runs before `subscribe` is sent. */
  onOpen(): void;
  onData(message: StreamData): void;
  /** The connection closed; a reconnect is scheduled unless the client was stopped. */
  onClose?(): void;
}

export interface StreamClientOptions {
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** No message (the server pings every 20 s) for this long means the connection is dead. */
  idleTimeoutMs?: number;
}

export class StreamClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly url: string,
    /** The owners to subscribe to on every (re)connect. */
    private readonly owners: () => string[],
    private readonly handlers: StreamHandlers,
    private readonly log: Logger,
    options: StreamClientOptions = {},
  ) {
    this.minBackoffMs = options.minBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? Math.round(STREAM_PING_INTERVAL_MS * 2.5);
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.socket?.close(1000, "sentinel stopping");
    this.socket = null;
  }

  /** Subscribes to more owners on the open connection (later connections include them anyway). */
  subscribe(owners: string[]): void {
    if (owners.length > 0) this.send({ type: "subscribe", owners });
  }

  private send(message: StreamClientMessage): void {
    if (this.connected) this.socket?.send(JSON.stringify(message));
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on("open", () => {
      this.log.info({ url: this.url }, "stream connected");
      this.touch();
      this.handlers.onOpen();
      const owners = this.owners();
      if (owners.length > 0) this.send({ type: "subscribe", owners });
    });
    socket.on("message", (data) => {
      this.touch();
      this.receive(data.toString());
    });
    socket.on("error", (error) => this.log.warn({ err: error.message }, "stream error"));
    socket.on("close", (code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.handlers.onClose?.();
      if (this.stopped) return;
      const delay = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** this.attempt);
      this.attempt++;
      this.log.warn({ code, delayMs: delay }, "stream closed, reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  private receive(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.log.warn("stream sent something that is not JSON");
      return;
    }
    const parsed = StreamServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.log.warn("stream sent an unexpected message");
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "hello":
        this.attempt = 0;
        break;
      case "ping":
        this.send({ type: "pong" });
        break;
      case "error":
        this.log.warn({ code: message.error.code }, message.error.message);
        break;
      default:
        this.handlers.onData(message);
    }
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.log.warn({ idleMs: this.idleTimeoutMs }, "stream silent, reconnecting");
      this.socket?.terminate();
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }
}
