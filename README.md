# porthole

Porthole is a Deno-native local sandbox runtime with built-in HTTP inspection, Cloudflare tunnel exposure, and Cloudflare Workers deployment. Zero Docker, zero VMs, zero config.

```
jsr:@porthole/core
```

## Features

- Runs any Deno HTTP app in a subprocess sandbox
- Reverse proxy with full request/response logging
- Live inspector dashboard (WebSocket-powered)
- Auto-exposes your app publicly via Cloudflare Quick Tunnels — no install needed
- One-call deploy to Cloudflare Workers

## Installation

```ts
import { Sandbox } from "jsr:@porthole/core";
```

## Quick Start

Create a simple HTTP app (`app.ts`):

```ts
const port = Number(Deno.env.get("PORT") ?? "3000");

Deno.serve({ port }, (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response("Hello from Porthole sandbox!");
  }

  if (url.pathname === "/json") {
    return Response.json({ message: "Hello!", timestamp: Date.now() });
  }

  return new Response("Not Found", { status: 404 });
});
```

Run it inside a sandbox (`run.ts`):

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

Your app is immediately available locally and publicly:

```bash
# Local
curl http://localhost:9090/
curl http://localhost:9090/json

# Public (via Cloudflare Tunnel)
curl https://random-words.trycloudflare.com/
```

Open `http://localhost:9099` in a browser to view the live inspector dashboard.

## Configuration

`Sandbox.create()` accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `entry` | `string` | **(required)** | Path to the Deno script to run |
| `port` | `number` | `9090` | Port for the reverse proxy |
| `inspectorPort` | `number` | `9099` | Port for the inspector dashboard |
| `permissions` | `string[]` | `["--allow-net", "--allow-env"]` | Deno permission flags (`--allow-*` / `--deny-*` only) |
| `env` | `Record<string, string>` | `{}` | Environment variables passed to the subprocess |
| `args` | `string[]` | `[]` | Arguments passed to the subprocess |
| `inspector` | `boolean` | `true` | Enable/disable the inspector dashboard |
| `expose` | `boolean` | `true` | Expose app via Cloudflare Quick Tunnel on create |

## Cloudflare Quick Tunnels

