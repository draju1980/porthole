# porthole

Deno-native local sandbox runtime with built-in HTTP inspection, Cloudflare tunnel exposure, and Cloudflare Workers deployment. Zero Docker, zero VMs, zero config.

Published on [JSR](https://jsr.io/@porthole/core) as `@porthole/core`.

```ts
import { Sandbox } from "jsr:@porthole/core";
```

## Features

- Runs any HTTP app in a Deno subprocess sandbox
- Reverse proxy with full request/response logging
- Live inspector dashboard (WebSocket-powered)
- Auto-exposes your app publicly via Cloudflare Quick Tunnels — no install needed
- One-call deploy to Cloudflare Workers

## Quick Start

```ts
import { Sandbox } from "jsr:@porthole/core";

const sandbox = await Sandbox.create({
  entry: new URL("./app.ts", import.meta.url).pathname,
});

console.log(`Proxy:     ${sandbox.url}`);         // http://localhost:9090
console.log(`Inspector: ${sandbox.inspectorUrl}`); // http://localhost:9099
console.log(`Tunnel:    ${sandbox.tunnelUrl}`);    // https://random-words.trycloudflare.com

Deno.addSignalListener("SIGINT", async () => {
  await sandbox.close();
  Deno.exit(0);
});
```

```bash
deno run --allow-all run.ts
```

## Configuration

`Sandbox.create()` accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `entry` | `string` | **(required)** | Path to the script to run |
| `port` | `number` | `9090` | Port for the reverse proxy |
| `inspectorPort` | `number` | `9099` | Port for the inspector dashboard |
| `env` | `Record<string, string>` | `{}` | Environment variables passed to the subprocess |
| `args` | `string[]` | `[]` | Arguments passed to the subprocess |
| `inspector` | `boolean` | `true` | Enable/disable the inspector dashboard |
| `expose` | `boolean` | `true` | Expose app via Cloudflare Quick Tunnel on create |
| `permissions` | `string[]` | `["--allow-net", "--allow-env"]` | Deno permission flags (`--allow-*` / `--deny-*` only) |

## Cloudflare Quick Tunnels

By default, `Sandbox.create()` automatically exposes your app to the internet using [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no Cloudflare account needed.

Porthole manages the `cloudflared` binary for you:

1. If `cloudflared` is already installed on your system, Porthole uses it
2. If not, Porthole automatically downloads the correct binary for your platform and caches it at `~/.porthole/bin/cloudflared`
3. A tunnel is opened from your proxy port to a public `*.trycloudflare.com` URL
4. The tunnel is automatically closed when you call `sandbox.close()`

### Disable the tunnel

```ts
const sandbox = await Sandbox.create({
  entry: "./app.ts",
  expose: false,
});
```

### Manually expose later

```ts
const sandbox = await Sandbox.create({ entry: "./app.ts", expose: false });
const publicUrl = await sandbox.expose();
```

## Deploying to Cloudflare Workers

```ts
const workerUrl = await sandbox.deploy({
  accountId: Deno.env.get("CF_ACCOUNT_ID")!,
  apiToken: Deno.env.get("CF_API_TOKEN")!,
  name: "my-app",
});
```

## API Reference

### `Sandbox`

| Property / Method | Returns | Description |
|---|---|---|
| `Sandbox.create(options)` | `Promise<Sandbox>` | Create and start a sandbox |
| `Sandbox.MAX_LOGS` | `number` | Maximum log entries retained (10,000) |
| `Sandbox.MAX_REQUESTS` | `number` | Maximum request entries retained (5,000) |
| `sandbox.url` | `string` | Proxy URL (`http://localhost:<port>`) |
| `sandbox.inspectorUrl` | `string \| null` | Inspector URL (null if disabled) |
| `sandbox.tunnelUrl` | `string \| null` | Public tunnel URL (null if not exposed) |
| `sandbox.logs` | `readonly LogEntry[]` | All captured log entries |
| `sandbox.requests` | `readonly RequestLog[]` | All captured HTTP requests |
| `sandbox.stats` | `ProcessStats` | Process stats (pid, uptime, request count, ports) |
| `sandbox.expose()` | `Promise<string>` | Open a Cloudflare Quick Tunnel |
| `sandbox.deploy(options)` | `Promise<string>` | Deploy to Cloudflare Workers |
| `sandbox.close()` | `Promise<void>` | Gracefully shut down everything |

## Repo Structure

```
porthole/
  mod.ts         ← public entrypoint (JSR)
  deno.json      ← JSR package config
  src/           ← implementation
  examples/      ← sample app + runner
  README.md
  LICENSE
```

## License

MIT
