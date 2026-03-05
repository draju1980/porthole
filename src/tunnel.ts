export interface TunnelHandle {
  url: string;
  close: () => void;
}

export async function openTunnel(port: number): Promise<TunnelHandle> {
  const cmd = new Deno.Command("cloudflared", {
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
