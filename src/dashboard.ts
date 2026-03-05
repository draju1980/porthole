export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Porthole Inspector</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0d1117; color: #c9d1d9; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 20px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 16px; color: #58a6ff; }
  .stats { font-size: 12px; color: #8b949e; display: flex; gap: 16px; }
  .stats span { color: #c9d1d9; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; display: inline-block; }
  .status-dot.disconnected { background: #f85149; }
  main { display: grid; grid-template-columns: 1fr 1fr; height: calc(100vh - 49px); }
  .panel { border-right: 1px solid #30363d; display: flex; flex-direction: column; overflow: hidden; }
  .panel:last-child { border-right: none; }
  .panel-header { background: #161b22; padding: 8px 16px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
  .panel-header button { background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .panel-header button:hover { color: #c9d1d9; border-color: #58a6ff; }
  .panel-body { flex: 1; overflow-y: auto; padding: 0; }
  .log-entry { padding: 4px 16px; font-size: 12px; line-height: 1.6; border-bottom: 1px solid #21262d; font-family: "SF Mono", "Fira Code", monospace; }
  .log-entry:hover { background: #161b22; }
  .log-time { color: #484f58; margin-right: 8px; }
  .log-source { display: inline-block; width: 50px; font-weight: 600; }
  .log-source.stdout { color: #3fb950; }
  .log-source.stderr { color: #f85149; }
  .log-source.proxy { color: #d2a8ff; }
  .log-source.system { color: #58a6ff; }
  .req-entry { padding: 10px 16px; border-bottom: 1px solid #21262d; cursor: pointer; font-size: 12px; }
  .req-entry:hover { background: #161b22; }
  .req-entry.selected { background: #1f2937; border-left: 2px solid #58a6ff; }
  .req-method { font-weight: 700; display: inline-block; width: 50px; }
  .req-method.GET { color: #3fb950; }
  .req-method.POST { color: #d29922; }
  .req-method.PUT { color: #58a6ff; }
  .req-method.DELETE { color: #f85149; }
  .req-method.PATCH { color: #d2a8ff; }
  .req-status { float: right; font-weight: 600; }
  .req-status.s2xx { color: #3fb950; }
  .req-status.s3xx { color: #d29922; }
  .req-status.s4xx { color: #f85149; }
  .req-status.s5xx { color: #f85149; }
  .req-url { color: #8b949e; margin-left: 4px; }
  .req-duration { color: #484f58; font-size: 11px; float: right; margin-right: 12px; }
  .detail-overlay { display: none; position: fixed; top: 49px; right: 0; width: 50%; height: calc(100vh - 49px); background: #0d1117; border-left: 1px solid #30363d; z-index: 10; overflow-y: auto; }
  .detail-overlay.open { display: block; }
  .detail-section { padding: 12px 16px; border-bottom: 1px solid #21262d; }
  .detail-section h3 { font-size: 12px; color: #58a6ff; margin-bottom: 8px; }
  .detail-section pre { font-size: 11px; color: #c9d1d9; white-space: pre-wrap; word-break: break-all; font-family: "SF Mono", "Fira Code", monospace; background: #161b22; padding: 8px; border-radius: 4px; max-height: 300px; overflow-y: auto; }
  .detail-close { position: absolute; top: 8px; right: 16px; background: none; border: none; color: #8b949e; font-size: 18px; cursor: pointer; }
  .empty { color: #484f58; text-align: center; padding: 40px; font-size: 13px; }
</style>
</head>
<body>
<header>
  <div class="status-dot" id="statusDot"></div>
  <h1>Porthole Inspector</h1>
  <div class="stats">
    PID: <span id="pid">-</span>
    Uptime: <span id="uptime">-</span>
    Requests: <span id="reqCount">0</span>
  </div>
</header>
<main>
  <div class="panel">
    <div class="panel-header">Logs <button id="clearLogs">Clear</button></div>
    <div class="panel-body" id="logs"><div class="empty">Waiting for logs...</div></div>
  </div>
  <div class="panel">
    <div class="panel-header">HTTP Requests <button id="clearReqs">Clear</button></div>
    <div class="panel-body" id="requests"><div class="empty">No requests yet</div></div>
  </div>
</main>
<div class="detail-overlay" id="detail">
  <button class="detail-close" id="detailClose">&times;</button>
  <div class="detail-section"><h3>Request</h3><pre id="detailReq"></pre></div>
  <div class="detail-section"><h3>Request Headers</h3><pre id="detailReqHeaders"></pre></div>
  <div class="detail-section"><h3>Request Body</h3><pre id="detailReqBody"></pre></div>
  <div class="detail-section"><h3>Response</h3><pre id="detailRes"></pre></div>
  <div class="detail-section"><h3>Response Headers</h3><pre id="detailResHeaders"></pre></div>
  <div class="detail-section"><h3>Response Body</h3><pre id="detailResBody"></pre></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
const logsEl = $("logs");
const reqsEl = $("requests");
let allRequests = [];
let ws;

function connect() {
  ws = new WebSocket("ws://" + location.host);
  $("statusDot").className = "status-dot";

  ws.onopen = () => { $("statusDot").className = "status-dot"; };
  ws.onclose = () => { $("statusDot").className = "status-dot disconnected"; setTimeout(connect, 2000); };
  ws.onerror = () => { ws.close(); };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "init") {
      logsEl.innerHTML = "";
      reqsEl.innerHTML = "";
      allRequests = [];
      msg.data.logs.forEach(addLog);
      msg.data.requests.forEach(addRequest);
      updateStats(msg.data.stats);
    } else if (msg.type === "log") {
      addLog(msg.data);
    } else if (msg.type === "request") {
      addRequest(msg.data);
    } else if (msg.type === "pong") {
      updateStats(msg.data.stats);
    }
  };
}

function addLog(entry) {
  if (logsEl.querySelector(".empty")) logsEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "log-entry";
  const time = new Date(entry.timestamp).toLocaleTimeString();
  div.innerHTML = '<span class="log-time">' + time + '</span><span class="log-source ' + entry.source + '">' + entry.source + '</span> ' + escapeHtml(entry.message);
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function addRequest(req) {
  if (reqsEl.querySelector(".empty")) reqsEl.innerHTML = "";
  allRequests.push(req);
  const div = document.createElement("div");
  div.className = "req-entry";
  const statusClass = req.status ? "s" + Math.floor(req.status / 100) + "xx" : "";
  const safeMethod = escapeHtml(req.method);
  div.innerHTML = '<span class="req-method ' + safeMethod + '">' + safeMethod + '</span>'
    + '<span class="req-url">' + escapeHtml(req.url) + '</span>'
    + (req.status ? '<span class="req-status ' + statusClass + '">' + req.status + '</span>' : '')
    + (req.duration != null ? '<span class="req-duration">' + req.duration + 'ms</span>' : '');
  div.onclick = () => showDetail(req);
  reqsEl.appendChild(div);
  reqsEl.scrollTop = reqsEl.scrollHeight;
  $("reqCount").textContent = allRequests.length;
}

function showDetail(req) {
  $("detailReq").textContent = req.method + " " + req.url;
  $("detailReqHeaders").textContent = JSON.stringify(req.requestHeaders, null, 2);
  $("detailReqBody").textContent = req.requestBody || "(empty)";
  $("detailRes").textContent = "Status: " + (req.status || "pending") + (req.duration != null ? "  (" + req.duration + "ms)" : "");
  $("detailResHeaders").textContent = req.responseHeaders ? JSON.stringify(req.responseHeaders, null, 2) : "(none)";
  $("detailResBody").textContent = req.responseBody || "(empty)";
  $("detail").className = "detail-overlay open";
}

function updateStats(stats) {
  if (!stats) return;
  $("pid").textContent = stats.pid || "-";
  const s = Math.floor(stats.uptime / 1000);
  $("uptime").textContent = Math.floor(s/60) + "m " + (s%60) + "s";
  $("reqCount").textContent = stats.requestCount;
}

function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

$("clearLogs").onclick = () => { logsEl.innerHTML = '<div class="empty">Logs cleared</div>'; };
$("clearReqs").onclick = () => { reqsEl.innerHTML = '<div class="empty">Requests cleared</div>'; allRequests = []; };
$("detailClose").onclick = () => { $("detail").className = "detail-overlay"; };

connect();
setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:"ping"})); }, 5000);
</script>
</body>
</html>`;
}
