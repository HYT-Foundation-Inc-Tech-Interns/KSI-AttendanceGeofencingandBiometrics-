#!/usr/bin/env node
/*
 * Minimal static file server for the dashboard's Next.js export.
 *
 * The export is a plain directory tree (`dashboard/out`), so testing it on a
 * phone needs nothing more than a file server -- but the route files Next
 * emits are directory-index shaped (`checkin/index.html`), and a bare
 * `http.server` would 404 on `/checkin` because it never appends `index.html`.
 * This resolves those, plus the `path.html` variants, and serves the export's
 * `404.html` when nothing matches.
 *
 * Zero dependencies on purpose: it has to run with just Node, offline.
 *
 *   node scripts/serve-static.mjs [--dir dashboard/out] [--port 4000] [--host 0.0.0.0]
 *
 * Binding 0.0.0.0 lets a phone on the same Wi-Fi reach it directly. Over the
 * internet the camera and geolocation APIs need a secure context, so the
 * check-in page must be reached through an HTTPS tunnel rather than the LAN
 * address.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function parseArgs(argv) {
  const args = { dir: "dashboard/out", port: 4000, host: "0.0.0.0" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--dir" && value) args.dir = value;
    else if (key === "--port" && value) args.port = Number(value);
    else if (key === "--host" && value) args.host = value;
  }
  return args;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/*
 * Resolve a URL path to a file on disk, in the order Next's export expects:
 * exact file, then `dir/index.html`, then `dir.html`.
 */
async function resolveTarget(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  // normalize() collapses `..` so a crafted path cannot escape the root.
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(join(root, relative));

  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  if (await isFile(candidate)) return candidate;

  const asIndex = join(candidate, "index.html");
  if (await isFile(asIndex)) return asIndex;

  const asHtml = `${candidate}.html`;
  if (await isFile(asHtml)) return asHtml;

  return null;
}

function send(res, status, filePath, extraHeaders = {}) {
  const headers = {
    "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  createReadStream(filePath).pipe(res);
}

const { dir, port, host } = parseArgs(process.argv.slice(2));
const root = resolve(dir);

if (!(await stat(root).catch(() => null))) {
  console.error(`[serve-static] directory not found: ${root}`);
  console.error("[serve-static] build the export first: cd dashboard && npx next build");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  let target = null;

  try {
    target = await resolveTarget(root, req.url ?? "/");
  } catch (error) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Bad request: ${error.message}`);
    console.log(`${req.method} ${req.url} -> 400`);
    return;
  }

  if (target) {
    // Next emits content-hashed filenames under /_next/static, so those are
    // safe to cache hard; everything else stays no-store while testing.
    const immutable = req.url?.startsWith("/_next/static/") ?? false;
    send(res, 200, target, immutable ? { "Cache-Control": "public, max-age=31536000, immutable" } : { "Cache-Control": "no-store" });
    console.log(`${req.method} ${req.url} -> 200 (${Date.now() - started}ms)`);
    return;
  }

  const notFound = join(root, "404.html");
  if (await isFile(notFound)) {
    send(res, 404, notFound, { "Cache-Control": "no-store" });
    console.log(`${req.method} ${req.url} -> 404`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
  console.log(`${req.method} ${req.url} -> 404`);
});

server.listen(port, host, () => {
  console.log(`[serve-static] serving ${root}`);
  console.log(`[serve-static] http://localhost:${port}  (bound ${host}:${port})`);
});
