// Stacked: one player's well. Runs on that player's own device (and on the
// host for bots), so controls react instantly. Deterministic piece order:
// everyone in a round gets the same seed, so the same 7-piece bags.
//
// Rotation follows the usual "super rotation" rules with wall kicks; a T-spin
// is a T piece whose last move was a rotation and that ends with 3 of the 4
// corners around its centre blocked (both front corners for a full T-spin).

export const COLS = 10;
export const ROWS = 22; // 2 hidden rows on top
export const VISIBLE = 20;
export const PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

const SHAPES = {
  I: ['....', 'XXXX', '....', '....'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
  O: ['XX', 'XX'],
  S: ['.XX', 'XX.', '...'],
  T: ['.X.', 'XXX', '...'],
  Z: ['XX.', '.XX', '...'],
};

function rotateCW(m) {
  const n = m.length;
  return m.map((row, y) => [...row].map((_, x) => m[n - 1 - x][y]).join(''));
}

// CELLS[type][rot] = [[x, y], ...] inside the piece's box.
export const CELLS = {};
for (const [k, shape] of Object.entries(SHAPES)) {
  CELLS[k] = [];
  let m = shape;
  for (let r = 0; r < 4; r++) {
    const cells = [];
    m.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') cells.push([x, y]); }));
    CELLS[k].push(cells);
    m = rotateCW(m);
  }
}

// Wall kicks (x right, y up as usually written; flipped when used).
const KICKS = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

// Garbage sent per clear.
const CLEAR_ATTACK = [0, 0, 1, 2, 4];
const TSPIN_ATTACK = [0, 2, 4, 6];
const COMBO_ATTACK = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
const PERFECT_CLEAR = 10;

const LOCK_DELAY = 500;
const MAX_RESETS = 15;
// Falling speed in cells per second; one step up every 20 seconds.
const GRAVITY = [1, 1.3, 1.7, 2.2, 2.9, 3.8, 5, 6.5, 8.5, 11, 15, 20, 30, 45, 60];
export const LEVEL_MS = 20000;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Well {
  constructor(seed) {
    this.rnd = mulberry32(seed);
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill('.'));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.canHold = true;
    this.piece = null;
    this.pieceNo = 0;
    this.combo = -1;
    this.b2b = false;
    this.time = 0;
    this.fall = 0;
    this.lockTimer = 0;
    this.resets = 0;
    this.lastRotate = false;
    this.lastKick = 0;
    this.dead = false;
    // Garbage sent to us: entries { id, lines, gap } from the host; how much of
    // each we have used up (cancelled or taken) is tracked here.
    this.incoming = [];
    this.used = {};
    this.#fillQueue();
    this.#spawn();
  }

  #fillQueue() {
    while (this.queue.length < 6) {
      if (!this.bag.length) {
        this.bag = PIECES.slice();
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rnd() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      this.queue.push(this.bag.shift());
    }
  }

  #spawn(type = null) {
    if (!type) {
      type = this.queue.shift();
      this.#fillQueue();
    }
    this.piece = { type, rot: 0, x: type === 'O' ? 4 : 3, y: type === 'I' ? 0 : 1 };
    this.pieceNo++;
    this.fall = 0;
    this.lockTimer = 0;
    this.resets = 0;
    this.lastRotate = false;
    if (!this.fits(this.piece)) this.dead = true;
  }

  cells(p = this.piece) {
    return CELLS[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y]);
  }

  fits(p) {
    return CELLS[p.type][p.rot].every(([cx, cy]) => {
      const x = p.x + cx, y = p.y + cy;
      return x >= 0 && x < COLS && y >= 0 && y < ROWS && this.grid[y][x] === '.';
    });
  }

  get onGround() {
    return !this.fits({ ...this.piece, y: this.piece.y + 1 });
  }

  get level() {
    return Math.min(GRAVITY.length - 1, Math.floor(this.time / LEVEL_MS));
  }

  // Lines of garbage still waiting for us.
  get pending() {
    return this.incoming.reduce((s, e) => s + Math.max(0, e.lines - (this.used[e.id] || 0)), 0);
  }

  #moved() {
    this.lastRotate = false;
    this.#touch();
  }

  // Moving or rotating on the ground restarts the lock timer (a few times).
  #touch() {
    if (this.onGround && this.resets < MAX_RESETS) {
      this.lockTimer = 0;
      this.resets++;
    }
  }

  move(dx) {
    if (this.dead) return false;
    const p = { ...this.piece, x: this.piece.x + dx };
    if (!this.fits(p)) return false;
    this.piece = p;
    this.#moved();
    return true;
  }

  rotate(dir) {
    if (this.dead || this.piece.type === 'O') return false;
    const from = this.piece.rot, to = (from + (dir > 0 ? 1 : 3)) % 4;
    const table = this.piece.type === 'I' ? KICKS_I : KICKS;
    const kicks = table[`${from}>${to}`];
    for (let k = 0; k < kicks.length; k++) {
      const [dx, dy] = kicks[k];
      const p = { ...this.piece, rot: to, x: this.piece.x + dx, y: this.piece.y - dy };
      if (this.fits(p)) {
        this.piece = p;
        this.#touch();
        this.lastRotate = true;
        this.lastKick = k;
        return true;
      }
    }
    return false;
  }

  softDrop() {
    if (this.dead) return false;
    const p = { ...this.piece, y: this.piece.y + 1 };
    if (!this.fits(p)) return false;
    this.piece = p;
    this.lastRotate = false;
    this.fall = 0;
    return true;
  }

  ghostY() {
    let y = this.piece.y;
    while (this.fits({ ...this.piece, y: y + 1 })) y++;
    return y;
  }

  hardDrop() {
    if (this.dead) return null;
    const y = this.ghostY();
    if (y !== this.piece.y) this.lastRotate = false;
    this.piece = { ...this.piece, y };
    return this.lock();
  }

  holdPiece() {
    if (this.dead || !this.canHold) return false;
    const cur = this.piece.type;
    const next = this.hold;
    this.hold = cur;
    this.canHold = false;
    if (next) this.#spawn(next); else this.#spawn();
    return true;
  }

  // Advances time; returns a lock result when the piece locked by itself.
  update(ms) {
    if (this.dead) return null;
    this.time += ms;
    if (this.onGround) {
      this.lockTimer += ms;
      if (this.lockTimer >= LOCK_DELAY) return this.lock();
      return null;
    }
    this.fall += ms * GRAVITY[this.level] / 1000;
    while (this.fall >= 1) {
      this.fall -= 1;
      if (!this.softDrop()) break;
    }
    return null;
  }

  #tspin() {
    const p = this.piece;
    if (p.type !== 'T' || !this.lastRotate) return null;
    const cx = p.x + 1, cy = p.y + 1;
    const blocked = (x, y) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && this.grid[y][x] !== '.');
    // Corners: top-left, top-right, bottom-right, bottom-left.
    const c = [blocked(cx - 1, cy - 1), blocked(cx + 1, cy - 1), blocked(cx + 1, cy + 1), blocked(cx - 1, cy + 1)];
    if (c.filter(Boolean).length < 3) return null;
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
    return (c[front[0]] && c[front[1]]) || this.lastKick === 4 ? 'full' : 'mini';
  }

  // Locks the piece: clears lines, works out the attack, cancels it against
  // garbage waiting for us, and takes the rest of that garbage if nothing cleared.
  lock() {
    const tspin = this.#tspin();
    const cells = this.cells();
    for (const [x, y] of cells) this.grid[y][x] = this.piece.type;
    const lockOut = cells.every(([, y]) => y < ROWS - VISIBLE);
    const full = [];
    this.grid.forEach((row, y) => { if (row.every(c => c !== '.')) full.push(y); });
    for (const y of full) {
      this.grid.splice(y, 1);
      this.grid.unshift(new Array(COLS).fill('.'));
    }
    const lines = full.length;
    let attack = 0;
    let b2bBonus = false;
    const perfect = lines > 0 && this.grid.every(row => row.every(c => c === '.'));
    if (lines) {
      this.combo++;
      const hard = lines === 4 || tspin === 'full';
      attack = tspin === 'full' ? TSPIN_ATTACK[lines] : CLEAR_ATTACK[lines];
      if (hard && this.b2b) { attack += 1; b2bBonus = true; }
      this.b2b = hard;
      attack += COMBO_ATTACK[Math.min(this.combo, COMBO_ATTACK.length - 1)];
      if (perfect) attack += PERFECT_CLEAR;
    } else {
      this.combo = -1;
    }

    // Our attack first cancels garbage that is on its way to us.
    let sent = attack;
    for (const e of this.incoming) {
      if (!sent) break;
      const left = e.lines - (this.used[e.id] || 0);
      if (left <= 0) continue;
      const n = Math.min(left, sent);
      this.used[e.id] = (this.used[e.id] || 0) + n;
      sent -= n;
    }
    let received = 0;
    if (!lines) received = this.#takeGarbage();

    this.canHold = true;
    if (lockOut) this.dead = true;
    else this.#spawn();
    return {
      lines, attack, sent, tspin: lines || tspin ? tspin : null, combo: Math.max(0, this.combo), b2b: b2bBonus, perfect,
      received, rows: full, topOut: this.dead,
    };
  }

  #takeGarbage() {
    let total = 0;
    for (const e of this.incoming) {
      const left = e.lines - (this.used[e.id] || 0);
      if (left <= 0) continue;
      const n = Math.min(left, 12 - total);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) {
        this.grid.shift();
        const row = new Array(COLS).fill('G');
        row[e.gap % COLS] = '.';
        this.grid.push(row);
      }
      this.used[e.id] = (this.used[e.id] || 0) + n;
      total += n;
    }
    // Garbage pushing the piece into the stack moves it up.
    while (total && !this.fits(this.piece) && this.piece.y > 0) this.piece = { ...this.piece, y: this.piece.y - 1 };
    return total;
  }

  // The visible 20 rows as a string, for the small views of the others.
  board() {
    return this.grid.slice(ROWS - VISIBLE).map(r => r.join('')).join('');
  }
}

