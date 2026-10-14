// Stacked screen: your well in the middle (hold on the left, next pieces on
// the right, incoming garbage as a red bar), the others' wells small on top.
// The whole screen takes touch gestures; arrow keys etc. work too.
//
// Your well runs here (see well.js). Each locked piece is reported to the
// host, which sends garbage on and tells everyone what happened (events):
// the sender's small well flashes red with the number of lines, a red
// streak flies to whoever gets the garbage, and a sound plays.

import { Well, CELLS, COLS, ROWS, VISIBLE } from './well.js';
import { esc } from '../../ui-kit.js';

const COLORS = {
  I: '#35c2e8', J: '#4a72e8', L: '#f08f34', O: '#f2c84a', S: '#58c96a', T: '#a965e0', Z: '#e85656', G: '#6d7482',
};
const DAS = 150, ARR = 35, SOFT_REPEAT = 35;

// ---- sound -----------------------------------------------------------------------

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
  const tone = (type, f0, f1, dur, vol, delay = 0) => {
    const a = ctx();
    if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur);
  };
  return {
    unlock: () => ctx(),
    rotate: () => tone('square', 520, 600, 0.03, 0.03),
    lock: () => tone('triangle', 180, 120, 0.06, 0.12),
    hold: () => tone('sine', 400, 300, 0.08, 0.07),
    clear: (n) => [0, 1, 2, 3].slice(0, n).forEach((i) => tone('square', 523 * 2 ** (i * 4 / 12), 523 * 2 ** (i * 4 / 12), 0.09, 0.06, i * 0.06)),
    other: (n) => [0, 1].slice(0, Math.min(2, n)).forEach((i) => tone('triangle', 330 + i * 110, 330 + i * 110, 0.12, 0.08, i * 0.08)),
    send: () => tone('sawtooth', 900, 200, 0.25, 0.05),
    hit: () => tone('sawtooth', 120, 60, 0.3, 0.12),
    ko: () => tone('triangle', 500, 60, 0.7, 0.15),
  };
}

// ---- drawing ------------------------------------------------------------------------