By default, `Sandbox.create()` automatically exposes your app to the internet using [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no Cloudflare account needed.

### How it works

Porthole manages the `cloudflared` binary for you:

1. If `cloudflared` is already installed on your system, Porthole uses it
2. If not, Porthole automatically downloads the correct binary for your platform (macOS/Linux/Windows, amd64/arm64) and caches it at `~/.porthole/bin/cloudflared`
3. A tunnel is opened from your proxy port to a public `*.trycloudflare.com` URL
4. The tunnel is automatically closed when you call `sandbox.close()`

No manual installation required. It just works.

### Access the tunnel URL

```ts
const sandbox = await Sandbox.create({
  entry: "./app.ts",
});

console.log(sandbox.tunnelUrl);
// => https://random-words.trycloudflare.com
```

### Disable the tunnel

If you only want local access:

```ts
const sandbox = await Sandbox.create({
  entry: "./app.ts",
  expose: false,
});
```

### Manually expose later

You can also disable auto-expose and open the tunnel on demand:

```ts
const sandbox = await Sandbox.create({
  entry: "./app.ts",
  expose: false,
});

// ... do some local testing ...

const publicUrl = await sandbox.expose();
console.log(`Now public at: ${publicUrl}`);
```

## Deploying to Cloudflare Workers

Deploy your app directly to Cloudflare Workers for permanent, production-grade hosting.

### Dependencies

| Dependency | Purpose | Install |
|---|---|---|
| [Deno](https://deno.land/) >= 1.40 | Runtime | `curl -fsSL https://deno.land/install.sh \| sh` |
| Cloudflare account | Workers hosting | [Sign up (free)](https://dash.cloudflare.com/sign-up) |
| Cloudflare API token | Authentication | [Create token](https://dash.cloudflare.com/profile/api-tokens) |

### Step 1 — Create a Cloudflare Account

Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) if you don't have one already.

### Step 2 — Get Your Account ID

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Go to **Workers & Pages** in the left sidebar
3. Your **Account ID** is displayed on the right side of the overview page
4. Copy it and save it — you'll need it for deployment

### Step 3 — Create an API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **Edit Cloudflare Workers** template, or create a custom token with:
   - **Account > Workers Scripts > Edit**
4. Complete the wizard and copy the generated token

### Step 4 — Set Environment Variables

```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
```

Or create a `.env` file (make sure it's in `.gitignore`):

```
CF_ACCOUNT_ID=your-account-id
CF_API_TOKEN=your-api-token
```

### Step 5 — Write a Workers-Compatible App

Your entry script must use the Web Standards API (`fetch` handler) that Cloudflare Workers supports:

```ts
// worker-app.ts
const port = Number(Deno.env.get("PORT") ?? "3000");

Deno.serve({ port }, (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response("Hello from Cloudflare Workers!");
  }

  if (url.pathname === "/api") {
    return Response.json({ status: "ok", timestamp: Date.now() });
  }

  return new Response("Not Found", { status: 404 });
});
```

> **Important:** Avoid using Deno-specific APIs (e.g., `Deno.readFile`, `Deno.env`) in the code you deploy. Workers run on the [Cloudflare Workers runtime](https://developers.cloudflare.com/workers/runtime-apis/), which supports Web Standards APIs (`fetch`, `Request`, `Response`, `URL`, `crypto`, etc.) but not Node.js or Deno built-ins.

### Step 6 — Deploy via Porthole

```ts
// deploy.ts
import { Sandbox } from "jsr:@porthole/core";

const sandbox = await Sandbox.create({
  entry: new URL("./worker-app.ts", import.meta.url).pathname,
});

// Test locally first
console.log(`Local proxy: ${sandbox.url}`);

// Deploy to Cloudflare Workers
const workerUrl = await sandbox.deploy({
  accountId: Deno.env.get("CF_ACCOUNT_ID")!,
  apiToken: Deno.env.get("CF_API_TOKEN")!,
  name: "my-app", // optional, defaults to entry filename
});

console.log(`Deployed to: ${workerUrl}`);
// => https://my-app.<your-subdomain>.workers.dev

await sandbox.close();
```

Run the deployment:

```bash
deno run --allow-all deploy.ts
```

### Step 7 — Verify Your Deployment

```bash
curl https://my-app.<your-subdomain>.workers.dev/
curl https://my-app.<your-subdomain>.workers.dev/api
```

You can also check the deployment in the [Cloudflare dashboard](https://dash.cloudflare.com/) under **Workers & Pages**.

### Deploy Options

| Option | Type | Default | Description |
|---|---|---|---|
| `accountId` | `string` | **(required)** | Cloudflare account ID |
| `apiToken` | `string` | **(required)** | API token with Workers write permissions |
| `name` | `string` | entry filename | Worker name (used in the `*.workers.dev` subdomain) |

### How It Works

1. Porthole reads your entry script
2. Uploads it to the Cloudflare Workers API as an ES module
3. Sets `compatibility_date` to `2024-01-01`
4. Enables the `workers.dev` subdomain route so your worker is immediately accessible

### Workers Runtime Compatibility

| Supported | Not Supported |
|---|---|
| `fetch`, `Request`, `Response` | `Deno.*` APIs |
| `URL`, `URLSearchParams` | `Node.js` built-ins (without polyfills) |
| `crypto`, `TextEncoder/Decoder` | File system access |
| `Headers`, `FormData` | Subprocess spawning |
| `setTimeout`, `setInterval` | Raw TCP/UDP sockets |
| `structuredClone` | |
| `WebSocket` (client) | |

## Security

Porthole includes several built-in security measures:

### Permission Validation

The `permissions` option only accepts `--allow-*` and `--deny-*` flags for specific Deno permissions (`net`, `env`, `read`, `write`, `run`, `ffi`, `sys`, `hrtime`). Broad flags like `--allow-all` and arbitrary CLI flags are rejected to prevent privilege escalation.

```ts
// Valid
await Sandbox.create({ entry: "./app.ts", permissions: ["--allow-net", "--deny-env"] });
await Sandbox.create({ entry: "./app.ts", permissions: ["--allow-net=0.0.0.0"] });

// Throws — invalid permission flag
await Sandbox.create({ entry: "./app.ts", permissions: ["--allow-all"] }); // rejected
await Sandbox.create({ entry: "./app.ts", permissions: ["--unstable"] });  // rejected
```

### Bounded Log and Request Buffers

Logs and HTTP request captures are capped to prevent unbounded memory growth:

- **Logs**: 10,000 entries max (`Sandbox.MAX_LOGS`)
- **Requests**: 5,000 entries max (`Sandbox.MAX_REQUESTS`)

Oldest entries are automatically trimmed when limits are reached.

### XSS Protection

The inspector dashboard escapes all user-controlled data (HTTP methods, URLs, headers, bodies) before rendering to prevent cross-site scripting.

### API URL Safety

Cloudflare API parameters (`accountId`, `workerName`) are URI-encoded to prevent URL injection in deploy requests.

### Recommendations

- **Inspector access**: The inspector dashboard has no authentication. Avoid exposing it on public interfaces — it is intended for local development only.
- **Tunnel awareness**: Cloudflare Quick Tunnels expose your proxy port publicly. Only use `expose: true` (the default) when you intend public access.

## API Reference

### `Sandbox`

| Property / Method | Returns | Description |
|---|---|---|
| `Sandbox.create(options)` | `Promise<Sandbox>` | Create and start a sandbox (auto-exposes via tunnel by default) |
| `Sandbox.MAX_LOGS` | `number` | Maximum log entries retained (default: 10,000) |
| `Sandbox.MAX_REQUESTS` | `number` | Maximum request entries retained (default: 5,000) |
| `sandbox.url` | `string` | Proxy URL (`http://localhost:<port>`) |
| `sandbox.inspectorUrl` | `string \| null` | Inspector URL (null if disabled) |
| `sandbox.tunnelUrl` | `string \| null` | Public tunnel URL (null if not exposed) |
| `sandbox.logs` | `readonly LogEntry[]` | All captured log entries |
| `sandbox.requests` | `readonly RequestLog[]` | All captured HTTP requests |
| `sandbox.stats` | `ProcessStats` | Process stats (pid, uptime, request count, ports) |
| `sandbox.expose()` | `Promise<string>` | Open a Cloudflare Quick Tunnel, returns public URL |
| `sandbox.deploy(options)` | `Promise<string>` | Deploy to Cloudflare Workers, returns worker URL |
| `sandbox.close()` | `Promise<void>` | Gracefully shut down everything |

## License

MIT
