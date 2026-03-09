"""Inspector server with REST API, WebSocket, and dashboard."""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from typing import Callable

from aiohttp import web
import websockets
from websockets.asyncio.server import serve as ws_serve, ServerConnection

from .types import LogEntry, RequestLog, ProcessStats
from .dashboard import dashboard_html


class InspectorServer:
    def __init__(
        self,
        port: int,
        get_logs: Callable[[], list[LogEntry]],
        get_requests: Callable[[], list[RequestLog]],
        get_stats: Callable[[], ProcessStats],
    ):
        self._port = port
        self._get_logs = get_logs
        self._get_requests = get_requests
        self._get_stats = get_stats
        self._sockets: set[ServerConnection] = set()
        self._runner: web.AppRunner | None = None
        self._ws_server = None

    @property
    def sockets(self) -> set[ServerConnection]:
        return self._sockets

    async def start(self) -> None:
        app = web.Application()
        app.router.add_get("/api/logs", self._api_logs)
        app.router.add_get("/api/requests", self._api_requests)
        app.router.add_get("/api/stats", self._api_stats)
        app.router.add_get("/", self._dashboard)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "localhost", self._port)
        await site.start()

        self._ws_server = await ws_serve(
            self._ws_handler,
            "localhost",
            self._port + 1,
        )

    async def _api_logs(self, request: web.Request) -> web.Response:
        logs = [asdict(l) for l in self._get_logs()]
        return web.json_response(logs)

    async def _api_requests(self, request: web.Request) -> web.Response:
        reqs = [asdict(r) for r in self._get_requests()]
        return web.json_response(reqs)

    async def _api_stats(self, request: web.Request) -> web.Response:
        return web.json_response(asdict(self._get_stats()))

    async def _dashboard(self, request: web.Request) -> web.Response:
        return web.Response(
            text=dashboard_html(),
            content_type="text/html",
            charset="utf-8",
        )

    async def _ws_handler(self, websocket: ServerConnection) -> None:
        self._sockets.add(websocket)
        try:
            init_data = {
                "type": "init",
                "data": {
                    "logs": [asdict(l) for l in self._get_logs()],
                    "requests": [asdict(r) for r in self._get_requests()],
                    "stats": asdict(self._get_stats()),
                },
            }
            await websocket.send(json.dumps(init_data))

            async for message in websocket:
                try:
                    msg = json.loads(message)
                    if msg.get("type") == "ping":
                        await websocket.send(json.dumps({
                            "type": "pong",
                            "data": {"stats": asdict(self._get_stats())},
                        }))
                except (json.JSONDecodeError, KeyError):
                    pass
        finally:
            self._sockets.discard(websocket)

    async def broadcast(self, msg: dict) -> None:
        if not self._sockets:
            return
        data = json.dumps(msg)
        await asyncio.gather(
            *(ws.send(data) for ws in self._sockets),
            return_exceptions=True,
        )

    async def shutdown(self) -> None:
        for ws in list(self._sockets):
            await ws.close()
        self._sockets.clear()
        if self._ws_server:
            self._ws_server.close()
            await self._ws_server.wait_closed()
            self._ws_server = None
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
