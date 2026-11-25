import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import app from "../server/app.js";
import { SqliteDatabase } from "./sqlite-adapter.mjs";

const root = resolve(process.env.AITQR_APP_DIR ?? process.cwd(), "dist");
const dataDir = resolve(process.env.AITQR_DATA_DIR ?? join(process.cwd(), "data"));
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const maxBodyBytes = Number(process.env.AITQR_MAX_BODY_BYTES ?? 2 * 1024 * 1024);

if (!existsSync(join(root, "index.html"))) {
  throw new Error("Frontend build tidak ditemukan. Jalankan npm run build terlebih dahulu.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT tidak valid.");
process.umask(0o077);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);

const dbPath = join(dataDir, "aitqr.sqlite");
const sqlite = new DatabaseSync(dbPath);
chmodSync(dbPath, 0o600);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
const DB = new SqliteDatabase(sqlite);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function assetResponse(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { ...securityHeaders, "Cache-Control": "no-cache", ...headers },
  });
}

const ASSETS = {
  async fetch(request) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return assetResponse(400, "Bad request");
    }

    if (pathname === "/") pathname = "/index.html";
    else if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";

    let file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) return assetResponse(403, "Forbidden");
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(pathname) !== "") return assetResponse(404, "Not found");
      file = join(root, "index.html");
    }

    try {
      const content = readFileSync(file);
      return assetResponse(200, content, {
        "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      });
    } catch {
      return assetResponse(404, "Not found");
    }
  },
};

const env = {
  ASSETS,
  DB,
  APP_ORIGIN: process.env.APP_ORIGIN ?? `http://localhost:${port}`,
  AITQR_ADMIN_KEY: process.env.AITQR_ADMIN_KEY,
  AITQR_SESSION_KEY: process.env.AITQR_SESSION_KEY,
  AITQR_SETUP_CODE: process.env.AITQR_SETUP_CODE,
  AITQR_PBKDF2_ITERATIONS: process.env.AITQR_PBKDF2_ITERATIONS,
  AITQR_VAULT_MASTER_KEY: process.env.AITQR_VAULT_MASTER_KEY,
};

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > maxBodyBytes) throw Object.assign(new Error("Request body too large"), { status: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(buffer);
  }
  return total ? Buffer.concat(chunks) : undefined;
}

async function handle(request, response) {
  try {
    const forwardedProto = headerValue(request.headers["x-forwarded-proto"]);
    const protocol = forwardedProto?.split(",")[0]?.trim() || (request.socket.encrypted ? "https" : "http");
    const forwardedHost = headerValue(request.headers["x-forwarded-host"]);
    const hostHeader = forwardedHost?.split(",")[0]?.trim() || headerValue(request.headers.host) || `${host}:${port}`;
    const url = new URL(request.url ?? "/", `${protocol}://${hostHeader}`);
    const headers = new Headers();
    for (const [name, raw] of Object.entries(request.headers)) {
      if (raw === undefined || ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"].includes(name.toLowerCase())) continue;
      headers.set(name, Array.isArray(raw) ? raw.join(", ") : raw);
    }

    const body = await readBody(request);
    const webRequest = new Request(url, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
    });
    const result = await app.fetch(webRequest, env);
    const responseHeaders = {};
    for (const [name, value] of result.headers) responseHeaders[name] = value;
    const cookies = result.headers.getSetCookie?.() ?? [];
    if (cookies.length) responseHeaders["Set-Cookie"] = cookies;
    const responseBody = result.status === 204 || result.status === 304 || request.method === "HEAD"
      ? undefined
      : Buffer.from(await result.arrayBuffer());
    response.writeHead(result.status, responseHeaders);
    response.end(responseBody);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("AITQR request failed:", error);
    if (!response.headersSent) {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...securityHeaders,
      });
    }
    response.end(JSON.stringify({ error: status === 500 ? "Internal server error" : error.message }));
  }
}

const server = createServer((request, response) => {
  void handle(request, response);
});

server.listen(port, host, () => {
  console.log(`AITQR Node.js + SQLite listening on http://${host}:${port}`);
  console.log(`SQLite database: ${dbPath}`);
  console.log(`Application origin: ${env.APP_ORIGIN}`);
  if (!env.AITQR_SESSION_KEY) console.warn("AITQR_SESSION_KEY belum disetel.");
  if (!env.AITQR_ADMIN_KEY) console.warn("AITQR_ADMIN_KEY belum disetel.");
  if (!env.AITQR_SETUP_CODE) console.warn("AITQR_SETUP_CODE belum disetel (bootstrap admin belum tersedia).");
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down AITQR.`);
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
