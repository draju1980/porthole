"""Type definitions for porthole-sandbox."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class SandboxOptions:
    """Options for creating a sandbox instance."""

    entry: str
    """Path to the script to run."""

    command: str = ""
    """Command to run the entry script (default: auto-detected python)."""

    command_args: list[str] = field(default_factory=list)
    """Arguments to pass before the entry path (default: [])."""

    port: int = 9090
    """Port for the proxy server (default: 9090)."""

    inspector_port: int = 9099
    """Port for the inspector dashboard (default: 9099)."""

    env: dict[str, str] = field(default_factory=dict)
    """Environment variables to pass to the subprocess."""

    args: list[str] = field(default_factory=list)
    """Arguments to pass to the subprocess after the entry path."""

    inspector: bool = True
    """Enable inspector dashboard (default: True)."""

    expose: bool = True
    """Expose app via Cloudflare Quick Tunnel on create (default: True)."""


@dataclass
class RequestLog:
    """A captured HTTP request/response pair from the reverse proxy."""

    id: str
    timestamp: float
    method: str
    url: str
    request_headers: dict[str, str]
    request_body: str | None
    status: int | None = None
    response_headers: dict[str, str] | None = None
    response_body: str | None = None
    duration: float | None = None


@dataclass
class LogEntry:
    """A log entry from the sandbox subprocess or system."""

    timestamp: float
    source: Literal["stdout", "stderr", "proxy", "system"]
    message: str


@dataclass
class ProcessStats:
    """Runtime statistics for the sandbox process."""

    pid: int | None
    uptime: float
    request_count: int
    app_port: int
    proxy_port: int
    inspector_port: int | None


@dataclass
class DeployOptions:
    """Options for deploying to Cloudflare Workers."""

    account_id: str
    """Cloudflare account ID."""

    api_token: str
    """Cloudflare API token with Workers write permissions."""

    name: str | None = None
    """Worker name (default: derived from entry filename)."""
