"""Example sandbox runner script."""

import asyncio
import os
import signal
from pathlib import Path

# When installed: from porthole import Sandbox, SandboxOptions
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from porthole import Sandbox, SandboxOptions


async def main():
    hello_path = str(Path(__file__).parent / "hello.py")

    sandbox = await Sandbox.create(SandboxOptions(
        entry=hello_path,
        port=9090,
        inspector_port=9099,
    ))

    print(f"Proxy:     {sandbox.url}")
    print(f"Inspector: {sandbox.inspector_url}")
    print(f"Tunnel:    {sandbox.tunnel_url or 'disabled'}")
    print("\nPress Ctrl+C to stop\n")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGINT, stop.set)

    await stop.wait()
    print("\nShutting down...")
    await sandbox.close()


asyncio.run(main())
