// Bomber Buben computer player. Runs on the host every tick with direct access
// to the engine: builds a danger map from all bombs and flames, flees when
// standing in a blast line, otherwise collects items, blasts soft blocks and
// hunts the others — but only drops a bomb when there is a way out.

import { W, H, EMPTY, SOFT, HARD } from './engine.js';

const STEPS = [['u', 0, -1], ['d', 0, 1], ['l', -1, 0], ['r', 1, 0]];
const idx = (x, y) => y * W + x;
const BOMB_FUSE = 150;
const REMOTE_GUESS = 40; // someone else's remote bomb may go off any moment

// Ticks until a flame reaches each cell (Infinity = safe).
function dangerMap(g, extra = null) {
  const bombs = g.bombs.map(b => ({ x: b.x, y: b.y, fire: b.fire, t: b.remote ? REMOTE_GUESS : b.fuse }));
  if (extra) bombs.push(extra);
  const d = new Array(W * H).fill(Infinity);
  for (const [i] of g.flames) d[i] = 0;
  for (const [i] of g.burning) d[i] = Math.min(d[i], 0);
  // Chain reactions: a bomb inside another's blast goes off with it.
  for (let pass = 0; pass < 3; pass++) {
    for (const b of bombs) {
      for (const o of bombs) {
        if (o === b || o.t <= b.t) continue;
        if (inBlast(g, b, o.x, o.y)) o.t = b.t;
      }
    }
  }
  for (const b of bombs) {
    const mark = (x, y) => { const i = idx(x, y); d[i] = Math.min(d[i], b.t); };
    mark(b.x, b.y);
    for (const [, dx, dy] of STEPS) {
      for (let r = 1; r <= b.fire; r++) {
        const x = b.x + dx * r, y = b.y + dy * r;
        const c = g.cellAt(x, y);
        if (c === HARD || c === SOFT) break;
        mark(x, y);
        if (g.bombAt(x, y)) break;
      }
    }
  }
  return d;
}

function inBlast(g, b, x, y) {
  if (x === b.x && y === b.y) return true;
  if (x !== b.x && y !== b.y) return false;
  const dx = Math.sign(x - b.x), dy = Math.sign(y - b.y);
  const n = Math.abs(x - b.x) + Math.abs(y - b.y);
  if (n > b.fire) return false;
  for (let r = 1; r < n; r++) {
    const c = g.cellAt(b.x + dx * r, b.y + dy * r);
    if (c !== EMPTY) return false;
  }
  return true;
}

// Breadth-first search from (sx, sy). `ok(i, steps)` says whether a cell may be
// entered after that many steps. Returns { dist, first } maps.
function bfs(g, sx, sy, ok) {
  const start = idx(sx, sy);
  const dist = new Map([[start, 0]]);
  const first = new Map([[start, null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    const i = idx(x, y);
    const n = dist.get(i);
    for (const [dir, dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy, j = idx(nx, ny);
      if (dist.has(j)) continue;
      if (g.cellAt(nx, ny) !== EMPTY || g.bombAt(nx, ny)) continue;
      if (!ok(j, n + 1)) continue;
      dist.set(j, n + 1);
      first.set(j, first.get(i) ?? dir);
      q.push([nx, ny]);
    }
  }
  return { dist, first };
}

function escape(g, x, y, danger, perCell) {
  const { dist, first } = bfs(g, x, y, (j, n) => danger[j] > n * perCell + 8);
  let best = null;
  for (const [i, n] of dist) {
    if (danger[i] !== Infinity) continue;
    if (!best || n < best.n) best = { i, n };
  }
  if (!best) return null;
  return { dir: first.get(best.i), steps: best.n };
}

const memory = new WeakMap();

export function botInput(g, pid) {
  const me = g.player(pid);
  if (!me?.alive || g.phase !== 'play' || g.t <= 0) return { d: null };
  let mem = memory.get(me);
  if (!mem) memory.set(me, mem = { wait: 0, goal: null });
  const x = Math.floor(me.x), y = Math.floor(me.y), here = idx(x, y);
  const perCell = Math.ceil(1 / g.speed(me));
  const danger = dangerMap(g);
  const out = { d: null };

  // Remote bombs: set them off once we are clear of them.
  if (me.remote && g.bombs.some(b => b.owner === pid && b.remote) && danger[here] === Infinity) {
    const mine = g.bombs.filter(b => b.owner === pid && b.remote);
    if (!mine.some(b => inBlast(g, b, x, y))) out.special = true;
  }

  if (danger[here] !== Infinity) {
    const esc = escape(g, x, y, danger, perCell);
    out.d = esc?.dir || null;
    return out;
  }

  const enemies = g.players.filter(p => p.alive && p.id !== pid);
  const canBomb = g.bombs.filter(b => b.owner === pid).length < me.bombs && !g.bombAt(x, y) && me.disease !== 'noBomb';
  const fire = me.disease === 'short' ? 1 : me.fire;
  if (canBomb && mem.wait <= 0) {
    const fake = { x, y, fire, t: BOMB_FUSE };
    let worth = false;
    for (const [, dx, dy] of STEPS) {
      for (let r = 1; r <= fire; r++) {
        const cx = x + dx * r, cy = y + dy * r;
        const c = g.cellAt(cx, cy);
        if (c === HARD) break;
        if (c === SOFT) { if (!g.burning.has(idx(cx, cy))) worth = true; break; }
        if (enemies.some(p => Math.floor(p.x) === cx && Math.floor(p.y) === cy)) worth = true;
      }
    }
    if (enemies.some(p => Math.floor(p.x) === x && Math.floor(p.y) === y)) worth = true;
    if (worth) {
      const esc = escape(g, x, y, dangerMap(g, fake), perCell);
      if (esc) {
        out.bomb = true;
        out.d = esc.dir;
        mem.wait = 20 + Math.floor(Math.random() * 30);
        return out;
      }
    }
  }
  mem.wait--;

  // Walk only through cells that stay safe.
  const { dist, first } = bfs(g, x, y, (j) => danger[j] === Infinity);
  let goal = null;
  const consider = (i, score) => { if (!goal || score < goal.score) goal = { i, score }; };
  for (const [i, n] of dist) {
    if (i === here) continue;
    const item = g.items.get(i);
    if (item && item !== 'D') consider(i, n - 6);
    const cx = i % W, cy = Math.floor(i / W);
    if (canBomb) {
      for (const [, dx, dy] of STEPS) {
        if (g.cellAt(cx + dx, cy + dy) === SOFT && !g.burning.has(idx(cx + dx, cy + dy))) { consider(i, n + 1); break; }
      }
    }
    for (const p of enemies) {
      const ex = Math.floor(p.x), ey = Math.floor(p.y);
      if ((ex === cx && Math.abs(ey - cy) <= fire) || (ey === cy && Math.abs(ex - cx) <= fire)) consider(i, n + 3);
    }
  }
  if (goal) out.d = first.get(goal.i);
  else if (Math.random() < 0.05) out.d = STEPS[Math.floor(Math.random() * 4)][0];
  return out;
}
