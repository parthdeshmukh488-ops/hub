import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import {
  type AgentDetailResponse,
  AgentDetailResponseSchema,
  type AgentView,
  type LeashEvent,
  type StreamClientMessage,
  StreamClientMessageSchema,
  type StreamServerMessage,
} from "@leash/contracts";
import { type WebSocket, WebSocketServer } from "ws";
import { key, ownerOverview, storyline } from "./helpers.ts";

// A stand-in for the indexer, built only from the contract (02 §7) and its fixtures, until
// `@leash/indexer/testing` reaches main. It serves the routes Sentinel uses and the stream.

const require = createRequire(import.meta.url);
const researchDetail: AgentDetailResponse = AgentDetailResponseSchema.parse(
  JSON.parse(readFileSync(require.resolve("@leash/contracts/fixtures/agent-detail.json"), "utf8")),
);

const OWNER = key("owner");
const GUARDIAN = key("guardian");

export class FakeIndexer {
  /** The history the REST routes serve, oldest first. */
  history: LeashEvent[] = [];
  guardianOwners: string[] = [OWNER];
  /** Every message clients sent, in order. */
  readonly received: StreamClientMessage[] = [];
  connections = 0;
  /** Send `hello` on connect (off to test a server that goes quiet). */
  greet = true;
  private readonly sockets = new Map<WebSocket, Set<string>>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly server: Server;
  url = "";

  constructor() {
    this.server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://fake");
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      const notFound = (message: string) => reply(404, { error: { code: "NOT_FOUND", message } });
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[1] === "guardians" && parts[2] === GUARDIAN && parts[3] === "owners") {
        return reply(200, { owners: this.guardianOwners });
      }
      if (parts[1] === "owners" && parts[2] === OWNER && parts.length === 3) {
        return reply(200, ownerOverview);
      }
      if (parts[1] === "agents" && parts.length === 3) {
        const agent = ownerOverview.agents.find((a) => a.address === parts[2]);
        if (!agent) return notFound("No agent at this address");
        const payees = researchDetail.payees.map((p) => ({ ...p, agent: agent.address }));
        return reply(200, { agent, payees, requests: [] });
      }
      if (parts[1] === "owners" && parts[2] === OWNER && parts[3] === "events") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const after = url.searchParams.get("after");
        if (after) {
          const index = this.history.findIndex((e) => e.id === after);
          if (index < 0) return notFound("Unknown event id in before/after: reload the history");
          return reply(200, {
            items: this.history.slice(index + 1, index + 1 + limit),
            nextBefore: null,
          });
        }
        return reply(200, { items: [...this.history].reverse().slice(0, limit), nextBefore: null });
      }
      return notFound("No such route");
    });
    this.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => this.connect(ws));
    });
  }

  async start(port = 0): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async close(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Appends to the history and pushes to subscribed clients, like a new transaction. */
  publish(event: LeashEvent, { push = true }: { push?: boolean } = {}): void {
    this.history.push(event);
    if (push) this.pushEvent(event);
  }

  /** Pushes on the stream only (a duplicate delivery, for example). */
  pushEvent(event: LeashEvent): void {
    this.broadcast({ type: "event", event });
  }

  pushAgent(agent: AgentView): void {
    this.broadcast({ type: "agent", agent });
  }

  ping(): void {
    for (const socket of this.sockets.keys()) socket.send(JSON.stringify({ type: "ping" }));
  }

  /** Kills every connection, as a restart or a network cut would. */
  dropConnections(): void {
    for (const socket of this.sockets.keys()) socket.terminate();
    this.sockets.clear();
  }

  subscribers(): number {
    return [...this.sockets.values()].filter((owners) => owners.has(OWNER)).length;
  }

  private broadcast(message: StreamServerMessage): void {
    for (const [socket, owners] of this.sockets) {
      if (owners.has(OWNER)) socket.send(JSON.stringify(message));
    }
  }

  private connect(socket: WebSocket): void {
    this.connections++;
    const owners = new Set<string>();
    this.sockets.set(socket, owners);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("message", (data) => {
      const message = StreamClientMessageSchema.parse(JSON.parse(data.toString()));
      this.received.push(message);
      if (message.type === "subscribe") for (const owner of message.owners) owners.add(owner);
      if (message.type === "unsubscribe") for (const owner of message.owners) owners.delete(owner);
    });
    if (this.greet) {
      socket.send(JSON.stringify({ type: "hello", cluster: storyline.cluster, serverTime: 0 }));
    }
  }
}
