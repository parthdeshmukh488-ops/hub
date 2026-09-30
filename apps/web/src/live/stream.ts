import { type StreamServerMessage, StreamServerMessageSchema } from "@leash/contracts";
import type { LeashDataSource } from "../data/source.ts";

// The browser side of `GET /v1/stream` (02-contracts §7.2): subscribe, answer pings, reconnect
// with backoff, and backfill the gap with `?after=` so no event is missed.

export type LiveStatus = "connecting" | "live" | "reconnecting";

/** The part of the browser WebSocket this client uses (a fake in tests). */
export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

export type LiveStreamOptions = {
  url: string;
  owner: string;
  source: Pick<LeashDataSource, "eventsAfter">;
  onMessage(message: StreamServerMessage): void;
  /** Connected again after a drop: views may be stale. */
  onResync(): void;
  /** The server no longer knows our last event: the history was reset. */
  onReset(): void;
  onStatus(status: LiveStatus): void;
  createSocket?: (url: string) => SocketLike;
  /** Delay before reconnect attempt `n` (from 0). */
  backoffMs?: (attempt: number) => number;
};

const defaultBackoff = (attempt: number) => Math.min(15_000, 1000 * 2 ** attempt);

export class LiveStream {
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private lastSeenId: string | null = null;
  private connectedBefore = false;
  private stopped = false;

  constructor(private readonly options: LiveStreamOptions) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private connect(): void {
    const { options } = this;
    options.onStatus(this.connectedBefore ? "reconnecting" : "connecting");
    const create =
      options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = create(options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      socket.send(JSON.stringify({ type: "subscribe", owners: [options.owner] }));
      options.onStatus("live");
      if (this.connectedBefore) {
        options.onResync();
        void this.backfill();
      }
      this.connectedBefore = true;
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => {
      // A close event follows; reconnecting happens there.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.stopped) this.reconnectLater();
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = StreamServerMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "ping") {
      this.socket?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (message.type === "event") this.lastSeenId = message.event.id;
    this.options.onMessage(message);
  }

  private async backfill(): Promise<void> {
    const from = this.lastSeenId;
    if (from === null) return;
    let missed: Awaited<ReturnType<LeashDataSource["eventsAfter"]>>;
    try {
      missed = await this.options.source.eventsAfter(this.options.owner, from);
    } catch {
      return; // The REST API is down too; the next reconnect tries again.
    }
    if (missed === null) {
      this.options.onReset();
      return;
    }
    for (const event of missed) {
      this.lastSeenId = event.id;
      this.options.onMessage({ type: "event", event });
    }
  }

  private reconnectLater(): void {
    this.options.onStatus("reconnecting");
    const delay = (this.options.backoffMs ?? defaultBackoff)(this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
