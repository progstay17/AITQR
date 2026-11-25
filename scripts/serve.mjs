// Preview server for dist/. Binds 0.0.0.0 so the Cloud preview can reach it.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const port = Number(process.env.PORT ?? 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// frame-ancestors is intentionally omitted here: the Cloud preview renders the app inside an iframe.
// dist/_headers carries the production policy, including frame-ancestors 'none'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

if (!existsSync(join(root, "index.html"))) {
  console.error("dist/ is empty — run `npm run build` first");
  process.exit(1);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const target = normalize(join(root, pathname));
  if (!target.startsWith(root)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  // Only extension-less routes fall back to the shell; a missing asset is a real 404, so a
  // failed `/bundles/latest.bundle.json` fetch never looks like a valid HTML response.
  const found = existsSync(target) && statSync(target).isFile();
  const file = found ? target : extname(pathname) === "" ? join(root, "index.html") : null;
  if (file === null) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`AITQR preview on http://0.0.0.0:${port} (dist/)`);
});
