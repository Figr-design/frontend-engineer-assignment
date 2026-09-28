// Mock backend for the Figr frontend assignment. No dependencies; Node 18+.
//   API   → http://localhost:4000  (GET /screens, GET /elements/:key)
//   Pages → http://localhost:4001  (the preview pages, a different origin)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const API_PORT = Number(process.env.API_PORT || 4000);
const PAGES_PORT = Number(process.env.PAGES_PORT || 4001);
const PAGES_ORIGIN = process.env.PAGES_ORIGIN || `http://localhost:${PAGES_PORT}`;
const PAGES_DIR = path.join(__dirname, "pages");

const screens = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "screens.json"), "utf8"));
const elements = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "elements.json"), "utf8"));

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { "Content-Type": "application/json" });
}

// A failed request is either a 5xx or a 200 with a malformed body.
function sendFailure(res) {
  const kind = Math.floor(Math.random() * 3);
  if (kind === 0) return sendJson(res, 500, { error: "Internal server error" });
  if (kind === 1) return sendJson(res, 503, { error: "Service unavailable" });
  return send(res, 200, '{"component": "Butt', { "Content-Type": "application/json" });
}

const api = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });

  const url = new URL(req.url, `http://localhost:${API_PORT}`);
  const latency = Math.max(0, Number(url.searchParams.get("latency") || 0));
  const fail = Math.min(1, Math.max(0, Number(url.searchParams.get("fail") || 0)));

  setTimeout(() => {
    if (res.destroyed) return;
    if (Math.random() < fail) return sendFailure(res);

    if (url.pathname === "/screens") {
      return sendJson(
        res,
        200,
        screens.map((s) => ({ ...s, url: `${PAGES_ORIGIN}/${s.page}` })).map(({ page, ...s }) => s),
      );
    }

    const match = url.pathname.match(/^\/elements\/([^/]+)$/);
    if (match) {
      const key = decodeURIComponent(match[1]);
      const details = elements[key];
      if (!details) return sendJson(res, 404, { error: `No details for "${key}"` });
      return sendJson(res, 200, details);
    }

    sendJson(res, 404, { error: "Not found" });
  }, latency);
});

const pages = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PAGES_PORT}`);
  const name = url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^[/\\]+/, "");
  const file = path.join(PAGES_DIR, name);
  if (!file.startsWith(PAGES_DIR)) return send(res, 403, "Forbidden");

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    const type = file.endsWith(".html")
      ? "text/html; charset=utf-8"
      : file.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream";
    send(res, 200, data, { "Content-Type": type });
  });
});

api.listen(API_PORT, () => console.log(`API    → http://localhost:${API_PORT}`));
pages.listen(PAGES_PORT, () => console.log(`Pages  → http://localhost:${PAGES_PORT}`));
