import type { RequestLog } from "./types.ts";

interface ProxyOptions {
  appPort: number;
  proxyPort: number;
  requests: RequestLog[];
  onRequest: (req: RequestLog) => void;
}

export function createProxy(opts: ProxyOptions): Deno.HttpServer {
  return Deno.serve({ port: opts.proxyPort, onListen() {} }, async (req) => {
    const id = crypto.randomUUID().slice(0, 8);
    const start = performance.now();
    const url = new URL(req.url);

    const requestHeaders: Record<string, string> = {};
    req.headers.forEach((v, k) => { requestHeaders[k] = v; });

    let requestBody: string | null = null;
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      try {
        requestBody = await req.text();
      } catch {
        requestBody = null;
      }
    }

    const entry: RequestLog = {
      id,
      timestamp: Date.now(),
      method: req.method,
      url: url.pathname + url.search,
      requestHeaders,
      requestBody,
      status: null,
      responseHeaders: null,
      responseBody: null,
      duration: null,
    };

    try {
      const targetUrl = `http://localhost:${opts.appPort}${url.pathname}${url.search}`;

      const proxyReq: RequestInit = {
        method: req.method,
        headers: req.headers,
      };
      if (requestBody !== null) {
        proxyReq.body = requestBody;
      }

      const res = await fetch(targetUrl, proxyReq);

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { responseHeaders[k] = v; });

      const responseBody = await res.text();
      const duration = performance.now() - start;

      entry.status = res.status;
      entry.responseHeaders = responseHeaders;
      entry.responseBody = responseBody;
      entry.duration = Math.round(duration * 100) / 100;

      opts.requests.push(entry);
      opts.onRequest(entry);

      return new Response(responseBody, {
        status: res.status,
        headers: res.headers,
      });
    } catch (err) {
      const duration = performance.now() - start;
      entry.status = 502;
      entry.responseBody = `Proxy error: ${err instanceof Error ? err.message : String(err)}`;
      entry.duration = Math.round(duration * 100) / 100;

      opts.requests.push(entry);
      opts.onRequest(entry);

      return new Response(entry.responseBody, { status: 502 });
    }
  });
}
