"""Cloudflare Workers deployment."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

import aiohttp

from .types import DeployOptions


async def deploy_to_workers(entry: str, options: DeployOptions) -> str:
    script = Path(entry).read_text()
    worker_name = options.name or re.sub(r"\.\w+$", "", Path(entry).name)

    safe_account_id = quote(options.account_id, safe="")
    safe_worker_name = quote(worker_name, safe="")

    metadata = json.dumps({
        "main_module": "worker.js",
        "compatibility_date": "2024-01-01",
    })

    form = aiohttp.FormData()
    form.add_field(
        "metadata",
        metadata,
        content_type="application/json",
    )
    form.add_field(
        "worker.js",
        script,
        filename="worker.js",
        content_type="application/javascript+module",
    )

    url = f"https://api.cloudflare.com/client/v4/accounts/{safe_account_id}/workers/scripts/{safe_worker_name}"

    async with aiohttp.ClientSession() as session:
        async with session.put(
            url,
            data=form,
            headers={"Authorization": f"Bearer {options.api_token}"},
        ) as resp:
            if resp.status >= 400:
                body = await resp.text()
                raise RuntimeError(
                    f"Cloudflare Workers deploy failed ({resp.status}): {body}"
                )

        subdomain_url = f"https://api.cloudflare.com/client/v4/accounts/{safe_account_id}/workers/scripts/{safe_worker_name}/subdomain"
        async with session.post(
            subdomain_url,
            json={"enabled": True},
            headers={
                "Authorization": f"Bearer {options.api_token}",
                "Content-Type": "application/json",
            },
        ) as resp:
            pass

    return f"https://{worker_name}.<your-subdomain>.workers.dev"
