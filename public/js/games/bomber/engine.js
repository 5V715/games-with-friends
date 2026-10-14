// Bomb Party: real-time arena game in the style of the classic battle mode.
//
// The host simulates the game at 60 ticks per second. Players send their
// input (direction + button press counters); the host sends a compact frame
// to everyone ~20 times per second and a full view when the phase changes.
//
// Arena: 15×13 cells including the outer wall; pillars on every second cell;
// soft blocks everywhere except the four start corners. Items hide under soft
// blocks. When the clock runs out, blocks fall in a spiral from the outside.
// A match is best of 3 rounds (first to 2 wins).

import './strings.js';
import { GameError } from '../../engine.js';

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
export const W = 15;
export const H = 13;
export const TPS = 60;
export const WINS_NEEDED = 2;

export const EMPTY = 0;
export const HARD = 1;
export const SOFT = 2;

const FUSE = 150; // 2.5 s
const FLAME_TICKS = 30;
const BURN_TICKS = 30;
const COUNTDOWN = 120;
const ROUND_TICKS = 120 * TPS; // then the hurry-up blocks start falling
const FALL_EVERY = 10;
const END_DELAY = 90; // wait a moment before declaring the winner (draws)
const RESULT_TICKS = 210;
const DISEASE_TICKS = 600;
const KICK_SPEED = 0.2; // cells per tick
const CLAIM_SLACK = 20; // ticks of movement a late position report may catch up
const CLAIM_TIMEOUT = 30; // no report for this long: simulate from input again
const BASE_SPEED = 3.2 / TPS;
const SKATE_SPEED = 0.55 / TPS;
const MAX_SKATES = 4;
const MAX_BOMBS = 8;
const MAX_FIRE = 8;

// Items. Letters are used in the frame's grid string.
export const ITEMS = {
  B: 'bomb', F: 'fire', S: 'speed', K: 'kick', R: 'remote', X: 'fullFire', D: 'skull',
};
const ITEM_POOL = { B: 10, F: 10, S: 5, K: 3, R: 2, X: 1, D: 3 };
export const DISEASES = ['slow', 'fast', 'short', 'noBomb', 'diarrhea', 'reverse'];

export const STARTS = [[1, 1], [13, 11], [13, 1], [1, 11]];
export const DIRS = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
export const REVERSE = { u: 'd', d: 'u', l: 'r', r: 'l' };

const fail = (key, params) => { throw new GameError(key, params); };
const idx = (x, y) => y * W + x;

// Spiral of all inner cells from the outside in (order of the falling blocks).
export function spiral() {
  const out = [];
  let x0 = 1, y0 = 1, x1 = W - 2, y1 = H - 2;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) out.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) out.push([x1, y]);
    if (y0 < y1) for (let x = x1 - 1; x >= x0; x--) out.push([x, y1]);
    if (x0 < x1) for (let y = y1 - 1; y > y0; y--) out.push([x0, y]);
    x0++; y0++; x1--; y1--;
  }
  return out;
}
const SPIRAL = spiral();

export function speedOf(skates, disease) {
  if (disease === 'slow') return 1.6 / TPS;
  if (disease === 'fast') return 7 / TPS;
  return BASE_SPEED + skates * SKATE_SPEED;
}

