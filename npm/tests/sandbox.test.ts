import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../src/index.js";
import type { SandboxOptions, LogEntry, RequestLog, ProcessStats, DeployOptions } from "../src/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helloPath = join(__dirname, "..", "examples", "hello.mjs");

describe("Sandbox", () => {
  it("public types are exported", () => {
    const _opts: SandboxOptions = { entry: helloPath };
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

    assert.ok(Sandbox);
    assert.equal(typeof Sandbox.create, "function");
  });

  it("Sandbox.create starts and closes cleanly", async () => {
    const sandbox = await Sandbox.create({
      entry: helloPath,
      expose: false,
      inspector: false,
      port: 18923,
    });

    try {
      assert.ok(sandbox.url);
      assert.ok(sandbox.logs);
      assert.ok(sandbox.requests);
      assert.ok(sandbox.stats);
      assert.equal(sandbox.inspectorUrl, null);
      assert.equal(sandbox.tunnelUrl, null);
      assert.equal(typeof sandbox.stats.pid, "number");
      assert.equal(sandbox.stats.requestCount, 0);

      const res = await fetch(`${sandbox.url}/json`);
      const data = await res.json();
      assert.equal(typeof data.message, "string");
      assert.equal(res.status, 200);

      assert.equal(sandbox.requests.length, 1);
      assert.equal(sandbox.requests[0].method, "GET");
      assert.equal(sandbox.requests[0].url, "/json");
      assert.equal(sandbox.requests[0].status, 200);
    } finally {
      await sandbox.close();
    }
  });

  it("GET / returns HTML page", async () => {
    const sandbox = await Sandbox.create({
      entry: helloPath,
      expose: false,
      inspector: false,
      port: 18924,
    });

    try {
      const res = await fetch(`${sandbox.url}/`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      const body = await res.text();
      assert.ok(body.includes("Porthole"));
      assert.ok(body.includes("Sandbox running on"));
    } finally {
      await sandbox.close();
    }
  });

  it("GET /json returns JSON with message and timestamp", async () => {
    const sandbox = await Sandbox.create({
      entry: helloPath,
      expose: false,
      inspector: false,
      port: 18925,
    });

    try {
      const res = await fetch(`${sandbox.url}/json`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.message, "Hello!");
      assert.equal(typeof data.timestamp, "number");
    } finally {
      await sandbox.close();
    }
  });

  it("POST /echo returns echoed body", async () => {
    const sandbox = await Sandbox.create({
      entry: helloPath,
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
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/json");
      const data = await res.json();
      assert.equal(data.hello, "world");
    } finally {
      await sandbox.close();
    }
  });

  it("GET /unknown returns 404", async () => {
    const sandbox = await Sandbox.create({
      entry: helloPath,
      expose: false,
      inspector: false,
      port: 18927,
    });

    try {
      const res = await fetch(`${sandbox.url}/unknown`);
      assert.equal(res.status, 404);
      const body = await res.text();
      assert.equal(body, "Not Found");
    } finally {
      await sandbox.close();
    }
  });

  it("multiple requests are tracked in order", async () => {
    const sandbox = await Sandbox.create({
      entry: helloPath,
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

      assert.equal(sandbox.requests.length, 4);
      assert.equal(sandbox.requests[0].method, "GET");
      assert.equal(sandbox.requests[0].url, "/json");
      assert.equal(sandbox.requests[0].status, 200);
      assert.equal(sandbox.requests[1].url, "/");
      assert.equal(sandbox.requests[1].status, 200);
      assert.equal(sandbox.requests[2].method, "POST");
      assert.equal(sandbox.requests[2].url, "/echo");
      assert.equal(sandbox.requests[2].status, 200);
      assert.equal(sandbox.requests[3].url, "/nope");
      assert.equal(sandbox.requests[3].status, 404);
      assert.equal(sandbox.stats.requestCount, 4);
    } finally {
      await sandbox.close();
    }
  });

  it("MAX_LOGS and MAX_REQUESTS are defined", () => {
    assert.equal(typeof Sandbox.MAX_LOGS, "number");
    assert.equal(typeof Sandbox.MAX_REQUESTS, "number");
    assert.equal(Sandbox.MAX_LOGS, 10_000);
    assert.equal(Sandbox.MAX_REQUESTS, 5_000);
  });
});
