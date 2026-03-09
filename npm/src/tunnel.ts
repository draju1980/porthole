import { spawn, execFile } from "node:child_process";
import { stat, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const CACHE_DIR = join(homedir(), ".porthole", "bin");

function getDownloadUrl(): { url: string; archive: boolean } {
  const os = platform();
  const cpuArch = arch() === "arm64" ? "arm64" : "amd64";

  if (os === "darwin") {
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${cpuArch}.tgz`,
      archive: true,
    };
  }
  if (os === "linux") {
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cpuArch}`,
      archive: false,
    };
  }
  if (os === "win32") {
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${cpuArch}.exe`,
      archive: false,
    };
  }
  throw new Error(`Unsupported platform: ${os}/${cpuArch}`);
}

function binaryName(): string {
  return platform() === "win32" ? "cloudflared.exe" : "cloudflared";
}

/** Check if cloudflared is available in PATH */
async function findInPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("cloudflared", ["--version"], (err) => {
      resolve(err ? null : "cloudflared");
    });
  });
}

/** Download and cache the cloudflared binary, returns the path */
async function downloadCloudflared(): Promise<string> {
  const binPath = join(CACHE_DIR, binaryName());

  // Already cached
  try {
    await stat(binPath);
    return binPath;
  } catch {
    // not cached yet
  }

  const { url, archive } = getDownloadUrl();

  console.log(`Downloading cloudflared from ${url}...`);
  await mkdir(CACHE_DIR, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download cloudflared: ${res.status} ${res.statusText}`);
  }

  if (archive) {
    // macOS .tgz — extract using tar
    const tmpTgz = join(CACHE_DIR, "cloudflared.tgz");
    const body = await res.arrayBuffer();
    await writeFile(tmpTgz, new Uint8Array(body));

    await new Promise<void>((resolve, reject) => {
      execFile("tar", ["-xzf", tmpTgz, "-C", CACHE_DIR], (err) => {
        if (err) reject(new Error(`Failed to extract cloudflared: ${err.message}`));
        else resolve();
      });
    });
    await rm(tmpTgz).catch(() => {});
  } else {
    // Linux / Windows — direct binary
    const body = await res.arrayBuffer();
    await writeFile(binPath, new Uint8Array(body));
  }

  // Make executable on unix
  if (platform() !== "win32") {
    await chmod(binPath, 0o755);
  }

  console.log(`cloudflared cached at ${binPath}`);
  return binPath;
}

/** Ensure cloudflared is available — returns the path to the binary */
export async function ensureCloudflared(): Promise<string> {
  // Prefer system-installed version
  const systemPath = await findInPath();
  if (systemPath) return systemPath;

  // Auto-download to cache
  return await downloadCloudflared();
}

export interface TunnelHandle {
  url: string;
  close: () => void;
}

export async function openTunnel(port: number): Promise<TunnelHandle> {
  const cloudflaredBin = await ensureCloudflared();

  const child = spawn(cloudflaredBin, ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrStream = Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>;
  const url = await extractTunnelUrl(stderrStream);

  return {
    url,
    close() {
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
    },
  };
}

async function extractTunnelUrl(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

  const timeout = AbortSignal.timeout(30_000);
  let buffer = "";

  try {
    while (!timeout.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(urlPattern);
      if (match) {
        reader.releaseLock();
        return match[0];
      }
    }
  } catch {
    // timeout or read error
  }

  reader.releaseLock();
  throw new Error("Failed to extract tunnel URL from cloudflared output within 30s");
}