// Grid movement with automatic alignment and corner sliding. Shared by the
// host's simulation and the guest's prediction of its own player.
// `free(x, y)` says whether a cell can be entered. Returns the cell in front
// when the player stands blocked in the middle of a cell (for kicking).
export function stepPlayer(p, [dx, dy], dist, free) {
  const cx = Math.floor(p.x), cy = Math.floor(p.y);
  // Main axis a (moving), cross axis c.
  const horiz = dx !== 0;
  const s = horiz ? dx : dy;
  const a = horiz ? 'x' : 'y', c = horiz ? 'y' : 'x';
  const ca = horiz ? cx : cy, cc = horiz ? cy : cx;
  const cell = (main, cross) => (horiz ? [main, cross] : [cross, main]);
  const freeAt = (main, cross) => free(...cell(main, cross));
  const off = p[c] - (cc + 0.5);
  const centerA = ca + 0.5;
  const ahead = freeAt(ca + s, cc);
  p.moving = false;

  if (Math.abs(off) > 0.001) {
    const side = Math.sign(off);
    if (ahead) {
      // Line up with the row first, then go on.
      const m = Math.min(dist, Math.abs(off));
      p[c] -= side * m;
      dist -= m;
    } else if (Math.abs(off) > 0.18 && freeAt(ca + s, cc + side) && freeAt(ca, cc + side)) {
      // Slide around the corner of a block.
      const target = cc + side + 0.5;
      const m = Math.min(dist, Math.abs(target - p[c]));
      p[c] += side * m;
      p.moving = m > 0;
      return null;
    } else {
      const m = Math.min(dist, Math.abs(off));
      p[c] -= side * m;
      dist -= m;
      p.moving = m > 0;
    }
    if (dist <= 0) { p.moving = true; return null; }
  }

  if (ahead) {
    p[a] += s * dist;
    p.moving = true;
    return null;
  }
  // Blocked: walk up to the middle of the cell.
  const before = s > 0 ? p[a] < centerA : p[a] > centerA;
  if (before) {
    p[a] = s > 0 ? Math.min(centerA, p[a] + dist) : Math.max(centerA, p[a] - dist);
    p.moving = true;
  }
  return Math.abs(p[a] - centerA) < 0.05 ? cell(ca + s, cc) : null;
}

export function baseGrid() {
  const g = new Array(W * H).fill(EMPTY);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) g[idx(x, y)] = HARD;
    }
  }
  return g;
}

