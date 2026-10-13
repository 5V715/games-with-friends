import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server/server.js', import.meta.url));

async function startServer(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env } });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('signaling server')) resolve(); });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
}

// Opens an event stream and collects the JSON events it receives.
async function openStream(base, room, peer, role) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/signal?room=${room}&peer=${peer}&role=${role}`, { signal: ctrl.signal });
  const events = [];
  const reader = res.body.getReader();
  const done = (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data: '));
          if (line) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  const waitFor = async (pred, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const e = events.find(pred);
      if (e) return e;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('timed out waiting for event; got ' + JSON.stringify(events));
  };
  await waitFor(e => e.data.type === 'ready' || e.data.type === 'error');
  return { events, waitFor, close: () => ctrl.abort(), done };
}

test('admin endpoint lists rooms only with the right token', async () => {
  const srv = await startServer({ ADMIN_TOKEN: 's3cret', ROOM_IDLE_MINUTES: '0' });
  try {
    const host = await openStream(srv.base, 'ABCD1', 'host', 'host');
    const guest = await openStream(srv.base, 'ABCD1', 'g1', 'guest');
    assert.equal((await fetch(`${srv.base}/admin/rooms`)).status, 401);
    assert.equal((await fetch(`${srv.base}/admin/rooms?token=wrong`)).status, 401);
    const res = await fetch(`${srv.base}/admin/rooms`, { headers: { Authorization: 'Bearer s3cret' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rooms.length, 1);
    assert.equal(body.rooms[0].room, 'ABCD1');
    assert.equal(body.rooms[0].players, 2);
    assert.equal(body.rooms[0].hostConnected, true);
    assert.equal(body.rooms[0].expiresInMinutes, null);
    const viaQuery = await fetch(`${srv.base}/admin/rooms?token=s3cret`);
    assert.equal(viaQuery.status, 200);
    host.close();
    guest.close();
  } finally {
    srv.stop();
  }
});

test('admin endpoint is off without ADMIN_TOKEN', async () => {
  const srv = await startServer({ ADMIN_TOKEN: '' });
  try {
    assert.equal((await fetch(`${srv.base}/admin/rooms?token=`)).status, 404);
    const health = await (await fetch(`${srv.base}/healthz`)).json();
    assert.equal(health.rooms, 0);
  } finally {
    srv.stop();
  }
});

test('idle rooms expire and peers are told why', async () => {
  // 0.02 min = 1.2 s idle timeout
  const srv = await startServer({ ADMIN_TOKEN: 't', ROOM_IDLE_MINUTES: '0.02' });
  try {
    const host = await openStream(srv.base, 'IDLE1', 'host', 'host');
    const guest = await openStream(srv.base, 'IDLE1', 'g1', 'guest');
    await host.waitFor(e => e.data.code === 'room-expired', 6000);
    await guest.waitFor(e => e.data.code === 'room-expired', 1000);
    const body = await (await fetch(`${srv.base}/admin/rooms?token=t`)).json();
    assert.equal(body.rooms.length, 0);
    assert.equal((await (await fetch(`${srv.base}/healthz`)).json()).rooms, 0);
  } finally {
    srv.stop();
  }
});

test('signaling activity keeps a room alive', async () => {
  const srv = await startServer({ ADMIN_TOKEN: 't', ROOM_IDLE_MINUTES: '0.03' }); // 1.8 s
  try {
    const host = await openStream(srv.base, 'BUSY1', 'host', 'host');
    await openStream(srv.base, 'BUSY1', 'g1', 'guest');
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const r = await fetch(`${srv.base}/api/signal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: 'BUSY1', from: 'g1', to: 'host', data: { type: 'hello' } }),
      });
      assert.equal(r.status, 200);
    }
    assert.ok(!host.events.some(e => e.data.code === 'room-expired'), 'room stayed open for 3 s of activity');
    const body = await (await fetch(`${srv.base}/admin/rooms?token=t`)).json();
    assert.equal(body.rooms.length, 1);
  } finally {
    srv.stop();
  }
});
