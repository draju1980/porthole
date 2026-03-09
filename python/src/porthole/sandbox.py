"""Core Sandbox class."""

from __future__ import annotations

import asyncio
import json
import os
import socket
import time
import sys
import uuid
from dataclasses import asdict

from .types import SandboxOptions, RequestLog, LogEntry, ProcessStats, DeployOptions
from .proxy import ProxyServer
from .inspector import InspectorServer
from .tunnel import ensure_cloudflared, open_tunnel, TunnelHandle
from .deploy import deploy_to_workers


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


class Sandbox:
    """A sandboxed subprocess with a reverse proxy, inspector dashboard,
    and optional Cloudflare tunnel exposure.

    Example::

        from porthole import Sandbox

        sandbox = await Sandbox.create(SandboxOptions(entry="./app.py"))
        print(sandbox.url)
    """

    MAX_LOGS = 10_000
    MAX_REQUESTS = 5_000

    def __init__(self, options: SandboxOptions, app_port: int) -> None:
        self._options = options
        self._app_port = app_port
        self._proxy_port = options.port
        self._inspector_port = options.inspector_port if options.inspector else None
        self._start_time = time.time() * 1000

        self._process: asyncio.subprocess.Process | None = None
        self._proxy: ProxyServer | None = None
        self._inspector: InspectorServer | None = None
        self._tunnel: TunnelHandle | None = None
        self._logs: list[LogEntry] = []
        self._requests: list[RequestLog] = []

    @classmethod
    async def create(cls, options: SandboxOptions) -> Sandbox:
        """Create a new sandbox, spawning the app and starting the proxy/inspector."""
        if options.expose:
            await ensure_cloudflared()

        app_port = _find_free_port()
        sandbox = cls(options, app_port)
        await sandbox._start()

        if options.expose:
            await sandbox.expose()

        return sandbox

    async def _start(self) -> None:
        opts = self._options
        env = {**os.environ, **opts.env, "PORT": str(self._app_port)}

        command = opts.command or sys.executable
        args = [*opts.command_args, opts.entry, *opts.args]
        self._process = await asyncio.create_subprocess_exec(
            command,
            *args,
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        self._add_log("system", f"Spawned app (PID {self._process.pid}) on port {self._app_port}")

        asyncio.create_task(self._read_stream(self._process.stdout, "stdout"))
        asyncio.create_task(self._read_stream(self._process.stderr, "stderr"))

        await self._wait_for_app()

        self._proxy = ProxyServer(
            app_port=self._app_port,
            proxy_port=self._proxy_port,
            requests=self._requests,
            on_request=lambda req: self._on_request(req),
            max_requests=self.MAX_REQUESTS,
        )
        await self._proxy.start()
        self._add_log("system", f"Proxy listening on http://localhost:{self._proxy_port}")

        if opts.inspector:
            self._inspector = InspectorServer(
                port=opts.inspector_port,
                get_logs=lambda: self._logs,
                get_requests=lambda: self._requests,
                get_stats=lambda: self.stats,
            )
            await self._inspector.start()
            self._add_log("system", f"Inspector at http://localhost:{opts.inspector_port}")

    async def _read_stream(
        self,
        stream: asyncio.StreamReader,
        source: str,
    ) -> None:
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip("\n")
                if text:
                    entry = LogEntry(
                        timestamp=time.time() * 1000,
                        source=source,
                        message=text,
                    )
                    self._logs.append(entry)
                    if len(self._logs) > self.MAX_LOGS:
                        del self._logs[: len(self._logs) - self.MAX_LOGS]
                    await self._broadcast({"type": "log", "data": asdict(entry)})
        except Exception:
            pass

    async def _wait_for_app(self, max_attempts: int = 50, interval: float = 0.1) -> None:
        import aiohttp

        for _ in range(max_attempts):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"http://localhost:{self._app_port}/") as resp:
                        return
            except Exception:
                await asyncio.sleep(interval)
        raise RuntimeError(
            f"App did not start on port {self._app_port} within {max_attempts * interval}s"
        )

    def _add_log(self, source: str, message: str) -> None:
        entry = LogEntry(timestamp=time.time() * 1000, source=source, message=message)
        self._logs.append(entry)
        if len(self._logs) > self.MAX_LOGS:
            del self._logs[: len(self._logs) - self.MAX_LOGS]

    def _on_request(self, req: RequestLog) -> None:
        self._add_log("proxy", f"{req.method} {req.url} -> {req.status or 'pending'}")
        # Fire-and-forget broadcast
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._broadcast({"type": "request", "data": asdict(req)}))
        except RuntimeError:
            pass

    async def _broadcast(self, msg: dict) -> None:
        if self._inspector:
            await self._inspector.broadcast(msg)

    @property
    def stats(self) -> ProcessStats:
        """Current runtime statistics for the sandbox."""
        return ProcessStats(
            pid=self._process.pid if self._process else None,
            uptime=time.time() * 1000 - self._start_time,
            request_count=len(self._requests),
            app_port=self._app_port,
            proxy_port=self._proxy_port,
            inspector_port=self._inspector_port,
        )

    @property
    def logs(self) -> list[LogEntry]:
        """All log entries from the subprocess and system."""
        return self._logs

    @property
    def requests(self) -> list[RequestLog]:
        """All captured HTTP request/response pairs."""
        return self._requests

    @property
    def url(self) -> str:
        """Local proxy URL (e.g. ``http://localhost:9090``)."""
        return f"http://localhost:{self._proxy_port}"

    @property
    def inspector_url(self) -> str | None:
        """Local inspector dashboard URL, or ``None`` if inspector is disabled."""
        return f"http://localhost:{self._inspector_port}" if self._inspector_port else None

    @property
    def tunnel_url(self) -> str | None:
        """Public Cloudflare tunnel URL, or ``None`` if not exposed."""
        return self._tunnel.url if self._tunnel else None

    async def expose(self) -> str:
        """Open a Cloudflare Quick Tunnel to expose the proxy publicly."""
        if self._tunnel:
            return self._tunnel.url
        self._tunnel = await open_tunnel(self._proxy_port)
        self._add_log("system", f"Tunnel open at {self._tunnel.url}")
        return self._tunnel.url

    async def deploy(self, options: DeployOptions) -> str:
        """Deploy to Cloudflare Workers."""
        worker_url = await deploy_to_workers(self._options.entry, options)
        self._add_log("system", f"Deployed to {worker_url}")
        return worker_url

    async def close(self) -> None:
        """Shut down everything."""
        if self._tunnel:
            self._tunnel.close()
            self._tunnel = None

        if self._inspector:
            await self._inspector.shutdown()
            self._inspector = None

        if self._proxy:
            await self._proxy.shutdown()
            self._proxy = None

        if self._process:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass
            await self._process.wait()
            self._process = None

        self._add_log("system", "Sandbox closed")