function shuffled(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class BomberGame {
  constructor({ random = Math.random } = {}) {
    this.type = 'bomber';
    this.realtime = true;
    this.rnd = random;
    this.phase = 'lobby';
    this.players = [];
    this.round = 0;
    this.gameNo = 0;
    this.history = [];
    this.votes = {};
    this.result = null;
    this.changed = false; // set when the full view must be sent again
    this.tickNo = 0; // keeps counting across rounds (frames are ordered by it)
    this.resetArena();
  }

  resetArena() {
    this.t = -COUNTDOWN; // < 0: countdown
    this.grid = baseGrid();
    this.hidden = new Map(); // cell -> item letter under a soft block
    this.items = new Map(); // cell -> item letter lying on the floor
    this.burning = new Map(); // cell -> ticks left (soft block on fire)
    this.flames = new Map(); // cell -> ticks left
    this.bombs = [];
    this.fallen = 0;
    this.endIn = null;
    this.resultIn = null;
    this.events = []; // sounds for the clients: 'boom', 'drop', 'item', 'die', 'fall'
    this.bombSeq = 0;
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') fail('err.gameStarted');
    if (this.players.length >= MAX_PLAYERS) fail('err.tableFull');
    if (this.player(id)) return this.player(id);
    const p = { id, name: String(name || 'Player').slice(0, 20), bot, wins: 0, input: { d: null }, inA: undefined, inB: undefined, fix: 0 };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    if (this.phase === 'lobby') this.players = this.players.filter(p => p.id !== id);
  }

  player(id) {
    return this.players.find(p => p.id === id);
  }

  get pendingVoters() { return []; }
  // Nobody acts in turns; bots are driven by the host's tick loop.
  get actors() { return []; }

  start() {
    if (this.players.length < MIN_PLAYERS) fail('err.minPlayers', { n: MIN_PLAYERS });
    this.gameNo++;
    this.round = 0;
    this.history = [];
    for (const p of this.players) p.wins = 0;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.result = null;
    this.phase = 'play';
    this.resetArena();
    // Soft blocks everywhere except next to the start corners.
    const safe = new Set();
    for (const [x, y] of STARTS) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) safe.add(idx(x + dx, y + dy));
    }
    const soft = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = idx(x, y);
        if (this.grid[i] === EMPTY && !safe.has(i) && this.rnd() < 0.82) {
          this.grid[i] = SOFT;
          soft.push(i);
        }
      }
    }
    const pool = [];
    for (const [k, n] of Object.entries(ITEM_POOL)) for (let j = 0; j < n; j++) pool.push(k);
    shuffled(soft, this.rnd);
    shuffled(pool, this.rnd);
    pool.slice(0, soft.length).forEach((k, j) => this.hidden.set(soft[j], k));

    this.players.forEach((p, n) => {
      const [x, y] = STARTS[n];
      Object.assign(p, {
        slot: n, x: x + 0.5, y: y + 0.5, alive: true, diedAt: null, facing: 'd', moving: false,
        bombs: 1, fire: 2, skates: 0, kick: false, remote: false, disease: null, diseaseLeft: 0,
        input: { d: null }, claim: null, budget: 0, fix: (p.fix || 0) + 1,
      });
    });
    this.changed = true;
  }

  // ---- input ---------------------------------------------------------------

  // inp: { d: 'u'|'d'|'l'|'r'|null, a: press counter, b: press counter }
  setInput(pid, inp) {
    const p = this.player(pid);
    if (!p) return;
    if (!inp) { p.input = { d: null }; return; }
    const d = DIRS[inp.d] ? inp.d : null;
    const press = (key, cur) => {
      const n = Number(inp[key]) | 0;
      const pressed = cur !== undefined && n !== cur;
      return [n, pressed];
    };
    const [a, pa] = press('a', p.inA);
    const [b, pb] = press('b', p.inB);
    p.inA = a;
    p.inB = b;
    p.input = { d, a: p.input.a || pa, b: p.input.b || pb };
    // Position from the guest's prediction (checked in the next tick).
    const x = Number(inp.x), y = Number(inp.y);
    if (inp.x != null && Number.isFinite(x) && Number.isFinite(y) && (inp.fix | 0) === p.fix) {
      p.claim = { x, y, at: this.tickNo, used: false };
    }
  }

  // Direct input for bots: { d, bomb, special }.
  steer(pid, inp) {
    const p = this.player(pid);
    if (!p) return;
    p.input = { d: DIRS[inp?.d] ? inp.d : null, a: !!inp?.bomb || !!p.input.a, b: !!inp?.special || !!p.input.b };
  }

  // After a reconnect the press counters start from zero again.
  resetInput(pid) {
    const p = this.player(pid);
    if (p) { p.inA = undefined; p.inB = undefined; p.input = { d: null }; p.claim = null; }
  }

  apply(playerId, action) {
    try {
      const p = this.player(playerId);
      if (!p) fail('err.unknownPlayer');
      if (action?.type === 'input') this.setInput(playerId, action);
      else fail('err.unknownAction');
      return { ok: true };
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      return { ok: false, error: e.message, key: e.key, params: e.params };
    }
  }

  // ---- simulation -------------------------------------------------------------

  cellAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return HARD;
    return this.grid[idx(x, y)];
  }

  bombAt(x, y) {
    return this.bombs.find(b => b.x === x && b.y === y);
  }

  // Can player p walk into cell (x, y)?
  free(x, y, p) {
    if (this.cellAt(x, y) !== EMPTY) return false;
    const b = this.bombAt(x, y);
    return !b || (p && b.passers.has(p.id));
  }

  speed(p) {
    return speedOf(p.skates, p.disease);
  }

  tick() {
    this.events = [];
    this.tickNo++;
    if (this.phase === 'roundEnd') {
      if (--this.resultIn <= 0) this.#afterRound();
      return;
    }
    if (this.phase !== 'play') return;
    this.t++;
    if (this.t <= 0) {
      for (const p of this.players) p.input = { d: p.input.d };
      return;
    }
    for (const p of this.players) if (p.alive) this.#movePlayer(p);
    this.#slideBombs();
    this.#fuses();
    this.#updateFlames();
    this.#hurryUp();
    this.#collide();
    this.#checkEnd();
  }

  #movePlayer(p) {
    let d = p.input.d;
    if (d && p.disease === 'reverse') d = REVERSE[d];
    const wantBomb = (p.input.a || p.disease === 'diarrhea') && p.disease !== 'noBomb';
    p.moving = false;
    // Budget for how far a guest's own prediction may move the player.
    p.budget = Math.min((p.budget || 0) + this.speed(p), this.speed(p) * CLAIM_SLACK);
    if (p.claim && this.tickNo - p.claim.at <= CLAIM_TIMEOUT) {
      // Predicted by the guest: take the reported position, then drop the
      // bomb there, where the guest saw its player when pressing A.
      if (d) p.facing = d;
      this.#applyClaim(p);
      if (wantBomb) this.#placeBomb(p);
      if (d && p.kick) this.#kick(p, d);
    } else {
      // The bomb goes where you stand before this tick's step.
      if (wantBomb) this.#placeBomb(p);
      if (d) {
        p.facing = d;
        const front = stepPlayer(p, DIRS[d], this.speed(p), (x, y) => this.free(x, y, p));
        if (front && p.kick) this.#kickAt(p, d, front);
      }
    }
    // Leaving a bomb's cell: from now on it blocks this player too.
    for (const b of this.bombs) {
      if (b.passers.has(p.id) && (Math.abs(p.x - b.x - 0.5) >= 0.95 || Math.abs(p.y - b.y - 0.5) >= 0.95)) b.passers.delete(p.id);
    }
    if (p.input.b) this.#special(p);
    p.input = { d: p.input.d };
    if (p.disease && --p.diseaseLeft <= 0) p.disease = null;
  }

  // A guest moves its own player locally and reports the position. Accept it
  // if it is reachable: within the speed budget, into a free neighbouring cell.
  // Otherwise keep the host's position and bump `fix`, so the guest snaps back.
  #applyClaim(p) {
    const c = p.claim;
    if (c.used) {
      // Reports come every other tick; keep the walking animation in between.
      p.moving = c.moved && this.tickNo - c.at < 4;
      return;
    }
    c.used = true;
    const dist = Math.abs(c.x - p.x) + Math.abs(c.y - p.y);
    const fx = Math.floor(p.x), fy = Math.floor(p.y);
    const tx = Math.floor(c.x), ty = Math.floor(c.y);
    const near = Math.abs(tx - fx) + Math.abs(ty - fy) <= 1;
    const ok = dist <= p.budget + 0.02 && near && ((tx === fx && ty === fy) || this.free(tx, ty, p));
    if (!ok) {
      p.fix++;
      p.claim = null;
      return;
    }
    p.moving = c.moved = dist > 0.001;
    p.budget -= dist;
    p.x = c.x;
    p.y = c.y;
  }

  // Kicking for players moved by their own prediction: standing in the middle
  // of a cell and pushing against a bomb.
  #kick(p, d) {
    const [dx, dy] = DIRS[d];
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    if (Math.abs(p.x - cx - 0.5) > 0.08 || Math.abs(p.y - cy - 0.5) > 0.08) return;
    this.#kickAt(p, d, [cx + dx, cy + dy]);
  }

  #kickAt(p, d, [bx, by]) {
    const b = this.bombAt(bx, by);
    if (!b || b.slide || b.passers.has(p.id)) return;
    b.slide = DIRS[d].slice();
    b.progress = 0;
    b.kickedBy = p.id;
    this.events.push('kick');
  }

  #placeBomb(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (this.cellAt(x, y) !== EMPTY || this.bombAt(x, y)) return;
    const own = this.bombs.filter(b => b.owner === p.id).length;
    if (own >= p.bombs) return;
    const passers = new Set();
    for (const o of this.players) {
      if (o.alive && Math.abs(o.x - x - 0.5) < 0.95 && Math.abs(o.y - y - 0.5) < 0.95) passers.add(o.id);
    }
    this.bombs.push({
      id: ++this.bombSeq, x, y, owner: p.id, fire: p.disease === 'short' ? 1 : p.fire,
      fuse: FUSE, remote: p.remote, passers, slide: null, progress: 0,
    });
    this.events.push('drop');
  }

  // B: detonate the oldest remote bomb, or stop your bomb that is sliding.
  #special(p) {
    const sliding = this.bombs.find(b => b.slide && b.kickedBy === p.id);
    if (sliding) { sliding.slide = null; sliding.progress = 0; return; }
    if (p.remote) {
      const b = this.bombs.find(b => b.owner === p.id && b.remote);
      if (b) this.#explode([b]);
    }
  }

  #slideBombs() {
    for (const b of this.bombs) {
      if (!b.slide) continue;
      const [dx, dy] = b.slide;
      if (b.progress === 0) {
        const nx = b.x + dx, ny = b.y + dy;
        const blocked = this.cellAt(nx, ny) !== EMPTY || this.bombAt(nx, ny) || this.items.has(idx(nx, ny))
          || this.players.some(o => o.alive && Math.floor(o.x) === nx && Math.floor(o.y) === ny);
        if (blocked) { b.slide = null; continue; }
      }
      b.progress += KICK_SPEED;
      if (b.progress >= 1) {
        b.x += dx; b.y += dy; b.progress = 0;
        b.passers.clear();
        if (this.flames.has(idx(b.x, b.y))) b.fuse = 1;
      }
    }
  }

  #fuses() {
    const due = [];
    for (const b of this.bombs) {
      if (b.remote) continue;
      if (--b.fuse <= 0) due.push(b);
    }
    if (due.length) this.#explode(due);
  }

  #explode(queue) {
    queue = [...queue];
    while (queue.length) {
      const b = queue.shift();
      if (!this.bombs.includes(b)) continue;
      this.bombs = this.bombs.filter(o => o !== b);
      this.events.push('boom');
      this.#flame(b.x, b.y);
      for (const [dx, dy] of Object.values(DIRS)) {
        for (let r = 1; r <= b.fire; r++) {
          const x = b.x + dx * r, y = b.y + dy * r, i = idx(x, y);
          const c = this.cellAt(x, y);
          if (c === HARD) break;
          if (c === SOFT) {
            if (!this.burning.has(i)) this.burning.set(i, BURN_TICKS);
            break;
          }
          const other = this.bombAt(x, y);
          if (other) { queue.push(other); break; }
          this.#flame(x, y);
          if (this.items.has(i)) { this.items.delete(i); break; }
        }
      }
    }
  }

  #flame(x, y) {
    this.flames.set(idx(x, y), FLAME_TICKS);
  }

  #updateFlames() {
    for (const [i, n] of this.flames) {
      if (n <= 1) this.flames.delete(i); else this.flames.set(i, n - 1);
    }
    for (const [i, n] of this.burning) {
      if (n > 1) { this.burning.set(i, n - 1); continue; }
      this.burning.delete(i);
      this.grid[i] = EMPTY;
      const item = this.hidden.get(i);
      if (item) { this.items.set(i, item); this.hidden.delete(i); }
    }
    // Bombs caught by a flame (e.g. one that was kicked into it) go off.
    const hit = this.bombs.filter(b => this.flames.has(idx(b.x, b.y)));
    if (hit.length) this.#explode(hit);
  }

  #hurryUp() {
    if (this.t < ROUND_TICKS || (this.t - ROUND_TICKS) % FALL_EVERY) return;
    while (this.fallen < SPIRAL.length) {
      const [x, y] = SPIRAL[this.fallen++];
      const i = idx(x, y);
      if (this.grid[i] === HARD) continue;
      this.grid[i] = HARD;
      this.hidden.delete(i);
      this.items.delete(i);
      this.burning.delete(i);
      this.flames.delete(i);
      this.bombs = this.bombs.filter(b => b.x !== x || b.y !== y);
      for (const p of this.players) if (p.alive && Math.floor(p.x) === x && Math.floor(p.y) === y) this.#kill(p);
      this.events.push('fall');
      return;
    }
  }

  #collide() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const i = idx(Math.floor(p.x), Math.floor(p.y));
      if (this.flames.has(i)) { this.#kill(p); continue; }
      const item = this.items.get(i);
      if (item) {
        this.items.delete(i);
        this.#pickUp(p, item);
      }
    }
    // A disease spreads to whoever you bump into.
    const alive = this.players.filter(p => p.alive);
    for (const p of alive) {
      if (!p.disease) continue;
      for (const o of alive) {
        if (o === p || o.disease) continue;
        if (Math.abs(o.x - p.x) < 0.7 && Math.abs(o.y - p.y) < 0.7) { o.disease = p.disease; o.diseaseLeft = p.diseaseLeft; }
      }
    }
  }

  #pickUp(p, item) {
    this.events.push(item === 'D' ? 'skull' : 'item');
    switch (item) {
      case 'B': p.bombs = Math.min(MAX_BOMBS, p.bombs + 1); break;
      case 'F': p.fire = Math.min(MAX_FIRE, p.fire + 1); break;
      case 'X': p.fire = MAX_FIRE; break;
      case 'S': p.skates = Math.min(MAX_SKATES, p.skates + 1); break;
      case 'K': p.kick = true; break;
      case 'R': p.remote = true; break;
      case 'D':
        p.disease = DISEASES[Math.floor(this.rnd() * DISEASES.length)];
        p.diseaseLeft = DISEASE_TICKS;
        break;
      default: break;
    }
  }

  #kill(p) {
    p.alive = false;
    p.diedAt = this.tickNo;
    p.moving = false;
    this.events.push('die');
    // Remote bombs of a fallen player go off on their own.
    for (const b of this.bombs) if (b.owner === p.id && b.remote) { b.remote = false; b.fuse = Math.min(b.fuse, FUSE); }
  }

  #checkEnd() {
    const alive = this.players.filter(p => p.alive);
    const solo = this.players.length === 1;
    const over = solo ? alive.length === 0 : alive.length <= 1;
    if (!over) return;
    if (this.endIn == null) this.endIn = END_DELAY;
    if (--this.endIn > 0) return;
    const winner = solo ? null : alive[0] || null;
    if (winner) winner.wins++;
    this.result = { winner: winner?.id || null, round: this.round };
    this.history.push({ round: this.round, winner: winner?.id || null });
    this.phase = 'roundEnd';
    this.resultIn = RESULT_TICKS;
    this.changed = true;
  }

  #afterRound() {
    const champ = this.players.find(p => p.wins >= WINS_NEEDED);
    // Practising alone ends after three rounds.
    if (champ || (this.players.length === 1 && this.round >= 3)) {
      this.phase = 'gameOver';
      this.result = { ...this.result, champion: champ?.id || null };
      this.changed = true;
      return;
    }
    this.startRound();
  }

  // ---- output ---------------------------------------------------------------

  // Compact state for drawing, sent many times per second.
  frame() {
    let grid = '';
    for (let i = 0; i < W * H; i++) {
      const c = this.grid[i];
      grid += c === HARD ? '#' : c === SOFT ? (this.burning.has(i) ? '*' : '+') : (this.items.get(i) || '.');
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      n: this.tickNo,
      t: this.t,
      left: Math.max(0, Math.ceil((ROUND_TICKS - this.t) / TPS)),
      grid,
      p: this.players.map(p => [r2(p.x), r2(p.y), p.alive ? 1 : 0, p.facing, p.moving ? 1 : 0,
        p.diedAt == null ? 0 : this.tickNo - p.diedAt, p.disease || '',
        p.bombs, p.fire, p.skates, p.kick ? 1 : 0, p.remote ? 1 : 0, p.fix]),
      b: this.bombs.map(b => [r2(b.x + (b.slide ? b.slide[0] * b.progress : 0)), r2(b.y + (b.slide ? b.slide[1] * b.progress : 0)), b.fuse, b.remote ? 1 : 0]),
      f: [...this.flames].map(([i, n]) => [i, n]),
      e: this.events,
    };
  }

  view(playerId) {
    return {
      game: 'bomber',
      you: playerId,
      phase: this.phase,
      round: this.round,
      gameNo: this.gameNo,
      winsNeeded: WINS_NEEDED,
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, wins: p.wins, slot: p.slot ?? this.players.indexOf(p), score: p.wins,
        alive: p.alive ?? true,
      })),
      hand: [],
      result: this.result,
      history: [],
      votes: {},
    };
  }
}
