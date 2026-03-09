import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import { Readable } from "node:stream";
import type { SandboxOptions, RequestLog, LogEntry, ProcessStats } from "./types.js";
import { createProxy, type ServerHandle as ProxyHandle } from "./proxy.js";
import { createInspector, type ServerHandle as InspectorHandle } from "./inspector.js";
import { openTunnel, ensureCloudflared, type TunnelHandle } from "./tunnel.js";
import { deployToWorkers, type DeployOptions } from "./deploy.js";
import { WebSocket } from "ws";

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to get free port")));
      }
    });
    server.on("error", reject);
  });
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

interface ResolvedOptions {
  entry: string;
  command: string;
  commandArgs: string[];
  port: number;
  inspectorPort: number;
  env: Record<string, string>;
  args: string[];
  inspector: boolean;
  expose: boolean;
}

/**
 * A sandboxed subprocess with a reverse proxy, inspector dashboard,
 * and optional Cloudflare tunnel exposure.
 *
 * @example
 * ```ts
 * import { Sandbox } from "porthole-sandbox";
 *
 * const sandbox = await Sandbox.create({ entry: "./app.js" });
 * console.log(sandbox.url);
 * ```
 */
export class Sandbox {
  #process: ChildProcess | null = null;
  #processExit: Promise<number | null> | null = null;
  #proxyServer: ProxyHandle | null = null;
  #inspectorServer: InspectorHandle | null = null;
  #logs: LogEntry[] = [];
  #requests: RequestLog[] = [];
  #inspectorSockets: Set<WebSocket> = new Set();
  #appPort: number;
  #proxyPort: number;
  #inspectorPort: number | null;
  #startTime: number;
  #options: ResolvedOptions;
  #tunnel: TunnelHandle | null = null;

  private constructor(options: ResolvedOptions, appPort: number) {
    this.#options = options;
    this.#appPort = appPort;
    this.#proxyPort = options.port;
    this.#inspectorPort = options.inspector ? options.inspectorPort : null;
    this.#startTime = Date.now();
  }

  /** Create a new sandbox, spawning the app and starting the proxy/inspector. */
  static async create(options: SandboxOptions): Promise<Sandbox> {
    const resolved: ResolvedOptions = {
      entry: options.entry,
      command: options.command ?? "node",
      commandArgs: options.commandArgs ?? [],
      port: options.port ?? 9090,
      inspectorPort: options.inspectorPort ?? 9099,
      env: options.env ?? {},
      args: options.args ?? [],
      inspector: options.inspector ?? true,
      expose: options.expose ?? true,
    };

    // Check for cloudflared early so users get a clear error before anything starts
    if (resolved.expose) {
      await ensureCloudflared();
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
    const args = [...opts.commandArgs, opts.entry, ...opts.args];
    this.#process = spawn(opts.command, args, {
      env: {
        ...process.env,
        ...opts.env,
        PORT: String(this.#appPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.#addLog("system", `Spawned app (PID ${this.#process.pid}) on port ${this.#appPort}`);

    // Stream stdout/stderr
    if (this.#process.stdout) {
      const stdoutWeb = Readable.toWeb(this.#process.stdout) as ReadableStream<Uint8Array>;
      readStream(stdoutWeb, "stdout", this.#logs, (e) => this.#broadcast(e));
    }
    if (this.#process.stderr) {
      const stderrWeb = Readable.toWeb(this.#process.stderr) as ReadableStream<Uint8Array>;
      readStream(stderrWeb, "stderr", this.#logs, (e) => this.#broadcast(e));
    }

    // Track process exit
    this.#processExit = new Promise<number | null>((resolve) => {
      this.#process!.on("exit", (code) => resolve(code));
    });

    // Wait for the app to be ready
    await this.#waitForApp();

    // Start the reverse proxy
    this.#proxyServer = await createProxy({
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
      this.#inspectorServer = await createInspector({
        port: opts.inspectorPort,
        sockets: this.#inspectorSockets,
        getLogs: () => this.#logs,
        getRequests: () => this.#requests,
        getStats: () => this.stats,
      });
      this.#addLog("system", `Inspector at http://localhost:${opts.inspectorPort}`);
    }

    // Handle process exit
    this.#processExit.then((code) => {
      this.#addLog("system", `App exited with code ${code}`);
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
      await this.#processExit;
      this.#process = null;
    }

    this.#addLog("system", "Sandbox closed");
  }
}
