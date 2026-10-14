#!/usr/bin/env node
// Serves the HydroFLASH app and relays its requests to the controller, which
// sends no CORS headers and so can't be used directly from a page hosted
// elsewhere.
//
//   HYDROFLASH_HOST  controller address (default 10.0.1.172)
//   PORT             port to listen on   (default 3000)
//   HYDROFLASH_AUTH  optional "user:password". When set, the server signs in
//                    to the controller itself and nobody using the app is
//                    asked for a password, so only set it on a trusted network.
//
// These can also be set in a .env file next to this script.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env file: use the environment and the defaults.
}

const DEVICE = `http://${process.env.HYDROFLASH_HOST || '10.0.1.172'}`;
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTH = process.env.HYDROFLASH_AUTH ? `Basic ${Buffer.from(process.env.HYDROFLASH_AUTH).toString('base64')}` : '';
const MAX_UPLOAD = 48 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// The status dashboard's two sources need no password and are briefly cached.
const SOURCES = {
  '/api/status.xml': { path: '/FS/RAM0/status.xml', type: 'text/xml; charset=utf-8', ttl: 2_000 },
  '/api/page': { path: '/index.htm', type: 'text/html; charset=utf-8', ttl: 60_000 },
};

// The controller's embedded web server is small, so requests to it are made
// one at a time and briefly cached; any number of open dashboards share them.
const cache = new Map();
let queue = Promise.resolve();

function fetchDevice(source) {
  const hit = cache.get(source.path);
  if (hit && (hit.pending || Date.now() - hit.at < source.ttl)) return hit.pending || Promise.resolve(hit.body);

  const pending = (queue = queue.catch(() => {}).then(async () => {
    const res = await fetch(DEVICE + source.path, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`controller answered ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }));
  cache.set(source.path, { pending });
  pending.then(
    (body) => cache.set(source.path, { body, at: Date.now() }),
    () => cache.delete(source.path),
  );
  return pending;
}

function send(res, status, type, body, extra) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) return reject(new Error('upload too large'));
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Relays /device/<path> to the controller's password-protected pages and
// forms. The controller's password travels in the Authorization header the
// app sends (or comes from HYDROFLASH_AUTH); it is never stored here.
async function relay(req, res, url) {
  // A custom header can't be sent by another site's form or script, so this
  // keeps other web pages from driving the controller through this server.
  if (req.method === 'POST' && req.headers['x-hydroflash'] !== '1') return send(res, 403, 'text/plain', 'Forbidden');

  const headers = {};
  const authorization = AUTH || req.headers.authorization;
  if (authorization) headers.Authorization = authorization;
  let body;
  if (req.method === 'POST') {
    body = await readBody(req);
    headers['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
  }

  const target = DEVICE + url.pathname.slice('/device'.length) + url.search;
  const answer = (queue = queue.catch(() => {}).then(() =>
    fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      // Firmware and link updates can keep the controller busy for minutes.
      signal: AbortSignal.timeout(req.method === 'POST' ? 300_000 : 20_000),
    }),
  ));
  const deviceRes = await answer;
  const extra = {};
  const location = deviceRes.headers.get('location');
  if (location) {
    // The controller answers forms with a redirect; hand the app the page to show next.
    const next = new URL(location, target);
    extra['X-Device-Location'] = next.pathname + next.search;
  }
  const status = location ? 200 : deviceRes.status;
  send(res, status, deviceRes.headers.get('content-type') || 'application/octet-stream', Buffer.from(await deviceRes.arrayBuffer()), extra);
}

function serveStatic(pathname, res) {
  const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', body);
  });
}

http
  .createServer(async (req, res) => {
    let url, pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'text/plain', 'Bad request');
    }

    if (pathname.startsWith('/device/') && (req.method === 'GET' || req.method === 'POST')) {
      return relay(req, res, url).catch((err) => send(res, 502, 'text/plain', `Controller unreachable: ${err.message}`));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');

    if (pathname === '/api/config') return send(res, 200, MIME['.json'], JSON.stringify({ device: DEVICE, signedIn: Boolean(AUTH) }));

    const source = SOURCES[pathname];
    if (!source) return serveStatic(pathname, res);
    try {
      send(res, 200, source.type, await fetchDevice(source));
    } catch (err) {
      send(res, 502, 'text/plain', `Controller unreachable: ${err.message}`);
    }
  })
  .listen(PORT, () => {
    console.log(`HydroFLASH dashboard: http://localhost:${PORT}  (controller: ${DEVICE})`);
  });
