"""Tests for porthole-sandbox."""

import asyncio
import os
from pathlib import Path

import pytest
import aiohttp

from porthole import Sandbox, SandboxOptions, LogEntry, RequestLog, ProcessStats, DeployOptions


HELLO_PATH = str(Path(__file__).parent.parent / "examples" / "hello.py")


@pytest.fixture
async def sandbox_factory():
    """Factory fixture that tracks sandboxes for cleanup."""
    sandboxes = []

    def _create(**kwargs):
        return kwargs

    async def _make(port: int, **kwargs) -> Sandbox:
        sb = await Sandbox.create(SandboxOptions(
            entry=HELLO_PATH,
            expose=False,
            inspector=False,
            port=port,
            **kwargs,
        ))
        sandboxes.append(sb)
        return sb

    yield _make

    for sb in sandboxes:
        await sb.close()


class TestSandbox:
    @pytest.mark.asyncio
    async def test_public_types_are_exported(self):
        opts = SandboxOptions(entry=HELLO_PATH)
        log = LogEntry(timestamp=0, source="stdout", message="")
        req = RequestLog(
            id="", timestamp=0, method="GET", url="/",
            request_headers={}, request_body=None,
            status=200, response_headers={}, response_body="", duration=0,
        )
        stats = ProcessStats(
            pid=None, uptime=0, request_count=0,
            app_port=3000, proxy_port=9090, inspector_port=None,
        )
        deploy = DeployOptions(account_id="", api_token="")

        assert Sandbox is not None
        assert callable(Sandbox.create)

    @pytest.mark.asyncio
    async def test_create_and_close(self, sandbox_factory):
        sandbox = await sandbox_factory(port=18950)

        assert sandbox.url
        assert sandbox.logs is not None
        assert sandbox.requests is not None
        assert sandbox.stats is not None
        assert sandbox.inspector_url is None
        assert sandbox.tunnel_url is None
        assert isinstance(sandbox.stats.pid, int)
        assert sandbox.stats.request_count == 0

        async with aiohttp.ClientSession() as session:
            async with session.get(f"{sandbox.url}/json") as resp:
                data = await resp.json()
                assert isinstance(data["message"], str)
                assert resp.status == 200

        assert len(sandbox.requests) == 1
        assert sandbox.requests[0].method == "GET"
        assert sandbox.requests[0].url == "/json"
        assert sandbox.requests[0].status == 200

    @pytest.mark.asyncio
    async def test_get_root_returns_html(self, sandbox_factory):
        sandbox = await sandbox_factory(port=18951)

        async with aiohttp.ClientSession() as session:
            async with session.get(f"{sandbox.url}/") as resp:
                assert resp.status == 200
                body = await resp.text()
                assert "Porthole" in body

    @pytest.mark.asyncio
    async def test_get_json(self, sandbox_factory):
        sandbox = await sandbox_factory(port=18952)

        async with aiohttp.ClientSession() as session:
            async with session.get(f"{sandbox.url}/json") as resp:
                assert resp.status == 200
                data = await resp.json()
                assert data["message"] == "Hello!"
                assert isinstance(data["timestamp"], int)

    @pytest.mark.asyncio
    async def test_post_echo(self, sandbox_factory):
        sandbox = await sandbox_factory(port=18953)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{sandbox.url}/echo",
                json={"hello": "world"},
            ) as resp:
                assert resp.status == 200
                data = await resp.json()
                assert data["hello"] == "world"

    @pytest.mark.asyncio
    async def test_404(self, sandbox_factory):
        sandbox = await sandbox_factory(port=18954)

        async with aiohttp.ClientSession() as session:
            async with session.get(f"{sandbox.url}/unknown") as resp:
                assert resp.status == 404
                body = await resp.text()
                assert body == "Not Found"

    @pytest.mark.asyncio
    async def test_multiple_requests_tracked(self, sandbox_factory):
        sandbox = await sandbox_factory(port=18955)

        async with aiohttp.ClientSession() as session:
            await (await session.get(f"{sandbox.url}/json")).read()
            await (await session.get(f"{sandbox.url}/")).read()
            await (await session.post(f"{sandbox.url}/echo", data=b"test")).read()
            await (await session.get(f"{sandbox.url}/nope")).read()

        assert len(sandbox.requests) == 4
        assert sandbox.requests[0].method == "GET"
        assert sandbox.requests[0].url == "/json"
        assert sandbox.requests[0].status == 200
        assert sandbox.requests[1].url == "/"
        assert sandbox.requests[1].status == 200
        assert sandbox.requests[2].method == "POST"
        assert sandbox.requests[2].url == "/echo"
        assert sandbox.requests[2].status == 200
        assert sandbox.requests[3].url == "/nope"
        assert sandbox.requests[3].status == 404
        assert sandbox.stats.request_count == 4

    @pytest.mark.asyncio
    async def test_max_logs_and_requests_defined(self):
        assert isinstance(Sandbox.MAX_LOGS, int)
        assert isinstance(Sandbox.MAX_REQUESTS, int)
        assert Sandbox.MAX_LOGS == 10_000
        assert Sandbox.MAX_REQUESTS == 5_000
