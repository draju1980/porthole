import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { Sandbox } from "./mod.ts";
import type { SandboxOptions, LogEntry, RequestLog, ProcessStats, DeployOptions } from "./mod.ts";

// Verify all public types are importable
Deno.test("public types are exported", () => {
  // These just need to compile — if they do, the types are properly exported
  const _opts: SandboxOptions = { entry: "./examples/hello.ts" };
  const _log: LogEntry = { timestamp: 0, source: "stdout", message: "" };
  const _req: RequestLog = {
    id: "", timestamp: 0, method: "GET", url: "/",
    requestHeaders: {}, requestBody: null,
    status: 200, responseHeaders: {}, responseBody: "", duration: 0,
  };
  const _stats: ProcessStats = {
    pid: null, uptime: 0, requestCount: 0,
    appPort: 3000, proxyPort: 9090, inspectorPort: null,
  };
  const _deploy: DeployOptions = { accountId: "", apiToken: "" };

  assertExists(Sandbox);
  assertEquals(typeof Sandbox.create, "function");
});

Deno.test("Sandbox.create starts and closes cleanly", async () => {
  const sandbox = await Sandbox.create({
    entry: "./examples/hello.ts",
    expose: false,
    inspector: false,
    port: 18923,
  });

  try {
    assertExists(sandbox.url);
    assertExists(sandbox.logs);
    assertExists(sandbox.requests);
    assertExists(sandbox.stats);
    assertEquals(sandbox.inspectorUrl, null);
    assertEquals(sandbox.tunnelUrl, null);
    assertEquals(typeof sandbox.stats.pid, "number");
    assertEquals(sandbox.stats.requestCount, 0);

    // Hit the proxy and verify it works
    const res = await fetch(`${sandbox.url}/json`);
    const data = await res.json();
    assertEquals(typeof data.message, "string");
    assertEquals(res.status, 200);

    // Verify request was logged
    assertEquals(sandbox.requests.length, 1);
    assertEquals(sandbox.requests[0].method, "GET");
    assertEquals(sandbox.requests[0].url, "/json");
    assertEquals(sandbox.requests[0].status, 200);
  } finally {
    await sandbox.close();
  }
});

Deno.test("GET / returns HTML page", async () => {
  const sandbox = await Sandbox.create({
    entry: "./examples/hello.ts",
    expose: false,
    inspector: false,
    port: 18924,
  });

  try {
    const res = await fetch(`${sandbox.url}/`);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    const body = await res.text();
    assertStringIncludes(body, "Porthole");
    assertStringIncludes(body, "Sandbox running on");
  } finally {
    await sandbox.close();
  }
});

Deno.test("GET /json returns JSON with message and timestamp", async () => {
  const sandbox = await Sandbox.create({
    entry: "./examples/hello.ts",
    expose: false,
    inspector: false,
    port: 18925,
  });

  try {
    const res = await fetch(`${sandbox.url}/json`);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.message, "Hello!");
    assertEquals(typeof data.timestamp, "number");
  } finally {
    await sandbox.close();
  }
});

Deno.test("POST /echo returns echoed body", async () => {
  const sandbox = await Sandbox.create({
    entry: "./examples/hello.ts",
    expose: false,
    inspector: false,
    port: 18926,
  });

  try {
    const payload = JSON.stringify({ hello: "world" });
    const res = await fetch(`${sandbox.url}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    const data = await res.json();
    assertEquals(data.hello, "world");
  } finally {
    await sandbox.close();
  }
});

Deno.test("GET /unknown returns 404", async () => {
  const sandbox = await Sandbox.create({
    entry: "./examples/hello.ts",
    expose: false,
    inspector: false,
    port: 18927,
  });

  try {
    const res = await fetch(`${sandbox.url}/unknown`);
    assertEquals(res.status, 404);
    const body = await res.text();
    assertEquals(body, "Not Found");
  } finally {
    await sandbox.close();
  }
});

Deno.test("multiple requests are tracked in order", async () => {
  const sandbox = await Sandbox.create({
    entry: "./examples/hello.ts",
    expose: false,
    inspector: false,
    port: 18928,
  });

  try {
    await (await fetch(`${sandbox.url}/json`)).text();
    await (await fetch(`${sandbox.url}/`)).text();
    await (await fetch(`${sandbox.url}/echo`, {
      method: "POST",
      body: "test",
    })).text();
    await (await fetch(`${sandbox.url}/nope`)).text();

    assertEquals(sandbox.requests.length, 4);
    assertEquals(sandbox.requests[0].method, "GET");
    assertEquals(sandbox.requests[0].url, "/json");
    assertEquals(sandbox.requests[0].status, 200);
    assertEquals(sandbox.requests[1].url, "/");
    assertEquals(sandbox.requests[1].status, 200);
    assertEquals(sandbox.requests[2].method, "POST");
    assertEquals(sandbox.requests[2].url, "/echo");
    assertEquals(sandbox.requests[2].status, 200);
    assertEquals(sandbox.requests[3].url, "/nope");
    assertEquals(sandbox.requests[3].status, 404);
    assertEquals(sandbox.stats.requestCount, 4);
  } finally {
    await sandbox.close();
  }
});
