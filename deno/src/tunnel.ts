import { join } from "jsr:@std/path@1";

const CACHE_DIR = join(Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".", ".porthole", "bin");

function getDownloadUrl(): { url: string; archive: boolean } {
  const os = Deno.build.os;
  const arch = Deno.build.arch === "aarch64" ? "arm64" : "amd64";

  if (os === "darwin") {
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`,
      archive: true,
    };
  }
  if (os === "linux") {
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`,
      archive: false,
    };
  }
  if (os === "windows") {
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`,
      archive: false,
    };
  }
  throw new Error(`Unsupported platform: ${os}/${arch}`);
}

function binaryName(): string {
  return Deno.build.os === "windows" ? "cloudflared.exe" : "cloudflared";
}

/** Check if cloudflared is available in PATH */
async function findInPath(): Promise<string | null> {
  try {
    const cmd = new Deno.Command("cloudflared", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    });
    const { success } = await cmd.output();
    return success ? "cloudflared" : null;
  } catch {
    return null;
  }
}

/** Download and cache the cloudflared binary, returns the path */
async function downloadCloudflared(): Promise<string> {
  const binPath = join(CACHE_DIR, binaryName());

  // Already cached
  try {
    await Deno.stat(binPath);
    return binPath;
  } catch {
    // not cached yet
  }

  const { url, archive } = getDownloadUrl();

  console.log(`Downloading cloudflared from ${url}...`);
  await Deno.mkdir(CACHE_DIR, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download cloudflared: ${res.status} ${res.statusText}`);
  }

  if (archive) {
    // macOS .tgz — extract using tar
    const tmpTgz = join(CACHE_DIR, "cloudflared.tgz");
    const body = await res.arrayBuffer();
    await Deno.writeFile(tmpTgz, new Uint8Array(body));

    const tar = new Deno.Command("tar", {
      args: ["-xzf", tmpTgz, "-C", CACHE_DIR],
      stdout: "null",
      stderr: "piped",
    });
    const { success, stderr } = await tar.output();
    await Deno.remove(tmpTgz).catch(() => {});
    if (!success) {
      const msg = new TextDecoder().decode(stderr);
      throw new Error(`Failed to extract cloudflared: ${msg}`);
    }
  } else {
    // Linux / Windows — direct binary
    const body = await res.arrayBuffer();
    await Deno.writeFile(binPath, new Uint8Array(body));
  }

  // Make executable on unix
  if (Deno.build.os !== "windows") {
    await Deno.chmod(binPath, 0o755);
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

  const cmd = new Deno.Command(cloudflaredBin, {
    args: ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const url = await extractTunnelUrl(process.stderr);

  return {
    url,
    close() {
      try {
        process.kill("SIGTERM");
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
