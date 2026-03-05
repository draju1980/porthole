export interface DeployOptions {
  /** Cloudflare account ID */
  accountId: string;
  /** Cloudflare API token with Workers write permissions */
  apiToken: string;
  /** Worker name (default: derived from entry filename) */
  name?: string;
}

export async function deployToWorkers(
  entry: string,
  options: DeployOptions,
): Promise<string> {
  const script = await Deno.readTextFile(entry);
  const workerName = options.name ?? entry.replace(/.*\//, "").replace(/\.\w+$/, "");

  const formData = new FormData();

  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2024-01-01",
  };

  formData.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );

  formData.append(
    "worker.js",
    new Blob([script], { type: "application/javascript+module" }),
    "worker.js",
  );

  const url = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/workers/scripts/${workerName}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare Workers deploy failed (${res.status}): ${body}`);
  }

  // Enable the workers.dev subdomain route
  const subdomainUrl = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/workers/scripts/${workerName}/subdomain`;
  await fetch(subdomainUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  });

  return `https://${workerName}.<your-subdomain>.workers.dev`;
}
