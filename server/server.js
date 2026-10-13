// Rommé signaling server: a tiny WebRTC signaling relay with no dependencies.
//
// The game itself is a static site (public/). It can live on GitHub Pages,
// or this server serves it too (SERVE_GAME, on by default when the files are
// there, e.g. in the container image). Players never send game traffic
// through this server. It only relays the
// SDP offers/answers and ICE candidates needed to open a direct WebRTC data
// channel between the host and each guest. Signaling uses Server-Sent Events
// (server → browser) and POST requests (browser → server).
//
//   GET  /healthz                      liveness probe (number of rooms only)
//   GET  /admin/rooms                  list all rooms (needs ADMIN_TOKEN)
//   GET  /, /js/…, /css/…              the game itself (when SERVE_GAME is on)
//   GET  /api/ice                      ICE server list (STUN/TURN) for clients
//   GET  /api/signal?room=&peer=&role= event stream for one peer in a room
//   POST /api/signal                   { room, from, to, data } relay a message
//
// Environment:
//   PORT          listen port (default 8080)
//   HOST          listen address (default 0.0.0.0)
//   ALLOWED_ORIGINS  comma separated origins allowed to use the server, e.g.
//                 https://you.github.io (default * = any origin)
//   ICE_SERVERS   JSON array of RTCIceServer objects, replaces the defaults
//   TURN_URL, TURN_USERNAME, TURN_CREDENTIAL   add a TURN server
//   ADMIN_TOKEN   enables GET /admin/rooms; send it as "Authorization: Bearer
//                 <token>" or ?token=<token>. Unset = admin endpoint disabled.
//   SERVE_GAME    serve the game's static files (default: on if found)
//   PUBLIC_DIR    where they are (default: ./public next to server.js, or ../public)
//   ROOM_IDLE_MINUTES  close rooms without signaling activity (joins, offers,
//                 ICE candidates) for this long (default 120, 0 = never).
//                 Games already running are not affected: they talk directly.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR)
  : [path.join(HERE, 'public'), path.join(HERE, '..', 'public')].find(d => fs.existsSync(path.join(d, 'index.html'))) || '';
const SERVE_GAME = process.env.SERVE_GAME !== 'false' && !!PUBLIC_DIR && fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 64 * 1024;
const MAX_PEERS_PER_ROOM = 8;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ROOM_IDLE_MS = (process.env.ROOM_IDLE_MINUTES != null && process.env.ROOM_IDLE_MINUTES !== ''
  ? Number(process.env.ROOM_IDLE_MINUTES) : 120) * 60000;
const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const PEER_RE = /^[A-Za-z0-9_-]{1,32}$/;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

// CORS: the page lives on another origin (GitHub Pages), so every response
// needs these headers. Returns false if the origin is not allowed.
function cors(req, res) {
  const origin = req.headers.origin;
  // The game served by this very server is always allowed.
  if (origin && SERVE_GAME) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* bad origin */ }
    if (host && (host === req.headers.host || host === req.headers['x-forwarded-host'])) {
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      return true;
    }
  }
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return true;
  }
  res.setHeader('Vary', 'Origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return !origin && req.method === 'GET';
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}

function iceServers() {
  let servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.ICE_SERVERS) {
    try { servers = JSON.parse(process.env.ICE_SERVERS); } catch { console.warn('ICE_SERVERS is not valid JSON, using defaults'); }
  }
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

// room code -> Map(peerId -> { res, role, joinedAt })
const rooms = new Map();
// room code -> { createdAt, lastActivity } (timestamps in ms)
const roomInfo = new Map();

function touch(room) {
  const info = roomInfo.get(room);
  if (info) info.lastActivity = Date.now();
}

function sendEvent(res, data) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Closes a room: tells every peer why, then ends their streams.
function closeRoom(room, code) {
  const peers = rooms.get(room);
  rooms.delete(room);
  roomInfo.delete(room);
  if (!peers) return;
  for (const p of peers.values()) {
    sendEvent(p.res, { from: 'server', data: { type: 'error', code } });
    p.res.end();
  }
  peers.clear();
}

function sweepIdleRooms() {
  if (!(ROOM_IDLE_MS > 0)) return;
  const now = Date.now();
  for (const [room, info] of roomInfo) {
    if (now - info.lastActivity > ROOM_IDLE_MS) {
      console.log(`room ${room} closed after ${Math.round((now - info.lastActivity) / 60000)} min without activity`);
      closeRoom(room, 'room-expired');
    }
  }
}
if (ROOM_IDLE_MS > 0) setInterval(sweepIdleRooms, Math.min(60000, Math.max(1000, ROOM_IDLE_MS / 4))).unref();

