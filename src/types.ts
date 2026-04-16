/** Options for creating a sandbox instance. */
export interface SandboxOptions {
  /** Path to the Deno script to run */
  entry: string;
  /** Port for the proxy server (default: 8080) */
  port?: number;
  /** Port for the inspector dashboard (default: 9090) */
  inspectorPort?: number;
  /** Deno permissions to grant to the subprocess (default: ["--allow-net"]) */
  permissions?: string[];
  /** Environment variables to pass to the subprocess */
  env?: Record<string, string>;
  /** Arguments to pass to the subprocess */
  args?: string[];
  /** Enable inspector dashboard (default: true) */
  inspector?: boolean;
  /** Expose app via Cloudflare Quick Tunnel on create (default: true) */
  expose?: boolean;
}

/** A captured HTTP request/response pair from the reverse proxy. */
export interface RequestLog {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  duration: number | null;
}

/** A log entry from the sandbox subprocess or system. */
export interface LogEntry {
  timestamp: number;
  source: "stdout" | "stderr" | "proxy" | "system";
  message: string;
}

/** Runtime statistics for the sandbox process. */
export interface ProcessStats {
  pid: number | null;
  uptime: number;
  requestCount: number;
  appPort: number;
  proxyPort: number;
  inspectorPort: number | null;
}
