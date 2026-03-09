# porthole

Local sandbox runtime with built-in HTTP inspection, Cloudflare tunnel exposure, and Cloudflare Workers deployment. Zero Docker, zero VMs, zero config.

Available as three independent packages:

| Package | Runtime | Registry | Install |
|---------|---------|----------|---------|
| `@porthole/core` (Deno) | Deno | [JSR](https://jsr.io/@porthole/core) | `import { Sandbox } from "jsr:@porthole/core"` |
| `porthole-sandbox` (Node) | Node.js 18+ | [npm](https://www.npmjs.com/package/porthole-sandbox) | `npm install porthole-sandbox` |
| `porthole-sandbox` (Python) | Python 3.10+ | [PyPI](https://pypi.org/project/porthole-sandbox/) | `pip install porthole-sandbox` |

## Features

- Runs any HTTP app in a subprocess sandbox
- Reverse proxy with full request/response logging
- Live inspector dashboard (WebSocket-powered)
- Auto-exposes your app publicly via Cloudflare Quick Tunnels — no install needed
- One-call deploy to Cloudflare Workers

## Quick Start (Deno)

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

## Quick Start (Node.js)

```ts
import { Sandbox } from "porthole-sandbox";

const sandbox = await Sandbox.create({
  entry: "./app.mjs",
});

console.log(`Proxy:     ${sandbox.url}`);         // http://localhost:9090
console.log(`Inspector: ${sandbox.inspectorUrl}`); // http://localhost:9099
console.log(`Tunnel:    ${sandbox.tunnelUrl}`);    // https://random-words.trycloudflare.com

process.on("SIGINT", async () => {
  await sandbox.close();
  process.exit(0);
});
```

```bash
node run.mjs
```

## Quick Start (Python)

```python
import asyncio
from porthole import Sandbox, SandboxOptions

async def main():
    sandbox = await Sandbox.create(SandboxOptions(
        entry="./app.py",
    ))

    print(f"Proxy:     {sandbox.url}")           # http://localhost:9090
    print(f"Inspector: {sandbox.inspector_url}")  # http://localhost:9099
    print(f"Tunnel:    {sandbox.tunnel_url}")     # https://random-words.trycloudflare.com

    # ... do work ...
    await sandbox.close()

asyncio.run(main())
```

```bash
python run.py
```

## Configuration

`Sandbox.create()` accepts the following options:

### Shared options (all runtimes)

| Option | Type | Default | Description |
|---|---|---|---|
| `entry` | `string` | **(required)** | Path to the script to run |
| `port` | `number` / `int` | `9090` | Port for the reverse proxy |
| `inspectorPort` / `inspector_port` | `number` / `int` | `9099` | Port for the inspector dashboard |
| `env` | `Record<string, string>` / `dict[str, str]` | `{}` | Environment variables passed to the subprocess |
| `args` | `string[]` / `list[str]` | `[]` | Arguments passed to the subprocess |
| `inspector` | `boolean` / `bool` | `true` / `True` | Enable/disable the inspector dashboard |
| `expose` | `boolean` / `bool` | `true` / `True` | Expose app via Cloudflare Quick Tunnel on create |

### Deno-only options

| Option | Type | Default | Description |
|---|---|---|---|
| `permissions` | `string[]` | `["--allow-net", "--allow-env"]` | Deno permission flags (`--allow-*` / `--deny-*` only) |

### Node-only options

| Option | Type | Default | Description |
|---|---|---|---|
| `command` | `string` | `"node"` | Command to run the entry script |
| `commandArgs` | `string[]` | `[]` | Arguments passed before the entry path |

### Python-only options

| Option | Type | Default | Description |
|---|---|---|---|
| `command` | `str` | `sys.executable` | Command to run the entry script |
| `command_args` | `list[str]` | `[]` | Arguments passed before the entry path |

## Cloudflare Quick Tunnels

By default, `Sandbox.create()` automatically exposes your app to the internet using [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no Cloudflare account needed.

Porthole manages the `cloudflared` binary for you:

1. If `cloudflared` is already installed on your system, Porthole uses it
2. If not, Porthole automatically downloads the correct binary for your platform and caches it at `~/.porthole/bin/cloudflared`
3. A tunnel is opened from your proxy port to a public `*.trycloudflare.com` URL
4. The tunnel is automatically closed when you call `sandbox.close()`

### Disable the tunnel

<details>
<summary>Deno / Node.js</summary>

```ts
const sandbox = await Sandbox.create({
  entry: "./app.ts",
  expose: false,
});
```
</details>

<details>
<summary>Python</summary>

```python
sandbox = await Sandbox.create(SandboxOptions(
    entry="./app.py",
    expose=False,
))
```
</details>

### Manually expose later

<details>
<summary>Deno / Node.js</summary>

```ts
const sandbox = await Sandbox.create({ entry: "./app.ts", expose: false });
const publicUrl = await sandbox.expose();
```
</details>

<details>
<summary>Python</summary>

```python
sandbox = await Sandbox.create(SandboxOptions(entry="./app.py", expose=False))
public_url = await sandbox.expose()
```
</details>

## Deploying to Cloudflare Workers

<details>
<summary>Deno / Node.js</summary>

```ts
const workerUrl = await sandbox.deploy({
  accountId: process.env.CF_ACCOUNT_ID,  // or Deno.env.get("CF_ACCOUNT_ID")
  apiToken: process.env.CF_API_TOKEN,
  name: "my-app",
});
```
</details>

<details>
<summary>Python</summary>

```python
from porthole import DeployOptions

worker_url = await sandbox.deploy(DeployOptions(
    account_id=os.environ["CF_ACCOUNT_ID"],
    api_token=os.environ["CF_API_TOKEN"],
    name="my-app",
))
```
</details>

## API Reference

### `Sandbox` (Deno / Node.js)

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

### `Sandbox` (Python)

| Property / Method | Returns | Description |
|---|---|---|
| `Sandbox.create(options)` | `Sandbox` | Create and start a sandbox |
| `Sandbox.MAX_LOGS` | `int` | Maximum log entries retained (10,000) |
| `Sandbox.MAX_REQUESTS` | `int` | Maximum request entries retained (5,000) |
| `sandbox.url` | `str` | Proxy URL (`http://localhost:<port>`) |
| `sandbox.inspector_url` | `str \| None` | Inspector URL (None if disabled) |
| `sandbox.tunnel_url` | `str \| None` | Public tunnel URL (None if not exposed) |
| `sandbox.logs` | `list[LogEntry]` | All captured log entries |
| `sandbox.requests` | `list[RequestLog]` | All captured HTTP requests |
| `sandbox.stats` | `ProcessStats` | Process stats (pid, uptime, request count, ports) |
| `sandbox.expose()` | `str` | Open a Cloudflare Quick Tunnel |
| `sandbox.deploy(options)` | `str` | Deploy to Cloudflare Workers |
| `sandbox.close()` | `None` | Gracefully shut down everything |

## Repo Structure

```
porthole/
  deno/          ← JSR package (Deno-native)
  npm/           ← npm package (Node-native)
  python/        ← PyPI package (Python-native)
  README.md
  LICENSE
  SECURITY.md
```

## Security

See [SECURITY.md](./SECURITY.md) for security measures and responsible disclosure.

## License

MIT
