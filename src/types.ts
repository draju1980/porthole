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

export interface LogEntry {
  timestamp: number;
  source: "stdout" | "stderr" | "proxy" | "system";
  message: string;
}

export interface ProcessStats {
  pid: number | null;
  uptime: number;
  requestCount: number;
  appPort: number;
  proxyPort: number;
  inspectorPort: number | null;
}
