# porthole-sandbox

Local sandbox runtime for Python with built-in HTTP inspection, Cloudflare tunnel exposure, and Cloudflare Workers deployment. Zero Docker, zero VMs, zero config.

## Install

```bash
pip install porthole-sandbox
```

## Quick Start

```python
import asyncio
from porthole import Sandbox, SandboxOptions

async def main():
    sandbox = await Sandbox.create(SandboxOptions(
        entry="./app.py",
    ))

    print(f"Proxy:     {sandbox.url}")         # http://localhost:9090
    print(f"Inspector: {sandbox.inspector_url}")  # http://localhost:9099
    print(f"Tunnel:    {sandbox.tunnel_url}")   # https://random-words.trycloudflare.com

    # ... do work ...

    await sandbox.close()

asyncio.run(main())
```

## Features

- Runs any HTTP app in a subprocess sandbox
- Reverse proxy with full request/response logging
- Live inspector dashboard (WebSocket-powered)
- Auto-exposes your app publicly via Cloudflare Quick Tunnels — no install needed
- One-call deploy to Cloudflare Workers

## Configuration

`Sandbox.create()` accepts a `SandboxOptions` dataclass:

| Option | Type | Default | Description |
|---|---|---|---|
| `entry` | `str` | **(required)** | Path to the script to run |
| `port` | `int` | `9090` | Port for the reverse proxy |
| `inspector_port` | `int` | `9099` | Port for the inspector dashboard |
| `env` | `dict[str, str]` | `{}` | Environment variables passed to the subprocess |
| `args` | `list[str]` | `[]` | Arguments passed to the subprocess |
| `inspector` | `bool` | `True` | Enable/disable the inspector dashboard |
| `expose` | `bool` | `True` | Expose app via Cloudflare Quick Tunnel on create |
| `command` | `str` | `"python"` | Command to run the entry script |
| `command_args` | `list[str]` | `[]` | Arguments passed before the entry path |

## Cloudflare Quick Tunnels

By default, `Sandbox.create()` automatically exposes your app to the internet using [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no Cloudflare account needed.

Porthole manages the `cloudflared` binary for you:

1. If `cloudflared` is already installed on your system, Porthole uses it
2. If not, Porthole automatically downloads the correct binary for your platform and caches it at `~/.porthole/bin/cloudflared`
3. A tunnel is opened from your proxy port to a public `*.trycloudflare.com` URL
4. The tunnel is automatically closed when you call `sandbox.close()`

### Disable the tunnel

```python
sandbox = await Sandbox.create(SandboxOptions(
    entry="./app.py",
    expose=False,
))
```

### Manually expose later

```python
sandbox = await Sandbox.create(SandboxOptions(entry="./app.py", expose=False))
public_url = await sandbox.expose()
```

## Deploying to Cloudflare Workers

```python
from porthole import DeployOptions

worker_url = await sandbox.deploy(DeployOptions(
    account_id=os.environ["CF_ACCOUNT_ID"],
    api_token=os.environ["CF_API_TOKEN"],
    name="my-app",
))
```

## API Reference

### `Sandbox`

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

## Also available for Node.js and Deno

```bash
npm install porthole-sandbox
```

```ts
import { Sandbox } from "jsr:@porthole/core";  // Deno
```

## License

MIT
