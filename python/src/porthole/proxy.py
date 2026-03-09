"""Reverse HTTP proxy with request/response logging."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import asdict

import aiohttp
from aiohttp import web

from .types import RequestLog


class ProxyServer:
    def __init__(
        self,
        app_port: int,
        proxy_port: int,
        requests: list[RequestLog],
        on_request: callable,
        max_requests: int = 5_000,
    ):
        self._app_port = app_port
        self._proxy_port = proxy_port
        self._requests = requests
        self._on_request = on_request
        self._max_requests = max_requests
        self._runner: web.AppRunner | None = None
        self._session: aiohttp.ClientSession | None = None

    async def start(self) -> None:
        self._session = aiohttp.ClientSession()
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "localhost", self._proxy_port)
        await site.start()

    async def _handle(self, request: web.Request) -> web.Response:
        req_id = uuid.uuid4().hex[:8]
        start = time.monotonic()
        url_path = request.path
        if request.query_string:
            url_path += f"?{request.query_string}"

        request_headers = dict(request.headers)
        request_body: str | None = None
        if request.method not in ("GET", "HEAD"):
            try:
                request_body = await request.text()
            except Exception:
                request_body = None

        entry = RequestLog(
            id=req_id,
            timestamp=time.time() * 1000,
            method=request.method,
            url=url_path,
            request_headers=request_headers,
            request_body=request_body,
        )

        try:
            target_url = f"http://localhost:{self._app_port}{url_path}"
            async with self._session.request(
                method=request.method,
                url=target_url,
                headers=request_headers,
                data=request_body,
                allow_redirects=False,
            ) as resp:
                response_body = await resp.text()
                response_headers = dict(resp.headers)
                duration = (time.monotonic() - start) * 1000

                entry.status = resp.status
                entry.response_headers = response_headers
                entry.response_body = response_body
                entry.duration = round(duration, 2)

                self._push_request(entry)

                return web.Response(
                    status=resp.status,
                    headers=response_headers,
                    body=response_body,
                )
        except Exception as err:
            duration = (time.monotonic() - start) * 1000
            entry.status = 502
            entry.response_body = f"Proxy error: {err}"
            entry.duration = round(duration, 2)
            self._push_request(entry)
            return web.Response(status=502, text=entry.response_body)

    def _push_request(self, entry: RequestLog) -> None:
        self._requests.append(entry)
        if len(self._requests) > self._max_requests:
            del self._requests[: len(self._requests) - self._max_requests]
        self._on_request(entry)

    async def shutdown(self) -> None:
        if self._session:
            await self._session.close()
            self._session = None
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
