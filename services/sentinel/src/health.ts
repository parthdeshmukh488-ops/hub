import { createServer, type Server } from "node:http";
import type { SentinelStatus } from "./sentinel.ts";

// `GET /health` on port 4400 (02-contracts §2.4): 200 while connected to the indexer with the
// owners loaded, 503 otherwise. Sentinel serves nothing else.

export function createHealthServer(status: () => SentinelStatus): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://sentinel").pathname;
    if (request.method !== "GET" || path !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Try GET /health" } }));
      return;
    }
    const body = status();
    response.writeHead(body.ok ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
}
