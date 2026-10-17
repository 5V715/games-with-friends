// Bomber Buben screen: canvas arena with our own pixel art, a HUD, an on-screen
// D-pad with A/B buttons (plus keyboard), and overlays for countdown and results.
//
// Frames come from the host ~20×/s (60×/s on the host itself); positions are
// interpolated between the last two frames so movement stays smooth.
//
// A guest predicts its own player: it runs the same movement code locally at
// 60 Hz, draws itself at that position right away and reports it to the host,
// which checks it. If the host disagrees (the `fix` counter changes) the guest
// snaps back to the host's position.

import { W, H, ITEMS, TPS, DIRS, REVERSE, stepPlayer, speedOf } from './engine.js';
import { esc } from '../../ui-kit.js';

const T = 16; // pixels per cell in the sprites
const S = 4; // canvas pixels per sprite pixel
const CELL = T * S;

const COLORS = [
  { c: '#f4f4f8', d: '#b9bccb' }, // white
  { c: '#ee4b3e', d: '#a8281f' }, // red
  { c: '#3f86f0', d: '#2453a8' }, // blue
  { c: '#f6c936', d: '#b88b12' }, // yellow
];
export const PLAYER_COLORS = COLORS.map(c => c.c);

// ---- sprites ---------------------------------------------------------------

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Paints a pixel map (array of strings) into a canvas scaled by S.
function paint(rows, palette) {
  const c = canvas(rows[0].length * S, rows.length * S);
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = palette[ch];
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * S, y * S, S, S);
    });
  });
  return c;
}

const mirror = (half) => half.map(r => r + [...r].reverse().join(''));

// Our bomber: a round robot with a dark visor and glowing eyes.
const BODY = mirror([
  '........',
  '....oooo',
  '...occcc',
  '..occccc',
  '..occccc',
  '.ocvvvvv',
  '.ocvvvvv',
  '.ocvvvvv',
  '.occvvvv',
  '..occccc',
  '...ooddd',
  '...odddd',
  '..oddddd',
  '...odddd',
  '...offo.',
  '...ooo..',
]);

function withPixels(rows, pixels) {
  const out = rows.map(r => [...r]);
  for (const [x, y, ch] of pixels) out[y][x] = ch;
  return out.map(r => r.join(''));
}

