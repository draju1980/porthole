import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { RequestLog } from "./types.js";

interface ProxyOptions {
  appPort: number;
  proxyPort: number;
  requests: RequestLog[];
  onRequest: (req: RequestLog) => void;
  maxRequests?: number;
}

export interface ServerHandle {
  port: number;
  shutdown(): Promise<void>;
}

export function createProxy(opts: ProxyOptions): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      const id = crypto.randomUUID().slice(0, 8);
      const start = performance.now();
      const urlPath = incoming.url ?? "/";

      const requestHeaders: Record<string, string> = {};
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        requestHeaders[incoming.rawHeaders[i].toLowerCase()] = incoming.rawHeaders[i + 1];
      }

      let requestBody: string | null = null;
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        try {
          requestBody = await readBody(incoming);
        } catch {
          requestBody = null;
        }
      }

      const entry: RequestLog = {
        id,
        timestamp: Date.now(),
        method: incoming.method ?? "GET",
        url: urlPath,
        requestHeaders,
        requestBody,
        status: null,
        responseHeaders: null,
        responseBody: null,
        duration: null,
      };

      try {
        const targetUrl = `http://localhost:${opts.appPort}${urlPath}`;

        const fetchInit: RequestInit = {
          method: incoming.method,
          headers: requestHeaders,
        };
        if (requestBody !== null) {
          fetchInit.body = requestBody;
        }

        const res = await fetch(targetUrl, fetchInit);

        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => { responseHeaders[k] = v; });

        const responseBody = await res.text();
        const duration = performance.now() - start;

        entry.status = res.status;
        entry.responseHeaders = responseHeaders;
        entry.responseBody = responseBody;
        entry.duration = Math.round(duration * 100) / 100;

        pushRequest(opts, entry);

        outgoing.writeHead(res.status, responseHeaders);
        outgoing.end(responseBody);
      } catch (err) {
        const duration = performance.now() - start;
        entry.status = 502;
        entry.responseBody = `Proxy error: ${err instanceof Error ? err.message : String(err)}`;
        entry.duration = Math.round(duration * 100) / 100;

        pushRequest(opts, entry);

        outgoing.writeHead(502);
        outgoing.end(entry.responseBody);
      }
    });

    server.listen(opts.proxyPort, () => {
      resolve({
        port: opts.proxyPort,
        shutdown() {
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });

    server.on("error", reject);
  });
}

function pushRequest(opts: ProxyOptions, entry: RequestLog) {
  opts.requests.push(entry);
  const max = opts.maxRequests ?? 5_000;
  if (opts.requests.length > max) {
    opts.requests.splice(0, opts.requests.length - max);
  }
  opts.onRequest(entry);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
