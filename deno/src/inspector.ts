import type { LogEntry, RequestLog, ProcessStats } from "./types.ts";
import { dashboardHtml } from "./dashboard.ts";

interface InspectorOptions {
  port: number;
  sockets: Set<WebSocket>;
  getLogs: () => LogEntry[];
  getRequests: () => RequestLog[];
  getStats: () => ProcessStats;
}

export function createInspector(opts: InspectorOptions): Deno.HttpServer {
  return Deno.serve({ port: opts.port, onListen() {} }, (req) => {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);

      socket.onopen = () => {
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
      };

      socket.onclose = () => {
        opts.sockets.delete(socket);
      };

      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "ping") {
            socket.send(JSON.stringify({
              type: "pong",
              data: { stats: opts.getStats() },
            }));
          }
        } catch {
          // ignore bad messages
        }
      };

      return response;
    }

    // API endpoints
    if (url.pathname === "/api/logs") {
      return Response.json(opts.getLogs());
    }
    if (url.pathname === "/api/requests") {
      return Response.json(opts.getRequests());
    }
    if (url.pathname === "/api/stats") {
      return Response.json(opts.getStats());
    }

    // Serve dashboard
    return new Response(dashboardHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}