function playerRows(facing, step) {
  let rows = BODY;
  const eyes = { d: [4, 5, 10, 11], l: [3, 4, 8, 9], r: [6, 7, 11, 12] }[facing];
  if (eyes) rows = withPixels(rows, eyes.flatMap(x => [[x, 6, 'w'], [x, 7, 'w']]));
  else rows = withPixels(rows, [5, 6, 7, 8].flatMap(y => [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(x => [x, y, 'c'])));
  // Highlight on the head.
  rows = withPixels(rows, [[5, 2, 'l'], [6, 2, 'l'], [4, 3, 'l']]);
  if (step) {
    // Walking: one foot up, the other down.
    const left = step === 1;
    rows = withPixels(rows, left
      ? [[4, 14, 'o'], [3, 14, '.'], [4, 15, '.'], [5, 15, '.'], [3, 15, '.'], [3, 13, 'o']]
      : [[11, 14, 'o'], [12, 14, '.'], [10, 15, '.'], [11, 15, '.'], [12, 15, '.'], [12, 13, 'o']]);
  }
  return rows;
}

const BOMB = withPixels(mirror([
  '........',
  '........',
  '........',
  '......oo',
  '....oooo',
  '...okkkk',
  '..okkkkk',
  '.okkkkkk',
  '.okkkkkk',
  '.okkkkkk',
  '.okkkkkk',
  '..okkkkk',
  '...okkkk',
  '....oooo',
  '........',
  '........',
]), [[4, 6, 'h'], [5, 6, 'h'], [3, 7, 'h'], [4, 7, 'h'], [3, 8, 'h'], [9, 2, 'u'], [10, 1, 'u']]);

// Item icons, 12×12. k outline, w white, r red, o orange, y yellow, b blue,
// c light blue, d dark grey, g grey, p pink.
const ITEM_PAL = { k: '#16131c', w: '#ffffff', r: '#e8433a', o: '#ff9a2e', y: '#ffd84a', b: '#3a7bf0', c: '#8fe8ff', d: '#3a3f4e', g: '#9aa3b5', p: '#ff7ab8' };
const ITEM_ART = {
  B: { bg: '#ffe08a', plus: true, map: ['............', '.......y....', '......o.....', '.....kk.....', '...kkkkkk...', '..kkwwkkkk..', '..kwwkkkkk..', '..kkkkkkkk..', '..kkkkkkkk..', '...kkkkkk...', '....kkkk....', '............'] },
  F: { bg: '#ffd0a0', plus: true, map: ['.....r......', '....rr......', '....ror.....', '...roor..r..', '...rooor.rr.', '..rooyoorrr.', '..royyyoor..', '..royyyyor..', '..royywyor..', '...ryyyyr...', '....rrrr....', '............'] },
  X: { bg: '#e8433a', map: ['.....b......', '....bb......', '....bcb.....', '...bccb..b..', '...bcccb.bb.', '..bccwccbbb.', '..bcwwwccb..', '..bcwwwwcb..', '..bcwwwwcb..', '...bwwwwb...', '....bbbb....', '............'] },
  S: { bg: '#ffd3e6', map: ['............', '...kkkk.....', '...kppk.....', '...kppk.....', '...kppkkk...', '...kpppppk..', '..kpppppppk.', '..kkkkkkkkk.', '...kgk.kgk..', '...kkk.kkk..', '............', '............'] },
  K: { bg: '#cfe0ff', map: ['..kkkk......', '..kbbk......', '..kbbk......', '..kbbk......', '..kbbkkkk...', '..kbbbbbbk..', '.kbbbbbbbbk.', '.kwwwwwwwwk.', '.kkkkkkkkkk.', '............', '............', '............'] },
  R: { bg: '#ffd9b0', map: ['.......k....', '.......k....', '......krk...', '...kkkkkkk..', '...kddddk...', '...kdrrdk...', '...kdrrdk...', '...kddddk...', '...kdggdk...', '...kkkkkk...', '............', '............'] },
  D: { bg: '#e4d4f5', map: ['...kkkkkk...', '..kwwwwwwk..', '.kwwwwwwwwk.', '.kwkkwwkkwk.', '.kwkkwwkkwk.', '.kwwwkkwwwk.', '..kwwwwwwk..', '...kwkwkk...', '...kkkkkk...', '............', '............', '............'] },
  P: { bg: '#ffc9c4', map: ['....kkkkk...', '...krrrrrk..', '..krrwrrrrk.', '..krrrrrrrk.', '..krrrrrrrk.', '..kkrrrrrrk.', '.krkkrrrrk..', '.krrrkkkk...', '..kwwwwk....', '..kwwwwk....', '..kkkkkk....', '............'] },
  G: { bg: '#fff2b0', map: ['..k.k.k.....', '.kykykyk....', '.kykykyk.k..', '.kykykykyk..', '.kyyyyyyyk..', '.kyyyyyyk...', '..kyyyyyk...', '...kwwwk....', '...kwwwk....', '...kkkkk....', '............', '............'] },
};

function buildSprites() {
  const sp = { players: [] };
  const base = { o: '#11131d', v: '#1b2240', w: '#7ff3ff', f: '#2d2218', l: '#ffffff' };
  COLORS.forEach((col, n) => {
    const pal = { ...base, c: col.c, d: col.d, l: n === 0 ? '#ffffff' : 'rgba(255,255,255,.65)' };
    const set = {};
    for (const f of ['d', 'u', 'l', 'r']) set[f] = [0, 1, 2].map(s => paint(playerRows(f, s), pal));
    sp.players.push(set);
  });
  const bombPal = { o: '#0b0b12', k: '#262a3a', h: '#6c7596', u: '#8a6136' };
  sp.bomb = paint(BOMB, bombPal);
  sp.remote = paint(BOMB, { ...bombPal, k: '#3a1d24', h: '#a0505e' });

  // Floor: two shades of green with a few tufts.
  sp.floor = canvas(CELL, CELL);
  let g = sp.floor.getContext('2d');
  g.fillStyle = '#3f8f3a';
  g.fillRect(0, 0, CELL, CELL);
  g.fillStyle = '#4a9c43';
  g.fillRect(S, S, CELL - 2 * S, CELL - 2 * S);
  g.fillStyle = '#5aae4f';
  for (const [x, y] of [[3, 4], [4, 3], [11, 9], [12, 10], [7, 13]]) g.fillRect(x * S, y * S, S, S);

  // Pillar: stone block with bevel.
  const block = (top, mid, dark, inner) => {
    const c = canvas(CELL, CELL);
    const b = c.getContext('2d');
    b.fillStyle = dark; b.fillRect(0, 0, CELL, CELL);
    b.fillStyle = top; b.fillRect(0, 0, CELL - S, CELL - S);
    b.fillStyle = mid; b.fillRect(S, S, CELL - 3 * S, CELL - 3 * S);
    b.fillStyle = inner; b.fillRect(4 * S, 4 * S, CELL - 9 * S, CELL - 9 * S);
    return c;
  };
  sp.pillar = block('#e1e4ea', '#a9afba', '#555b68', '#bfc4cd');
  sp.wall = block('#9aa3b5', '#6f7890', '#363b4a', '#7d869c');

  // Soft block: bricks.
  sp.soft = canvas(CELL, CELL);
  g = sp.soft.getContext('2d');
  g.fillStyle = '#7a3c1a';
  g.fillRect(0, 0, CELL, CELL);
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? 4 : 0;
    for (let c = -1; c < 3; c++) {
      const x = (c * 8 + off) * S;
      g.fillStyle = '#c8763b';
      g.fillRect(x + S, (r * 4) * S + S, 7 * S, 3 * S);
      g.fillStyle = '#e39a5d';
      g.fillRect(x + S, (r * 4) * S + S, 7 * S, S);
    }
  }

  // Items: pixel-art chips (a coloured token with a 12×12 icon).
  sp.items = {};
  sp.itemUrls = {};
  const P = 5, ox = (CELL - 12 * P) / 2;
  for (const k of Object.keys(ITEMS)) {
    const it = ITEM_ART[k];
    const c = canvas(CELL, CELL);
    const g = c.getContext('2d');
    g.fillStyle = '#16131c'; g.fillRect(ox - 1, ox - 1, 12 * P + 2, 12 * P + 2);
    g.fillStyle = it.bg; g.fillRect(ox + 2, ox + 2, 12 * P - 4, 12 * P - 4);
    g.fillStyle = '#ffffff55'; g.fillRect(ox + 2, ox + 2, 12 * P - 4, 4);
    it.map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!ITEM_PAL[ch]) return;
      g.fillStyle = ITEM_PAL[ch];
      g.fillRect(ox + x * P, ox + y * P + 2, P, P);
    }));
    if (it.plus) {
      const at = [[9, 0], [9, 1], [9, 2], [8, 1], [10, 1]];
      g.fillStyle = '#16131c'; at.forEach(([x, y]) => g.fillRect(ox + x * P - 1, ox + y * P - 1, P + 2, P + 2));
      g.fillStyle = '#ffffff'; at.forEach(([x, y]) => g.fillRect(ox + x * P, ox + y * P, P, P));
    }
    sp.items[k] = c;
    sp.itemUrls[k] = c.toDataURL();
  }
  return sp;
}

