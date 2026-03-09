/** Options for creating a sandbox instance. */
export interface SandboxOptions {
  /** Path to the script to run */
  entry: string;
  /** Command to run the entry script (default: "node") */
  command?: string;
  /** Arguments to pass before the entry path (default: []) */
  commandArgs?: string[];
  /** Port for the proxy server (default: 9090) */
  port?: number;
  /** Port for the inspector dashboard (default: 9099) */
  inspectorPort?: number;
  /** Environment variables to pass to the subprocess */
  env?: Record<string, string>;
  /** Arguments to pass to the subprocess after the entry path */
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

/** Options for deploying to Cloudflare Workers. */
export interface DeployOptions {
  /** Cloudflare account ID */
  accountId: string;
  /** Cloudflare API token with Workers write permissions */
  apiToken: string;
  /** Worker name (default: derived from entry filename) */
  name?: string;
}