function adminAuthorized(req, url) {
  if (!ADMIN_TOKEN) return false;
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : (url.searchParams.get('token') || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

function listRooms() {
  const now = Date.now();
  return [...rooms].map(([room, peers]) => {
    const info = roomInfo.get(room) || { createdAt: now, lastActivity: now };
    return {
      room,
      players: peers.size,
      hostConnected: [...peers.values()].some(p => p.role === 'host'),
      createdAt: new Date(info.createdAt).toISOString(),
      lastActivity: new Date(info.lastActivity).toISOString(),
      ageMinutes: Math.round((now - info.createdAt) / 60000),
      idleMinutes: Math.round((now - info.lastActivity) / 60000),
      expiresInMinutes: ROOM_IDLE_MS > 0 ? Math.max(0, Math.round((info.lastActivity + ROOM_IDLE_MS - now) / 60000)) : null,
    };
  }).sort((x, y) => (x.lastActivity < y.lastActivity ? 1 : -1));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function openStream(req, res, url) {
  const room = url.searchParams.get('room') || '';
  const peer = url.searchParams.get('peer') || '';
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
  if (!ROOM_RE.test(room) || !PEER_RE.test(peer)) return json(res, 400, { error: 'bad room or peer id' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let peers = rooms.get(room);
  const host = peers && [...peers.values()].find(p => p.role === 'host');
  if (role === 'host' && host && !peers.has(peer)) {
    sendEvent(res, { from: 'server', data: { type: 'error', code: 'room-taken' } });
    return res.end();
  }
  if (role === 'guest' && !host) {
    sendEvent(res, { from: 'server', data: { type: 'error', code: 'no-host' } });
    return res.end();
  }
  if (!peers) {
    rooms.set(room, (peers = new Map()));
    roomInfo.set(room, { createdAt: Date.now(), lastActivity: Date.now() });
  }
  if (peers.size >= MAX_PEERS_PER_ROOM && !peers.has(peer)) {
    sendEvent(res, { from: 'server', data: { type: 'error', code: 'room-full' } });
    return res.end();
  }
  peers.get(peer)?.res.end();
  peers.set(peer, { res, role, joinedAt: Date.now() });
  touch(room);
  sendEvent(res, { from: 'server', data: { type: 'ready' } });

  const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    if (peers.get(peer)?.res !== res) return;
    peers.delete(peer);
    for (const [, other] of peers) {
      sendEvent(other.res, { from: 'server', data: { type: role === 'host' ? 'host-left' : 'peer-left', peer } });
    }
    if (!peers.size) {
      rooms.delete(room);
      roomInfo.delete(room);
    }
  });
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function relay(req, res) {
  let msg;
  try { msg = await readBody(req); } catch { return json(res, 400, { error: 'bad request' }); }
  const { room, from, to, data } = msg || {};
  const peers = rooms.get(room);
  if (!peers || !peers.has(from)) return json(res, 403, { error: 'not in room' });
  let target = peers.get(to);
  if (to === 'host') target = [...peers.values()].find(p => p.role === 'host');
  if (!target) return json(res, 404, { error: 'peer not found' });
  sendEvent(target.res, { from, data });
  touch(room);
  json(res, 200, { ok: true });
}

function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'bad path' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, body) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
  if (url.pathname === '/admin/rooms' && req.method === 'GET') {
    if (!ADMIN_TOKEN) return json(res, 404, { error: 'not found' });
    if (!adminAuthorized(req, url)) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { rooms: listRooms(), idleMinutes: ROOM_IDLE_MS > 0 ? ROOM_IDLE_MS / 60000 : null });
  }
  const isApi = url.pathname.startsWith('/api/');
  if (!isApi && SERVE_GAME && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res, url);
  if (!cors(req, res)) return json(res, 403, { error: 'origin not allowed' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }
  if (url.pathname === '/api/ice' && req.method === 'GET') return json(res, 200, { iceServers: iceServers() });
  if (url.pathname === '/api/signal' && req.method === 'GET') return openStream(req, res, url);
  if (url.pathname === '/api/signal' && req.method === 'POST') return relay(req, res);
  if (url.pathname === '/') return json(res, 200, { service: 'romme-signaling' });
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Rommé signaling server on http://${HOST}:${PORT} (allowed origins: ${ALLOWED_ORIGINS.join(', ')}; ` +
    `room idle timeout: ${ROOM_IDLE_MS > 0 ? ROOM_IDLE_MS / 60000 + ' min' : 'off'}; admin: ${ADMIN_TOKEN ? 'on' : 'off'}; ` +
    `game: ${SERVE_GAME ? 'served from ' + PUBLIC_DIR : 'not served'})`);
});

function shutdown() {
  for (const room of [...rooms.keys()]) closeRoom(room, 'server-restart');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
