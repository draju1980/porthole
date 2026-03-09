import type { SandboxOptions, RequestLog, LogEntry, ProcessStats } from "./types.ts";
import { createProxy } from "./proxy.ts";
import { createInspector } from "./inspector.ts";
import { openTunnel, ensureCloudflared, type TunnelHandle } from "./tunnel.ts";

import { deployToWorkers, type DeployOptions } from "./deploy.ts";

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function findFreePort(): Promise<number> {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  source: "stdout" | "stderr",
  logs: LogEntry[],
  broadcast: (entry: LogEntry) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n").filter(Boolean)) {
        const entry: LogEntry = {
          timestamp: Date.now(),
          source,
          message: line,
        };
        logs.push(entry);
        broadcast(entry);
      }
    }
  } catch {
    // stream closed
  }
}

/**
 * A sandboxed Deno subprocess with a reverse proxy, inspector dashboard,
 * and optional Cloudflare tunnel exposure.
 *
 * @example
 * ```ts
 * import { Sandbox } from "@porthole/core";
 *
 * const sandbox = await Sandbox.create({ entry: "./app.ts" });
 * console.log(sandbox.url);
 * ```
 */
export class Sandbox {
  #process: Deno.ChildProcess | null = null;
  #proxyServer: Deno.HttpServer | null = null;
  #inspectorServer: Deno.HttpServer | null = null;
  #logs: LogEntry[] = [];
  #requests: RequestLog[] = [];
  #inspectorSockets: Set<WebSocket> = new Set();
  #appPort: number;
  #proxyPort: number;
  #inspectorPort: number | null;
  #startTime: number;
  #options: Required<SandboxOptions>;
  #tunnel: TunnelHandle | null = null;

  private constructor(options: Required<SandboxOptions>, appPort: number) {
    this.#options = options;
    this.#appPort = appPort;
    this.#proxyPort = options.port;
    this.#inspectorPort = options.inspector ? options.inspectorPort : null;
    this.#startTime = Date.now();
  }

  /** Create a new sandbox, spawning the app and starting the proxy/inspector. */
  static async create(options: SandboxOptions): Promise<Sandbox> {
    const resolved: Required<SandboxOptions> = {
      entry: options.entry,
      port: options.port ?? 9090,
      inspectorPort: options.inspectorPort ?? 9099,
      permissions: options.permissions ?? ["--allow-net", "--allow-env"],
      env: options.env ?? {},
      args: options.args ?? [],
      inspector: options.inspector ?? true,
      expose: options.expose ?? true,
    };

    // Check for cloudflared early so users get a clear error before anything starts
    if (resolved.expose) {
      await ensureCloudflared();
    }

    // Validate permissions — only allow specific Deno permission flags
    const VALID_PERMS = new Set([
      "net", "env", "read", "write", "run", "ffi", "sys", "hrtime",
    ]);
    for (const perm of resolved.permissions) {
      const match = perm.match(/^--(allow|deny)-([\w-]+?)(?:=.*)?$/);
      if (!match || !VALID_PERMS.has(match[2])) {
        throw new Error(
          `Invalid permission flag "${perm}": only --allow-*/ --deny-* for ${[...VALID_PERMS].join(", ")} are permitted`,
        );
      }
    }

    const appPort = await findFreePort();
    const sandbox = new Sandbox(resolved, appPort);
    await sandbox.#start();

    if (resolved.expose) {
      await sandbox.expose();
    }

    return sandbox;
  }

  async #start() {
    const opts = this.#options;

