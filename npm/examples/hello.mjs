// Simple HTTP server that porthole will sandbox
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? "3000");

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Porthole</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e4e4e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      max-width: 520px;
      padding: 2rem;
    }
    .logo {
      font-size: 3.5rem;
      margin-bottom: 0.5rem;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
    }
    .tagline {
      color: #a1a1aa;
      font-size: 1rem;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .endpoints {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 2rem;
    }
    .endpoint {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-decoration: none;
      color: #e4e4e7;
      transition: border-color 0.15s;
    }
    .endpoint:hover { border-color: #3b82f6; }
    .method {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: #1e3a5f;
      color: #60a5fa;
    }
    .method.post { background: #3b2f1a; color: #fb923c; }
    .path { font-family: "SF Mono", Monaco, Consolas, monospace; font-size: 0.9rem; }
    .desc { color: #71717a; font-size: 0.8rem; }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      color: #22c55e;
      border: 1px solid #166534;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      margin-top: 0.5rem;
    }
    .section-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #71717a;
      margin-bottom: 0.75rem;
      text-align: left;
    }
    .clocks {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      margin-bottom: 2rem;
    }
    .clock {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      text-align: left;
    }
    .clock .city {
      font-size: 0.75rem;
      color: #a1a1aa;
      margin-bottom: 0.25rem;
    }
    .clock .time {
      font-family: "SF Mono", Monaco, Consolas, monospace;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .clock .date {
      font-size: 0.7rem;
      color: #52525b;
      margin-top: 0.15rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🕳️</div>
    <h1>Porthole</h1>
    <p class="tagline">
      Deno-native sandbox runtime with HTTP inspection and Cloudflare exposure.
    </p>

    <div class="section-title">World Clock</div>
    <div class="clocks">
      <div class="clock" data-tz="America/New_York">
        <div class="city">New York</div>
        <div class="time" id="tz-ny">--:--:--</div>
        <div class="date" id="tz-ny-date"></div>
      </div>
      <div class="clock" data-tz="Europe/London">
        <div class="city">London</div>
        <div class="time" id="tz-london">--:--:--</div>
        <div class="date" id="tz-london-date"></div>
      </div>
      <div class="clock" data-tz="Asia/Kolkata">
        <div class="city">Mumbai</div>
        <div class="time" id="tz-mumbai">--:--:--</div>
        <div class="date" id="tz-mumbai-date"></div>
      </div>
      <div class="clock" data-tz="Asia/Tokyo">
        <div class="city">Tokyo</div>
        <div class="time" id="tz-tokyo">--:--:--</div>
        <div class="date" id="tz-tokyo-date"></div>
      </div>
      <div class="clock" data-tz="Australia/Sydney">
        <div class="city">Sydney</div>
        <div class="time" id="tz-sydney">--:--:--</div>
        <div class="date" id="tz-sydney-date"></div>
      </div>
      <div class="clock" data-tz="America/Los_Angeles">
        <div class="city">San Francisco</div>
        <div class="time" id="tz-sf">--:--:--</div>
        <div class="date" id="tz-sf-date"></div>
      </div>
    </div>

    <div class="section-title">API Endpoints</div>
    <div class="endpoints">
      <a class="endpoint" href="/">
        <span><span class="method">GET</span> <span class="path">/</span></span>
        <span class="desc">This page</span>
      </a>
      <a class="endpoint" href="/json">
        <span><span class="method">GET</span> <span class="path">/json</span></span>
        <span class="desc">JSON response</span>
      </a>
      <a class="endpoint" href="/echo">
        <span><span class="method post">POST</span> <span class="path">/echo</span></span>
        <span class="desc">Echo request body</span>
      </a>
    </div>
    <span class="badge">Sandbox running on ${url.host}</span>
  </div>
  <script>
    const cities = [
      { id: "tz-ny", tz: "America/New_York" },
      { id: "tz-london", tz: "Europe/London" },
      { id: "tz-mumbai", tz: "Asia/Kolkata" },
      { id: "tz-tokyo", tz: "Asia/Tokyo" },
      { id: "tz-sydney", tz: "Australia/Sydney" },
      { id: "tz-sf", tz: "America/Los_Angeles" },
    ];
    function update() {
      const now = new Date();
      for (const { id, tz } of cities) {
        const time = now.toLocaleTimeString("en-US", {
          timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
        });
        const date = now.toLocaleDateString("en-US", {
          timeZone: tz, weekday: "short", month: "short", day: "numeric"
        });
        document.getElementById(id).textContent = time;
        document.getElementById(id + "-date").textContent = date;
      }
    }
    update();
    setInterval(update, 1000);
  </script>
</body>
</html>`);
    return;
  }

  if (url.pathname === "/json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Hello!", timestamp: Date.now() }));
    return;
  }

  if (url.pathname === "/echo" && req.method === "POST") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      res.writeHead(200, { "content-type": req.headers["content-type"] ?? "text/plain" });
      res.end(body);
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
