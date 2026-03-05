# porthole

Porthole is a Deno-native local sandbox runtime with built-in HTTP inspection, Cloudflare tunnel exposure, and Cloudflare Workers deployment. Zero Docker, zero VMs, zero config.

```
jsr:@porthole/core
```

## Features

- Runs any Deno HTTP app in a subprocess sandbox
- Reverse proxy with full request/response logging
- Live inspector dashboard (WebSocket-powered)
- One-call public URL via Cloudflare Quick Tunnels
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

console.log(`Proxy:     ${sandbox.url}`);        // http://localhost:9090
console.log(`Inspector: ${sandbox.inspectorUrl}`); // http://localhost:9099

Deno.addSignalListener("SIGINT", async () => {
  await sandbox.close();
  Deno.exit(0);
});
```

```bash
deno run --allow-all run.ts
```

Then hit your app through the proxy:

```bash
curl http://localhost:9090/
curl http://localhost:9090/json
```

Open `http://localhost:9099` in a browser to view the live inspector dashboard.

## Configuration

`Sandbox.create()` accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `entry` | `string` | **(required)** | Path to the Deno script to run |
| `port` | `number` | `9090` | Port for the reverse proxy |
| `inspectorPort` | `number` | `9099` | Port for the inspector dashboard |
| `permissions` | `string[]` | `["--allow-net", "--allow-env"]` | Deno permissions for the subprocess |
| `env` | `Record<string, string>` | `{}` | Environment variables passed to the subprocess |
| `args` | `string[]` | `[]` | Arguments passed to the subprocess |
| `inspector` | `boolean` | `true` | Enable/disable the inspector dashboard |

## Publishing with Cloudflare Quick Tunnels

Expose your sandboxed app to the internet instantly using [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no Cloudflare account needed.

### Prerequisites

Install `cloudflared`:

```bash
# macOS
brew install cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
```

### Usage

```ts
import { Sandbox } from "jsr:@porthole/core";

const sandbox = await Sandbox.create({
  entry: new URL("./app.ts", import.meta.url).pathname,
});

// Expose via Cloudflare Quick Tunnel
const publicUrl = await sandbox.expose();
console.log(`Public URL: ${publicUrl}`);
// => https://random-words.trycloudflare.com

// Shut down when done
await sandbox.close();
```

`sandbox.expose()` spawns a `cloudflared` subprocess that opens a tunnel from the proxy port to a public `*.trycloudflare.com` URL. The tunnel is automatically closed when you call `sandbox.close()`.

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

## API Reference

### `Sandbox`

| Property / Method | Returns | Description |
|---|---|---|
| `Sandbox.create(options)` | `Promise<Sandbox>` | Create and start a sandbox |
| `sandbox.url` | `string` | Proxy URL (`http://localhost:<port>`) |
| `sandbox.inspectorUrl` | `string \| null` | Inspector URL (null if disabled) |
| `sandbox.logs` | `readonly LogEntry[]` | All captured log entries |
| `sandbox.requests` | `readonly RequestLog[]` | All captured HTTP requests |
| `sandbox.stats` | `ProcessStats` | Process stats (pid, uptime, request count, ports) |
| `sandbox.expose()` | `Promise<string>` | Open a Cloudflare Quick Tunnel, returns public URL |
| `sandbox.deploy(options)` | `Promise<string>` | Deploy to Cloudflare Workers, returns worker URL |
| `sandbox.close()` | `Promise<void>` | Gracefully shut down everything |

## License

MIT