    // Spawn the user's app
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        ...opts.permissions,
        opts.entry,
        ...opts.args,
      ],
      env: {
        ...opts.env,
        PORT: String(this.#appPort),
      },
      stdout: "piped",
      stderr: "piped",
    });

    this.#process = cmd.spawn();

    this.#addLog("system", `Spawned app (PID ${this.#process.pid}) on port ${this.#appPort}`);

    // Stream stdout/stderr
    readStream(this.#process.stdout, "stdout", this.#logs, (e) => this.#broadcast(e));
    readStream(this.#process.stderr, "stderr", this.#logs, (e) => this.#broadcast(e));

    // Wait for the app to be ready
    await this.#waitForApp();

    // Start the reverse proxy
    this.#proxyServer = createProxy({
      appPort: this.#appPort,
      proxyPort: this.#proxyPort,
      requests: this.#requests,
      maxRequests: Sandbox.MAX_REQUESTS,
      onRequest: (req) => {
        this.#addLog("proxy", `${req.method} ${req.url} -> ${req.status ?? "pending"}`);
        this.#broadcastRaw({ type: "request", data: req });
      },
    });

    this.#addLog("system", `Proxy listening on http://localhost:${this.#proxyPort}`);

    // Start inspector dashboard
    if (opts.inspector) {
      this.#inspectorServer = createInspector({
        port: opts.inspectorPort,
        sockets: this.#inspectorSockets,
        getLogs: () => this.#logs,
        getRequests: () => this.#requests,
        getStats: () => this.stats,
      });
      this.#addLog("system", `Inspector at http://localhost:${opts.inspectorPort}`);
    }

    // Handle process exit
    this.#process.status.then((status) => {
      this.#addLog("system", `App exited with code ${status.code}`);
    });
  }

  async #waitForApp(maxAttempts = 50, interval = 100) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://localhost:${this.#appPort}/`);
        await res.body?.cancel();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    throw new Error(`App did not start on port ${this.#appPort} within ${maxAttempts * interval}ms`);
  }

  static readonly MAX_LOGS = 10_000;
  static readonly MAX_REQUESTS = 5_000;

  #addLog(source: LogEntry["source"], message: string) {
    const entry: LogEntry = { timestamp: Date.now(), source, message };
    this.#logs.push(entry);
    if (this.#logs.length > Sandbox.MAX_LOGS) {
      this.#logs.splice(0, this.#logs.length - Sandbox.MAX_LOGS);
    }
    this.#broadcast(entry);
  }

  #broadcast(entry: LogEntry) {
    this.#broadcastRaw({ type: "log", data: entry });
  }

  #broadcastRaw(msg: unknown) {
    const json = JSON.stringify(msg);
    for (const ws of this.#inspectorSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }

  /** Current runtime statistics for the sandbox. */
  get stats(): ProcessStats {
    return {
      pid: this.#process?.pid ?? null,
      uptime: Date.now() - this.#startTime,
      requestCount: this.#requests.length,
      appPort: this.#appPort,
      proxyPort: this.#proxyPort,
      inspectorPort: this.#inspectorPort,
    };
  }

  /** All log entries from the subprocess and system. */
  get logs(): readonly LogEntry[] {
    return this.#logs;
  }

  /** All captured HTTP request/response pairs. */
  get requests(): readonly RequestLog[] {
    return this.#requests;
  }

  /** Local proxy URL (e.g. `http://localhost:9090`). */
  get url(): string {
    return `http://localhost:${this.#proxyPort}`;
  }

  /** Local inspector dashboard URL, or `null` if inspector is disabled. */
  get inspectorUrl(): string | null {
    return this.#inspectorPort ? `http://localhost:${this.#inspectorPort}` : null;
  }

  /** Public Cloudflare tunnel URL, or `null` if not exposed. */
  get tunnelUrl(): string | null {
    return this.#tunnel?.url ?? null;
  }

  /** Open a Cloudflare Quick Tunnel to expose the proxy publicly */
  async expose(): Promise<string> {
    if (this.#tunnel) return this.#tunnel.url;
    this.#tunnel = await openTunnel(this.#proxyPort);
    this.#addLog("system", `Tunnel open at ${this.#tunnel.url}`);
    return this.#tunnel.url;
  }

  /** Deploy to Cloudflare Workers */
  async deploy(options: DeployOptions): Promise<string> {
    const workerUrl = await deployToWorkers(this.#options.entry, options);
    this.#addLog("system", `Deployed to ${workerUrl}`);
    return workerUrl;
  }

  /** Shut down everything */
  async close() {
    if (this.#tunnel) {
      this.#tunnel.close();
      this.#tunnel = null;
    }

    for (const ws of this.#inspectorSockets) {
      ws.close();
    }
    this.#inspectorSockets.clear();

    if (this.#inspectorServer) {
      await this.#inspectorServer.shutdown();
      this.#inspectorServer = null;
    }

    if (this.#proxyServer) {
      await this.#proxyServer.shutdown();
      this.#proxyServer = null;
    }

    if (this.#process) {
      try {
        this.#process.kill("SIGTERM");
      } catch {
        // already dead
      }
      await this.#process.status;
      this.#process = null;
    }

    this.#addLog("system", "Sandbox closed");
  }
}