// ---- bot placement --------------------------------------------------------

function evaluate(grid) {
  const heights = new Array(COLS).fill(0);
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let seen = false;
    for (let y = 0; y < ROWS; y++) {
      if (grid[y][x] !== '.') {
        if (!seen) { heights[x] = ROWS - y; seen = true; }
      } else if (seen) holes++;
    }
  }
  const agg = heights.reduce((a, b) => a + b, 0);
  let bump = 0;
  for (let x = 0; x < COLS - 1; x++) bump += Math.abs(heights[x] - heights[x + 1]);
  return { agg, holes, bump, max: Math.max(...heights) };
}

// Best placement for the current piece: { rot, x } (or null).
// `jitter()` adds a little randomness so bots don't all play the same.
export function bestPlacement(well, jitter = () => 0) {
  let best = null;
  const type = well.piece.type;
  const rots = type === 'O' ? [0] : type === 'I' || type === 'S' || type === 'Z' ? [0, 1] : [0, 1, 2, 3];
  for (const rot of rots) {
    for (let x = -2; x < COLS; x++) {
      let p = { type, rot, x, y: well.piece.y };
      if (!well.fits(p)) { p = { ...p, y: 0 }; if (!well.fits(p)) continue; }
      while (well.fits({ ...p, y: p.y + 1 })) p.y++;
      const grid = well.grid.map(r => r.slice());
      for (const [cx, cy] of CELLS[type][rot]) grid[p.y + cy][p.x + cx] = type;
      const kept = grid.filter(r => r.some(c => c === '.'));
      const lines = ROWS - kept.length;
      while (kept.length < ROWS) kept.unshift(new Array(COLS).fill('.'));
      const f = evaluate(kept);
      const score = -0.51 * f.agg + 0.76 * lines - 0.36 * f.holes * 2 - 0.18 * f.bump - (f.max > 14 ? (f.max - 14) * 2 : 0);
      const noisy = score + jitter();
      if (!best || noisy > best.score) best = { rot, x, score: noisy };
    }
  }
  return best;
}
