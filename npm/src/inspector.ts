import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { LogEntry, RequestLog, ProcessStats } from "./types.js";
import { dashboardHtml } from "./dashboard.js";

interface InspectorOptions {
  port: number;
  sockets: Set<WebSocket>;
  getLogs: () => LogEntry[];
  getRequests: () => RequestLog[];
  getStats: () => ProcessStats;
}

export interface ServerHandle {
  port: number;
  shutdown(): Promise<void>;
}

export function createInspector(opts: InspectorOptions): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);

      if (url.pathname === "/api/logs") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(opts.getLogs()));
        return;
      }
      if (url.pathname === "/api/requests") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(opts.getRequests()));
        return;
      }
      if (url.pathname === "/api/stats") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(opts.getStats()));
        return;
      }

      // Serve dashboard
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(dashboardHtml());
    });

    const wss = new WebSocketServer({ server });

    wss.on("connection", (socket: WebSocket) => {
      opts.sockets.add(socket);

      // Send current state
      socket.send(JSON.stringify({
        type: "init",
        data: {
          logs: opts.getLogs(),
          requests: opts.getRequests(),
          stats: opts.getStats(),
        },
      }));

      socket.on("close", () => {
        opts.sockets.delete(socket);
      });

      socket.on("message", (data: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
          if (msg.type === "ping") {
            socket.send(JSON.stringify({
              type: "pong",
              data: { stats: opts.getStats() },
            }));
          }
        } catch {
          // ignore bad messages
        }
      });
    });

    server.listen(opts.port, () => {
      resolve({
        port: opts.port,
        shutdown() {
          return new Promise<void>((res, rej) => {
            wss.close();
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });

    server.on("error", reject);
  });
}