function sizeCanvas(cv, w, h) {
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function block(g, x, y, s, type, alpha = 1) {
  const c = COLORS[type] || '#888';
  g.globalAlpha = alpha;
  g.fillStyle = c;
  g.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
  if (s >= 6) {
    const e = Math.max(1, Math.round(s / 7));
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(x + 0.5, y + 0.5, s - 1, e);
    g.fillRect(x + 0.5, y + 0.5, e, s - 1);
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(x + 0.5, y + s - 0.5 - e, s - 1, e);
    g.fillRect(x + s - 0.5 - e, y + 0.5, e, s - 1);
  }
  g.globalAlpha = 1;
}

function drawPiece(g, type, box, s, alpha = 1) {
  if (!type) return;
  const cells = CELLS[type][0];
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const w = (Math.max(...xs) - Math.min(...xs) + 1) * s, h = (Math.max(...ys) - Math.min(...ys) + 1) * s;
  const ox = box.x + (box.w - w) / 2 - Math.min(...xs) * s, oy = box.y + (box.h - h) / 2 - Math.min(...ys) * s;
  for (const [x, y] of cells) block(g, ox + x * s, oy + y * s, s, type, alpha);
}

// ---- screen ------------------------------------------------------------------------------

export function createStackedUI(ctx) {
  const { els, t, act } = ctx;
  const sound = createSound();
  let view = null;
  let root, wellCv, holdCv, nextCv, gWell, gHold, gNext, overlay, oppsBox, garbageBar, stats, fly;
  let cell = 24, mini = 6;
  let well = null, wellKey = '', running = false, reported = false;
  let lastEvent = 0;
  let raf = 0, lastT = 0;
  const flashes = []; // { rows, until }
  const keys = { left: false, right: false, down: false, dir: 0, dasAt: 0, arrAt: 0, softAt: 0 };
  let callout = null; // { text, until }

  // ---- layout ----
  function build() {
    els.main.innerHTML = '';
    root = document.createElement('div');
    root.className = 'stacked';
    root.innerHTML = `
      <div class="st-opps"></div>
      <div class="st-main">
        <div class="st-side">
          <span class="st-label">${esc(t('stacked.hold'))}</span><canvas class="st-hold"></canvas>
          <div class="st-stats"></div>
        </div>
        <div class="st-wellwrap">
          <div class="st-garbage"><i></i></div>
          <canvas class="st-well"></canvas>
          <div class="st-overlay"></div>
        </div>
        <div class="st-side">
          <span class="st-label">${esc(t('stacked.next'))}</span><canvas class="st-next"></canvas>
        </div>
      </div>
      <div class="st-fly"></div>`;
    els.main.append(root);
    wellCv = root.querySelector('.st-well');
    holdCv = root.querySelector('.st-hold');
    nextCv = root.querySelector('.st-next');
    overlay = root.querySelector('.st-overlay');
    oppsBox = root.querySelector('.st-opps');
    garbageBar = root.querySelector('.st-garbage i');
    stats = root.querySelector('.st-stats');
    fly = root.querySelector('.st-fly');
    bindTouch(root);
    new ResizeObserver(() => layout()).observe(root);
  }

  function layout() {
    if (!root?.isConnected) return;
    const W = root.clientWidth - 16, H = root.clientHeight - 20;
    const others = view ? view.players.length - 1 : 0;
    // The well gets the space; hold and next are narrow columns beside it.
    // Height left over goes to the small wells of the others.
    const minOpp = others ? 4 * VISIBLE + 24 : 40;
    cell = Math.max(8, Math.floor(Math.min((W - 28) / 16.4, (H - minOpp - 10) / VISIBLE)));
    mini = others ? Math.max(4, Math.min(12, Math.floor((H - cell * VISIBLE - 40) / VISIBLE), Math.floor((W - 112) / others / (COLS + 2)))) : 4;
    gWell = sizeCanvas(wellCv, cell * COLS, cell * VISIBLE);
    gHold = sizeCanvas(holdCv, cell * 3, cell * 2.2);
    gNext = sizeCanvas(nextCv, cell * 3, cell * 10);
    root.style.setProperty('--cell', cell + 'px');
    draw();
  }

  // ---- your well ----
  function startRound(v) {
    well = new Well(v.seed);
    wellKey = `${v.gameNo}:${v.round}`;
    running = false;
    reported = false;
    flashes.length = 0;
    callout = null;
    lastEvent = Math.max(0, ...(v.events || []).map(e => e.n));
  }

  function me() {
    return view?.players.find(p => p.id === view.you);
  }

  function canPlay() {
    return running && well && !well.dead && me()?.alive;
  }

  function afterLock(res) {
    if (!res) return;
    if (res.lines) {
      sound.clear(res.lines);
      flashes.push({ rows: res.rows, until: performance.now() + 180 });
      const parts = [];
      if (res.tspin === 'full') parts.push(t('stacked.tspin'));
      parts.push(['', '1', '2', '3', '4'][res.lines] + '×');
      if (res.b2b) parts.push(t('stacked.b2b'));
      if (res.combo >= 2) parts.push(t('stacked.combo', { n: res.combo }));
      if (res.perfect) parts.push(t('stacked.perfect'));
      callout = { text: parts.join(' · '), until: performance.now() + 1200 };
    } else sound.lock();
    if (res.received) sound.hit();
    if (res.topOut) sound.ko();
    act({
      type: 'lock', round: view.round, lines: res.lines, sent: res.sent, tspin: res.tspin, combo: res.combo,
      b2b: res.b2b, perfect: res.perfect, topOut: res.topOut, board: well.board(), used: { ...well.used },
    });
    if (res.topOut) reported = true;
  }

  function doMove(dx) { if (canPlay()) well.move(dx); }
  function doRotate(dir) { if (canPlay() && well.rotate(dir)) sound.rotate(); }
  function doSoft() { if (canPlay()) well.softDrop(); }
  function doDrop() { if (canPlay()) afterLock(well.hardDrop()); }
  function doHold() { if (canPlay() && well.holdPiece()) sound.hold(); }

  // ---- touch: the whole screen ----
  function bindTouch(el) {
    let g = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, dialog')) return;
      e.preventDefault();
      sound.unlock();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY, t0: performance.now(), moved: false };
    });
    el.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const step = cell * 0.85;
      while (Math.abs(e.clientX - g.ax) >= step) {
        const dir = Math.sign(e.clientX - g.ax);
        doMove(dir);
        g.ax += dir * step;
        g.moved = true;
      }
      // Dragging down slowly: soft drop, one row per cell of movement.
      while (e.clientY - g.ay >= cell) {
        doSoft();
        g.ay += cell;
        g.moved = true;
      }
      if (e.clientY < g.ay) g.ay = e.clientY;
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = Math.max(1, performance.now() - g.t0);
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.4;
      if (e.type === 'pointerup') {
        if (vertical && dy > 40 && dy / dt > 0.5) doDrop();
        else if (vertical && dy < -40 && -dy / dt > 0.4) doHold();
        else if (!g.moved && Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 400) {
          const r = el.getBoundingClientRect();
          doRotate(e.clientX >= r.left + r.width / 2 ? 1 : -1);
        }
      }
      g = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- keyboard ----
  function active() {
    return root?.isConnected && root.closest('.screen.active') && !document.querySelector('dialog[open]');
  }

  function onKey(e) {
    if (!active()) return;
    const down = e.type === 'keydown';
    const c = e.code;
    if (c === 'ArrowLeft' || c === 'ArrowRight') {
      e.preventDefault();
      const dir = c === 'ArrowLeft' ? -1 : 1;
      if (down && !e.repeat) {
        keys[dir < 0 ? 'left' : 'right'] = true;
        keys.dir = dir;
        doMove(dir);
        keys.dasAt = performance.now() + DAS;
      } else if (!down) {
        keys[dir < 0 ? 'left' : 'right'] = false;
        keys.dir = keys.left ? -1 : keys.right ? 1 : 0;
        keys.dasAt = performance.now() + DAS;
      }
      return;
    }
    if (c === 'ArrowDown') {
      e.preventDefault();
      if (down && !e.repeat) { keys.down = true; doSoft(); keys.softAt = performance.now() + SOFT_REPEAT; }
      if (!down) keys.down = false;
      return;
    }
    if (!down || e.repeat) return;
    if (c === 'ArrowUp' || c === 'KeyX') { e.preventDefault(); doRotate(1); }
    else if (c === 'KeyZ' || c === 'ControlLeft' || c === 'ControlRight') { e.preventDefault(); doRotate(-1); }
    else if (c === 'Space') { e.preventDefault(); doDrop(); }
    else if (c === 'KeyC' || c === 'ShiftLeft' || c === 'ShiftRight') { e.preventDefault(); doHold(); }
    sound.unlock();
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => { keys.left = keys.right = keys.down = false; keys.dir = 0; });

  function repeatKeys(now) {
    if (keys.dir && now >= keys.dasAt) {
      while (now >= keys.dasAt) { doMove(keys.dir); keys.dasAt += ARR; }
    }
    if (keys.down && now >= keys.softAt) {
      while (now >= keys.softAt) { doSoft(); keys.softAt += SOFT_REPEAT; }
    }
  }

  // ---- loop ----
  function loop(now) {
    raf = 0;
    if (!root?.isConnected || !root.closest('.screen.active')) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(100, now - (lastT || now));
    lastT = now;
    if (canPlay()) {
      repeatKeys(now);
      afterLock(well.update(dt));
    } else if (running && well?.dead && !reported) {
      afterLock({ lines: 0, sent: 0, topOut: true, rows: [] });
    }
    draw();
  }

  function draw() {
    if (!gWell) return;
    const g = gWell, s = cell;
    g.clearRect(0, 0, s * COLS, s * VISIBLE);
    g.fillStyle = '#0d1117';
    g.fillRect(0, 0, s * COLS, s * VISIBLE);
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.lineWidth = 1;
    for (let x = 1; x < COLS; x++) { g.beginPath(); g.moveTo(x * s + 0.5, 0); g.lineTo(x * s + 0.5, s * VISIBLE); g.stroke(); }
    for (let y = 1; y < VISIBLE; y++) { g.beginPath(); g.moveTo(0, y * s + 0.5); g.lineTo(s * COLS, y * s + 0.5); g.stroke(); }
    const top = ROWS - VISIBLE;
    if (well) {
      for (let y = top; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = well.grid[y][x];
          if (c !== '.') block(g, x * s, (y - top) * s, s, c, well.dead ? 0.45 : 1);
        }
      }
      if (!well.dead && running) {
        const gy = well.ghostY();
        for (const [x, y] of well.cells({ ...well.piece, y: gy })) {
          if (y < top) continue;
          g.strokeStyle = COLORS[well.piece.type];
          g.globalAlpha = 0.55;
          g.lineWidth = 2;
          g.strokeRect(x * s + 2, (y - top) * s + 2, s - 4, s - 4);
          g.globalAlpha = 1;
        }
        for (const [x, y] of well.cells()) if (y >= top) block(g, x * s, (y - top) * s, s, well.piece.type);
      }
      const now = performance.now();
      for (const f of flashes) {
        if (now > f.until) continue;
        g.fillStyle = `rgba(255,255,255,${((f.until - now) / 180) * 0.8})`;
        for (const r of f.rows) g.fillRect(0, (r - top) * s, s * COLS, s);
      }
      while (flashes.length && flashes[0].until < now) flashes.shift();

      // Hold and next.
      gHold.clearRect(0, 0, s * 3, s * 2.2);
      drawPiece(gHold, well.hold, { x: 0, y: 0, w: s * 3, h: s * 2.2 }, s * 0.62, well.canHold ? 1 : 0.35);
      gNext.clearRect(0, 0, s * 3, s * 10);
      well.queue.slice(0, 5).forEach((type, i) => {
        const sz = i === 0 ? s * 0.62 : s * 0.48;
        drawPiece(gNext, type, { x: 0, y: i === 0 ? 0 : s * 2.2 + (i - 1) * s * 1.9, w: s * 3, h: i === 0 ? s * 2.2 : s * 1.9 }, sz);
      });
      garbageBar.style.height = Math.min(VISIBLE, well.pending) * s + 'px';
      stats.innerHTML = `<b>${esc(t('stacked.level', { n: well.level + 1 }))}</b><span>${esc(t('stacked.lines'))}: ${me()?.lines ?? 0}</span>`;
    }
    renderOverlay();
  }

  function renderOverlay() {
    if (!view) return;
    const name = (id) => {
      const p = view.players.find(x => x.id === id);
      return p ? (p.id === view.you ? t('game.you') : p.name) : '';
    };
    let html = '';
    if (view.phase === 'play' && !view.live) {
      html = `<div class="st-big">${esc(t('stacked.ready'))}</div><div class="st-howto">${esc(t('stacked.howto'))}</div>`;
    } else if (view.phase === 'play' && me() && !me().alive) {
      html = `<div class="st-note">${esc(t('stacked.ko'))}</div>`;
    } else if (view.phase === 'play' && callout && performance.now() < callout.until) {
      html = `<div class="st-callout">${esc(callout.text)}</div>`;
    } else if (view.phase === 'roundEnd' && view.result) {
      const w = view.result.winner;
      const text = !w ? t('stacked.draw') : w === view.you ? t('stacked.youWinRound', { round: view.result.round }) : t('stacked.roundWin', { name: name(w), round: view.result.round });
      const list = view.players.map(p => `<li>${esc(name(p.id))} <b>${'🏆'.repeat(p.wins)}</b></li>`).join('');
      html = `<div class="st-result"><h3>${esc(text)}</h3><ul>${list}</ul></div>`;
    }
    if (overlay.innerHTML !== html) overlay.innerHTML = html;
  }

  // ---- the others ----
  function renderOpps() {
    const others = view.players.filter(p => p.id !== view.you);
    if (oppsBox.dataset.ids !== others.map(p => p.id).join()) {
      oppsBox.dataset.ids = others.map(p => p.id).join();
      oppsBox.innerHTML = others.map(p => `
        <div class="st-opp" data-id="${esc(p.id)}">
          <div class="st-mini"><canvas></canvas><i class="st-pend"></i><span class="st-badge"></span><span class="st-ko">KO</span></div>
          <span class="st-oname"></span>
        </div>`).join('');
    }
    for (const p of others) {
      const el = oppsBox.querySelector(`[data-id="${CSS.escape(p.id)}"]`);
      if (!el) continue;
      el.classList.toggle('out', !p.alive);
      el.querySelector('.st-oname').textContent = `${p.name} ${'🏆'.repeat(p.wins)}`;
      el.querySelector('.st-pend').style.height = Math.min(100, p.pending * 5) + '%';
      const cv = el.querySelector('canvas');
      const ms = mini;
      if (cv.width !== Math.round(ms * COLS * (window.devicePixelRatio || 1))) sizeCanvas(cv, ms * COLS, ms * VISIBLE);
      const g = cv.getContext('2d');
      g.fillStyle = '#0d1117';
      g.fillRect(0, 0, ms * COLS, ms * VISIBLE);
      for (let i = 0; i < p.board.length; i++) {
        const c = p.board[i];
        if (c !== '.') block(g, (i % COLS) * ms, Math.floor(i / COLS) * ms, ms, c, p.alive ? 1 : 0.4);
      }
    }
  }

  // Where someone's garbage went: flash, number, sound, streak.
  function playEvents() {
    for (const e of view.events || []) {
      if (e.n <= lastEvent) continue;
      lastEvent = e.n;
      if (e.ko) continue;
      const fromEl = e.from === view.you ? root.querySelector('.st-wellwrap') : oppsBox.querySelector(`[data-id="${CSS.escape(e.from)}"] .st-mini`);
      if (e.lines && e.from !== view.you && fromEl) {
        fromEl.classList.remove('hit');
        void fromEl.offsetWidth;
        fromEl.classList.add('hit');
        const badge = fromEl.querySelector('.st-badge');
        if (badge) badge.textContent = `${e.lines}${e.tspin === 'full' ? ' T' : ''}`;
        sound.other(e.lines);
      }
      if (e.sent && e.to) {
        const toEl = e.to === view.you ? root.querySelector('.st-wellwrap') : oppsBox.querySelector(`[data-id="${CSS.escape(e.to)}"] .st-mini`);
        if (fromEl && toEl) shoot(fromEl, toEl, e.sent);
        if (e.from === view.you) sound.send();
      }
    }
  }

  function shoot(fromEl, toEl, n) {
    const base = fly.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'st-shot';
    dot.textContent = `+${n}`;
    const x0 = a.left + a.width / 2 - base.left, y0 = a.top + a.height / 2 - base.top;
    const x1 = b.left + b.width / 2 - base.left, y1 = b.top + b.height / 2 - base.top;
    dot.style.transform = `translate(${x0}px, ${y0}px) scale(.6)`;
    fly.append(dot);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      dot.style.transform = `translate(${x1}px, ${y1}px) scale(1.1)`;
      dot.style.opacity = '0.9';
    }));
    setTimeout(() => {
      dot.remove();
      toEl.classList.remove('incoming');
      void toEl.offsetWidth;
      toEl.classList.add('incoming');
    }, 520);
  }

  return {
    render(v) {
      if (!root || !root.isConnected) { build(); requestAnimationFrame(layout); }
      view = v;
      if (v.phase === 'play' && `${v.gameNo}:${v.round}` !== wellKey) startRound(v);
      if (v.phase === 'play') running = v.live;
      else running = false;
      if (well) well.incoming = v.incoming || [];
      if (oppsBox.dataset.n !== String(v.players.length)) { oppsBox.dataset.n = v.players.length; layout(); }
      renderOpps();
      playEvents();
      draw();
      if (!raf) raf = requestAnimationFrame(loop);
    },

    result(v) {
      if (v.phase !== 'gameOver') return null;
      const champ = v.players.find(p => p.id === v.result?.champion);
      const name = (p) => (p.id === v.you ? t('game.you') : p.name);
      const rows = [...v.players].sort((a, b) => b.wins - a.wins);
      let html = `<tr><th>${t('scores.player')}</th><th class="num">${t('stacked.wins')}</th></tr>`;
      for (const p of rows) html += `<tr class="${p === champ ? 'winner' : ''}"><td>${esc(name(p))}${p === champ ? ' 🏆' : ''}</td><td class="num">${p.wins}</td></tr>`;
      return {
        key: `${v.gameNo}:over`,
        title: champ ? (champ.id === v.you ? t('stacked.youWin') : t('stacked.matchWin', { name: champ.name })) : t('stacked.practiceOver'),
        sub: '', html, vote: false, over: true, won: champ?.id === v.you,
      };
    },

    standings(v) {
      return [...v.players].sort((a, b) => b.wins - a.wins).map(p => ({ id: p.id, name: p.name, value: p.wins }));
    },
  };
}
