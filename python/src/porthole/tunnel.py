"""Cloudflare Quick Tunnel integration."""

from __future__ import annotations

import asyncio
import os
import platform
import re
import shutil
import stat
import subprocess
import tarfile
from pathlib import Path


CACHE_DIR = Path.home() / ".porthole" / "bin"
URL_PATTERN = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def _get_download_url() -> tuple[str, bool]:
    """Returns (url, is_archive)."""
    os_name = platform.system().lower()
    cpu = "arm64" if platform.machine() in ("arm64", "aarch64") else "amd64"

    if os_name == "darwin":
        return (
            f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-{cpu}.tgz",
            True,
        )
    if os_name == "linux":
        return (
            f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{cpu}",
            False,
        )
    if os_name == "windows":
        return (
            f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-{cpu}.exe",
            False,
        )
    raise RuntimeError(f"Unsupported platform: {os_name}/{cpu}")


def _binary_name() -> str:
    return "cloudflared.exe" if platform.system().lower() == "windows" else "cloudflared"


def _find_in_path() -> str | None:
    return shutil.which("cloudflared")


async def _download_cloudflared() -> str:
    bin_path = CACHE_DIR / _binary_name()

    if bin_path.exists():
        return str(bin_path)

    url, is_archive = _get_download_url()
    print(f"Downloading cloudflared from {url}...")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Failed to download cloudflared: {resp.status}")
            data = await resp.read()

    if is_archive:
        tmp_tgz = CACHE_DIR / "cloudflared.tgz"
        tmp_tgz.write_bytes(data)
        with tarfile.open(tmp_tgz, "r:gz") as tar:
            tar.extractall(path=CACHE_DIR)
        tmp_tgz.unlink(missing_ok=True)
    else:
        bin_path.write_bytes(data)

    if platform.system().lower() != "windows":
        bin_path.chmod(bin_path.stat().st_mode | stat.S_IEXEC)

    print(f"cloudflared cached at {bin_path}")
    return str(bin_path)


async def ensure_cloudflared() -> str:
    system_path = _find_in_path()
    if system_path:
        return system_path
    return await _download_cloudflared()


class TunnelHandle:
    def __init__(self, url: str, process: asyncio.subprocess.Process):
        self.url = url
        self._process = process

    def close(self) -> None:
        try:
            self._process.terminate()
        except ProcessLookupError:
            pass


async def open_tunnel(port: int) -> TunnelHandle:
    cloudflared_bin = await ensure_cloudflared()

    process = await asyncio.create_subprocess_exec(
        cloudflared_bin,
        "tunnel",
        "--url",
        f"http://localhost:{port}",
        "--no-autoupdate",
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    url = await _extract_tunnel_url(process.stderr)
    return TunnelHandle(url=url, process=process)


async def _extract_tunnel_url(stderr: asyncio.StreamReader) -> str:
    buffer = ""
    try:
        async with asyncio.timeout(30):
            while True:
                chunk = await stderr.read(4096)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")
                match = URL_PATTERN.search(buffer)
                if match:
                    return match.group(0)
    except asyncio.TimeoutError:
        pass
    raise RuntimeError("Failed to extract tunnel URL from cloudflared output within 30s")
