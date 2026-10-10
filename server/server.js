// Rommé signaling server: a tiny WebRTC signaling relay with no dependencies.
//
// The game itself is a static site (public/, e.g. on GitHub Pages) and is NOT
// served from here. Players never send game traffic through this server
// either. It only relays the
// SDP offers/answers and ICE candidates needed to open a direct WebRTC data
// channel between the host and each guest. Signaling uses Server-Sent Events
// (server → browser) and POST requests (browser → server).
//
//   GET  /healthz                      liveness probe
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

import http from 'node:http';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 64 * 1024;
const MAX_PEERS_PER_ROOM = 8;
const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const PEER_RE = /^[A-Za-z0-9_-]{1,32}$/;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

// CORS: the page lives on another origin (GitHub Pages), so every response
// needs these headers. Returns false if the origin is not allowed.
function cors(req, res) {
  const origin = req.headers.origin;
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

// room code -> Map(peerId -> { res, role })
const rooms = new Map();

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
  if (!peers) rooms.set(room, (peers = new Map()));
  if (peers.size >= MAX_PEERS_PER_ROOM && !peers.has(peer)) {
    sendEvent(res, { from: 'server', data: { type: 'error', code: 'room-full' } });
    return res.end();
  }
  peers.get(peer)?.res.end();
  peers.set(peer, { res, role });
  sendEvent(res, { from: 'server', data: { type: 'ready' } });

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    if (peers.get(peer)?.res !== res) return;
    peers.delete(peer);
    for (const [, other] of peers) {
      sendEvent(other.res, { from: 'server', data: { type: role === 'host' ? 'host-left' : 'peer-left', peer } });
    }
    if (!peers.size) rooms.delete(room);
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
  json(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
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
  console.log(`Rommé signaling server on http://${HOST}:${PORT} (allowed origins: ${ALLOWED_ORIGINS.join(', ')})`);
});

function shutdown() {
  for (const peers of rooms.values()) for (const p of peers.values()) p.res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