// ---- sound -------------------------------------------------------------------

function createSound() {
  let ac = null;
  const ctx = () => {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  const tone = (type, f0, f1, dur, vol) => {
    const a = ctx();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  };
  const noise = (dur, vol) => {
    const a = ctx();
    if (!a) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = a.createBufferSource();
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = a.createGain();
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  };
  return {
    unlock: () => ctx(),
    play(ev) {
      if (ev === 'boom') noise(0.45, 0.7);
      else if (ev === 'drop') tone('square', 320, 180, 0.07, 0.08);
      else if (ev === 'item') { tone('square', 660, 990, 0.08, 0.07); setTimeout(() => tone('square', 990, 1320, 0.08, 0.06), 70); }
      else if (ev === 'skull') tone('sawtooth', 300, 80, 0.4, 0.08);
      else if (ev === 'die') tone('triangle', 600, 60, 0.6, 0.15);
      else if (ev === 'kick') tone('square', 200, 120, 0.05, 0.08);
      else if (ev === 'fall') tone('square', 140, 90, 0.05, 0.05);
      else if (ev === 'punch' || ev === 'throw') tone('sawtooth', 260, 520, 0.12, 0.07);
      else if (ev === 'grab') tone('square', 300, 420, 0.06, 0.06);
      else if (ev === 'land') tone('triangle', 160, 90, 0.08, 0.1);
      else if (ev === 'bonk') { tone('square', 900, 300, 0.15, 0.08); setTimeout(() => tone('square', 700, 250, 0.12, 0.06), 90); }
    },
  };
}

// ---- screen ----------------------------------------------------------------------

export function createBomberUI(ctx) {
  const { els, t, input } = ctx;
  let view = null;
  let root = null;
  let cv, g2, hud, overlay, sprites;
  let prev = null, cur = null, curAt = 0, interval = 50;
  let raf = 0;
  const sound = createSound();
  const keys = new Set();
  const state = { d: null, a: 0, b: 0 };
  let padDir = null;
  let lastSent = '';

  // Own player as predicted locally (guests only).
  const me = { x: 0, y: 0, facing: 'd', moving: false, fix: -1, on: false, pass: new Set() };
  let simAt = 0, simTicks = 0;
  try {
    if (localStorage.getItem('bomber.debug')) window.bomberDebug = { me, frame: () => cur, view: () => view };
  } catch { /* storage blocked */ }

  // ---- input ----
  function payload() {
    return me.on ? { ...state, x: Math.round(me.x * 1000) / 1000, y: Math.round(me.y * 1000) / 1000, fix: me.fix } : { ...state };
  }

  function send() {
    const order = [...keys].reverse();
    const keyDir = order.find(k => ['u', 'd', 'l', 'r'].includes(k)) || null;
    state.d = padDir || keyDir;
    const key = `${state.d}|${state.a}|${state.b}`;
    if (key === lastSent) return;
    lastSent = key;
    if (me.on) simulate(performance.now()); // move up to now before reporting
    input(payload());
  }

  // ---- prediction ----
  const myIndex = () => (view ? view.players.findIndex(p => p.id === view.you) : -1);
  const cellKey = (x, y) => x + ',' + y;
  const overlaps = (bx, by) => Math.abs(me.x - bx - 0.5) < 0.95 && Math.abs(me.y - by - 0.5) < 0.95;

  function canPredict(f) {
    const i = myIndex();
    return !ctx.isHost() && view?.phase === 'play' && f && f.t > 0 && i >= 0 && f.p[i]?.[2] === 1;
  }

  // New frame: start, keep or correct the prediction.
  function reconcile(f, old) {
    if (!canPredict(f)) { me.on = false; return; }
    const s = f.p[myIndex()];
    const far = Math.abs(s[0] - me.x) + Math.abs(s[1] - me.y) > 3;
    if (!me.on || s[12] !== me.fix || far) {
      me.x = s[0];
      me.y = s[1];
      me.facing = s[3] || 'd';
      me.fix = s[12];
      me.pass = new Set(f.b.filter(b => !b[4] && overlaps(Math.round(b[0]), Math.round(b[1]))).map(b => cellKey(Math.round(b[0]), Math.round(b[1]))));
      simAt = performance.now();
      me.on = true;
      return;
    }
    // A bomb that appears under us (usually our own) can be walked off.
    const before = new Set((old?.b || []).map(b => cellKey(Math.round(b[0]), Math.round(b[1]))));
    for (const b of f.b) {
      if (b[4]) continue; // flying or carried
      const bx = Math.round(b[0]), by = Math.round(b[1]);
      if (!before.has(cellKey(bx, by)) && overlaps(bx, by)) me.pass.add(cellKey(bx, by));
    }
  }

  function freeCell(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const ch = cur.grid[y * W + x];
    if (ch === '#' || ch === '+' || ch === '*') return false;
    const key = cellKey(x, y);
    if (me.pass.has(key)) return true;
    return !cur.b.some(b => !b[4] && Math.round(b[0]) === x && Math.round(b[1]) === y);
  }

  function simulate(now) {
    if (!me.on) return;
    const steps = Math.min(10, Math.floor((now - simAt) / (1000 / TPS)));
    if (steps <= 0) return;
    simAt += steps * (1000 / TPS);
    if (now - simAt > 200) simAt = now;
    const s = cur.p[myIndex()];
    const disease = s[6], skates = s[9], dazed = s[15];
    for (let n = 0; n < steps; n++) {
      let d = dazed ? null : state.d;
      if (d && disease === 'reverse') d = REVERSE[d];
      me.moving = false;
      if (d) {
        me.facing = d;
        stepPlayer(me, DIRS[d], speedOf(skates, disease), freeCell);
      }
      for (const key of [...me.pass]) {
        const [bx, by] = key.split(',').map(Number);
        if (!overlaps(bx, by)) me.pass.delete(key);
      }
      // Report the position every other tick.
      if (++simTicks % 2 === 0) input(payload());
    }
  }

  function press(btn) {
    state[btn]++;
    sound.unlock();
    ctx.buzz?.(8);
    send();
  }

  const KEYMAP = {
    ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
  };
  function onKey(e) {
    if (!active() || e.repeat && !KEYMAP[e.code]) return;
    if (document.querySelector('dialog[open]')) return;
    const dir = KEYMAP[e.code];
    if (dir) {
      e.preventDefault();
      if (e.type === 'keydown') { keys.delete(dir); keys.add(dir); } else keys.delete(dir);
      send();
      return;
    }
    if (e.type !== 'keydown' || e.repeat) return;
    if (e.code === 'Space' || e.code === 'KeyK' || e.code === 'Enter') { e.preventDefault(); press('a'); }
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyJ') { e.preventDefault(); press('b'); }
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => { keys.clear(); padDir = null; send(); });

  function bindPad(pad) {
    let pid = null;
    const update = (e) => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dead = r.width * 0.12;
      let d = null;
      if (Math.hypot(dx, dy) > dead) d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
      if (d !== padDir && d) ctx.buzz?.(5);
      padDir = d;
      pad.dataset.dir = d || '';
      send();
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      try { pad.setPointerCapture(pid); } catch { /* ignore */ }
      sound.unlock();
      update(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) update(e); });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      padDir = null;
      pad.dataset.dir = '';
      send();
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bindButton(btn, which) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('down');
      press(which);
    });
    const up = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function build() {
    els.main.innerHTML = '';
    root = document.createElement('div');
    root.className = 'bomber';
    root.innerHTML = `
      <div class="bm-hud"></div>
      <div class="bm-pad" aria-label="D-pad"><span class="bm-arrow u">▲</span><span class="bm-arrow l">◀</span><span class="bm-arrow r">▶</span><span class="bm-arrow d">▼</span></div>
      <div class="bm-stage"><canvas width="${W * CELL}" height="${H * CELL}"></canvas><div class="bm-overlay"></div></div>
      <div class="bm-btns" data-ptt-slot>
        <button class="bm-btn b" aria-label="B"><span>B</span><small>${esc(t('bomber.b'))}</small></button>
        <button class="bm-btn a" aria-label="A"><span>A</span><small>${esc(t('bomber.a'))}</small></button>
      </div>
      <div class="bm-rotate"><div class="bm-phone">📱</div><p>${esc(t('bomber.rotate'))}</p></div>`;
    els.main.append(root);
    cv = root.querySelector('canvas');
    g2 = cv.getContext('2d');
    g2.imageSmoothingEnabled = false;
    hud = root.querySelector('.bm-hud');
    overlay = root.querySelector('.bm-overlay');
    bindPad(root.querySelector('.bm-pad'));
    bindButton(root.querySelector('.bm-btn.a'), 'a');
    bindButton(root.querySelector('.bm-btn.b'), 'b');
    sprites ||= buildSprites();
  }

  function active() {
    return root?.isConnected && root.closest('.screen.active');
  }

  // ---- frames ----
  function frame(f) {
    if (cur && f.n <= cur.n) return;
    const now = performance.now();
    if (cur) {
      const gap = now - curAt;
      if (gap > 4 && gap < 250) interval = interval * 0.85 + gap * 0.15;
    }
    prev = cur;
    cur = f;
    curAt = now;
    reconcile(f, prev);
    for (const ev of f.e || []) sound.play(ev);
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function lerp(a, b, k) { return a + (b - a) * k; }

  function draw() {
    raf = 0;
    if (!active() || !cur) return;
    raf = requestAnimationFrame(draw);
    simulate(performance.now());
    const k = prev ? Math.min(1, (performance.now() - curAt) / interval) : 1;
    const f = cur;
    const g = g2;
    g.imageSmoothingEnabled = false;

    // Arena.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = f.grid[y * W + x];
        const px = x * CELL, py = y * CELL;
        if (ch === '#') {
          g.drawImage(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? sprites.wall : sprites.pillar, px, py);
          continue;
        }
        g.drawImage(sprites.floor, px, py);
        // Shadow under the block above.
        const above = f.grid[(y - 1) * W + x];
        if (above === '#' || above === '+' || above === '*') {
          g.fillStyle = 'rgba(0,0,0,.28)';
          g.fillRect(px, py, CELL, 3 * S);
        }
        if (ch === '+') g.drawImage(sprites.soft, px, py);
        else if (ch === '*') drawBurning(px, py, f.n);
        else if (sprites.items[ch]) g.drawImage(sprites.items[ch], px, py);
      }
    }

    // Bombs (interpolated while sliding or flying; flying ones higher, with a shadow).
    const prevBombs = prev?.b || [];
    const lifted = [];
    for (const b of f.b) {
      const old = prevBombs.find(o => Math.abs(o[0] - b[0]) <= 1 && Math.abs(o[1] - b[1]) <= 1);
      const h = b[4] || 0;
      const x0 = old ? lerp(old[0], b[0], k) : b[0];
      const y0 = old ? lerp(old[1], b[1], k) : b[1];
      // A flying bomb crossing the arena edge shows on both sides at once.
      const spots = [[x0, y0]];
      if (h && !b[5]) {
        if (x0 > W - 2) spots.push([x0 - (W - 2), y0]);
        if (y0 > H - 2) spots.push([x0, y0 - (H - 2)]);
      }
      for (const [bx, sy] of spots) {
        let by = sy;
        if (h) {
          g.fillStyle = 'rgba(0,0,0,.3)';
          g.beginPath();
          g.ellipse(bx * CELL + CELL / 2, by * CELL + CELL * 0.82, CELL * 0.3 * (1 - h * 0.4), CELL * 0.1, 0, 0, Math.PI * 2);
          g.fill();
          by -= h * 0.9;
          // Carried bombs are drawn after the players, above their heads.
          if (b[5]) { lifted.push([b, bx, by]); continue; }
        }
        drawBomb(g, b, bx, by, f);
      }
    }

    drawFlames(f);

    // Players (draw lower ones last so they overlap correctly).
    const order = f.p.map((p, i) => i).sort((a, b) => f.p[a][1] - f.p[b][1]);
    for (const i of order) {
      const p = f.p[i];
      const o = prev?.p?.[i];
      let [x, y, alive, facing, moving, deadFor] = p;
      if (!alive && deadFor > 70) continue;
      let px = o && Math.abs(o[0] - x) < 1.5 && Math.abs(o[1] - y) < 1.5 ? lerp(o[0], x, k) : x;
      let py = o && Math.abs(o[0] - x) < 1.5 && Math.abs(o[1] - y) < 1.5 ? lerp(o[1], y, k) : y;
      if (me.on && i === myIndex()) {
        px = me.x; py = me.y; facing = me.facing; moving = me.moving;
      }
      const step = moving ? 1 + ((f.n >> 3) % 2) : 0;
      const slot = view?.players?.[i]?.slot ?? i;
      const img = sprites.players[slot % 4][facing || 'd'][step];
      const dx = px * CELL - CELL / 2, dy = py * CELL - CELL / 2 - 4 * S;
      g.save();
      if (!alive) {
        g.globalAlpha = Math.max(0, 1 - deadFor / 70);
        if ((deadFor >> 2) % 2) g.filter = 'brightness(3)';
        const shrink = Math.min(1, deadFor / 70) * CELL * 0.4;
        g.drawImage(img, dx + shrink / 2, dy + shrink, CELL - shrink, CELL - shrink);
      } else {
        if (p[6] && (f.n >> 3) % 2) g.filter = 'hue-rotate(180deg) saturate(2)';
        g.drawImage(img, dx, dy);
      }
      g.restore();
      // Dazed: little stars circling the head.
      if (alive && p[15]) {
        for (let s2 = 0; s2 < 3; s2++) {
          const a = f.n / 8 + s2 * 2.1;
          g.fillStyle = '#ffe14a';
          g.fillRect(px * CELL + Math.cos(a) * CELL * 0.35 - S, dy + Math.sin(a) * S * 2 - S, 2 * S, 2 * S);
        }
      }
      // Marker over your own head.
      if (alive && view?.players?.[i]?.id === view?.you) {
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(px * CELL - 3 * S, dy - 3 * S);
        g.lineTo(px * CELL + 3 * S, dy - 3 * S);
        g.lineTo(px * CELL, dy);
        g.fill();
      }
    }
    for (const [b, bx, by] of lifted) drawBomb(g, b, bx, by, f);
    renderHud();
  }

  function drawBomb(g, b, bx, by, f) {
    const pulse = b[3] ? (f.n >> 4) % 2 : (b[2] < 40 ? (f.n >> 2) % 2 : (f.n >> 4) % 2);
    const img = b[3] ? sprites.remote : sprites.bomb;
    const sz = pulse ? CELL - 2 * S : CELL;
    const off = (CELL - sz) / 2;
    g.drawImage(img, bx * CELL + off, by * CELL + off, sz, sz);
    // Spark on the fuse.
    g.fillStyle = (f.n >> 1) % 2 ? '#ffe14a' : '#ff7a1a';
    g.fillRect(bx * CELL + 11 * S - off / 2, by * CELL + off, 2 * S, 2 * S);
    if (b[3]) {
      g.fillStyle = (f.n >> 3) % 2 ? '#ff3b3b' : '#7a0d0d';
      g.fillRect(bx * CELL + 7 * S, by * CELL + 8 * S, 2 * S, 2 * S);
    }
  }

  function drawBurning(px, py, n) {
    const g = g2;
    g.drawImage(sprites.soft, px, py);
    g.fillStyle = (n >> 2) % 2 ? 'rgba(255,120,20,.75)' : 'rgba(255,200,40,.7)';
    g.fillRect(px, py, CELL, CELL);
    g.fillStyle = 'rgba(40,10,0,.5)';
    for (let i = 0; i < 4; i++) g.fillRect(px + ((i * 5 + n) % 14) * S, py + ((i * 7 + n * 2) % 14) * S, 2 * S, 2 * S);
  }

  function drawFlames(f) {
    const g = g2;
    const on = new Map(f.f);
    for (const [i, ttl] of f.f) {
      const x = i % W, y = Math.floor(i / W);
      const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
      const life = Math.min(1, ttl / 12) * (0.8 + 0.2 * ((f.n >> 1) % 2));
      const n = { u: on.has(i - W), d: on.has(i + W), l: on.has(i - 1), r: on.has(i + 1) };
      for (const [col, w] of [['#ff5a14', 0.86], ['#ffb12a', 0.6], ['#fff6c8', 0.3]]) {
        const half = CELL * w * life / 2;
        g.fillStyle = col;
        // Arms towards neighbouring flames, a rounded tip otherwise.
        const left = n.l ? x * CELL : cx - half, right = n.r ? (x + 1) * CELL : cx + half;
        const top = n.u ? y * CELL : cy - half, bottom = n.d ? (y + 1) * CELL : cy + half;
        if (n.l || n.r || !(n.u || n.d)) g.fillRect(left, cy - half, right - left, half * 2);
        if (n.u || n.d || !(n.l || n.r)) g.fillRect(cx - half, top, half * 2, bottom - top);
        g.beginPath();
        g.arc(cx, cy, half, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // ---- HUD and overlays ----
  let hudKey = '';
  function renderHud() {
    if (!view || !cur) return;
    const f = cur;
    const me = view.players.findIndex(p => p.id === view.you);
    const mine = f.p[me];
    const secs = f.left;
    const clock = f.t <= 0 ? '' : secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '⚠';
    const key = JSON.stringify([clock, view.players.map(p => p.wins), f.p.map(p => p[2]), mine?.slice(6), view.round]);
    if (key === hudKey) return;
    hudKey = key;
    const chips = view.players.map((p, i) => {
      const alive = f.p[i]?.[2];
      const cups = '🏆'.repeat(p.wins) + '·'.repeat(Math.max(0, view.winsNeeded - p.wins));
      return `<span class="bm-chip${alive ? '' : ' out'}${p.id === view.you ? ' me' : ''}">
        <i style="background:${PLAYER_COLORS[(p.slot ?? i) % 4]}"></i>${esc(p.id === view.you ? t('game.you') : p.name)} <b>${cups}</b></span>`;
    }).join('');
    let stats = '';
    if (mine) {
      const [, , , , , , disease, bombs, fire, skates, kick, remote, , punch, grab] = mine;
      const icon = (k) => `<img class="bm-ico" src="${sprites.itemUrls[k]}" alt="">`;
      stats = `<span class="bm-stats">${icon('B')}${bombs} ${icon('F')}${fire} ${icon('S')}${skates}${kick ? icon('K') : ''}${remote ? icon('R') : ''}${punch ? icon('P') : ''}${grab ? icon('G') : ''}${disease ? ` <em>${icon('D')} ${esc(t('bomber.disease.' + disease))}</em>` : ''}</span>`;
    }
    hud.innerHTML = `<span class="bm-round">${esc(t('bomber.round', { round: view.round }))}</span>${chips}<span class="bm-clock${secs <= 0 && f.t > 0 ? ' hurry' : ''}">${clock}</span>${stats}`;
    renderOverlay();
  }

  function renderOverlay() {
    if (!view) return;
    const name = (id) => {
      const p = view.players.find(x => x.id === id);
      return p ? (p.id === view.you ? t('game.you') : p.name) : '';
    };
    let html = '';
    if (view.phase === 'play' && cur) {
      if (cur.t <= -40) html = `<div class="bm-big">${esc(t('bomber.ready'))}</div>`;
      else if (cur.t <= 30) html = `<div class="bm-big go">${esc(t('bomber.go'))}</div>`;
      else if (cur.left <= 0 && cur.t < 120 * 60 + 150) html = `<div class="bm-big hurry">${esc(t('bomber.hurry'))}</div>`;
      else {
        const me = view.players.findIndex(p => p.id === view.you);
        if (me >= 0 && cur.p[me] && !cur.p[me][2] && cur.p[me][5] > 90) html = `<div class="bm-note">${esc(t('bomber.dead'))}</div>`;
      }
    } else if (view.phase === 'roundEnd' && view.result) {
      const w = view.result.winner;
      const text = !w ? t('bomber.draw') : w === view.you ? t('bomber.youWinRound', { round: view.result.round }) : t('bomber.roundWin', { name: name(w), round: view.result.round });
      const table = view.players.map(p => `<li><i style="background:${PLAYER_COLORS[p.slot % 4]}"></i>${esc(name(p.id))} <b>${'🏆'.repeat(p.wins)}</b></li>`).join('');
      html = `<div class="bm-result"><h3>${esc(text)}</h3><ul>${table}</ul></div>`;
    }
    if (overlay.innerHTML !== html) overlay.innerHTML = html;
  }

  return {
    render(v) {
      const first = !root || !root.isConnected;
      if (first) build();
      if (view && view.round !== v.round) { prev = null; }
      view = v;
      hudKey = '';
      if (cur) renderHud();
      if (!raf && cur) raf = requestAnimationFrame(draw);
    },

    frame,

    // Shared result dialog: only at the end of the match.
    result(v) {
      if (v.phase !== 'gameOver') return null;
      const champ = v.players.find(p => p.id === v.result?.champion);
      const name = (p) => (p.id === v.you ? t('game.you') : p.name);
      const rows = [...v.players].sort((a, b) => b.wins - a.wins);
      let html = `<tr><th>${t('scores.player')}</th><th class="num">${t('bomber.wins')}</th></tr>`;
      for (const p of rows) {
        html += `<tr class="${p === champ ? 'winner' : ''}"><td><span class="bm-dot" style="background:${PLAYER_COLORS[p.slot % 4]}"></span>${esc(name(p))}${p === champ ? ' 🏆' : ''}</td><td class="num">${p.wins}</td></tr>`;
      }
      return {
        key: `${v.gameNo}:over`,
        title: champ ? (champ.id === v.you ? t('bomber.youWin') : t('bomber.matchWin', { name: champ.name })) : t('bomber.practiceOver'),
        sub: '',
        html,
        vote: false,
        over: true,
        won: champ?.id === v.you,
      };
    },

    standings(v) {
      return [...v.players].sort((a, b) => b.wins - a.wins).map(p => ({ id: p.id, name: p.name, value: p.wins }));
    },
  };
}
