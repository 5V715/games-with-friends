// "Feed my Claude": a little orange mascot runs through the donation box
// Pac-Man style and eats the coins; off one side, back on the other.

const PAL = { o: '#d97757', d: '#a9533a', k: '#1a0f2e', h: '#f0a07f' };
// 12×10, facing right. Two walking frames; the mouth opens while chomping.
const BODY = [
  '............',
  '.hhhhhhhhhh.',
  '.oooooooooo.',
  '.ooookoookoo',
  'oooookoookoo',
  'oooooooooooo',
  '.oooooooooo.',
  '.oooooooooo.',
];
const LEGS = [
  ['.o.o....o.o.', '.d.d....d.d.'],
  ['..o.o..o.o..', '..d.d..d.d..'],
];
const MOUTH = [[9, 5], [10, 5], [11, 5], [10, 6], [11, 6]];

// Now and then a treat instead of a coin. k glass/outline, w white, y/a beer,
// o bun/crust, s seeds, g green, b patty/brown, c cheese, r red, p pink.
const TREAT_PAL = {
  w: '#ffffff', y: '#f2b632', a: '#ffe08a', k: '#cfd6e0', o: '#e0a050', s: '#fff3c4', g: '#5bbf4a',
  b: '#6b3a1f', c: '#ffcc33', r: '#d2422f', p: '#ff8ac6', d: '#2f7d3a', m: '#1a0f2e', t: '#ffd23a',
};
const TREATS = {
  beer: { say: { de: 'PROST!', en: 'CHEERS!' }, map: [
    '.wwwwww..', 'wwwwwwww.', 'yayyyyy..', 'yayyyyykk', 'yayyyyy.k', 'yayyyyy.k', 'yayyyyykk', 'yyyyyyy..'] },
  burger: { say: { de: 'MJAM!', en: 'YUM!' }, map: [
    '..ooooo..', '.oosoaso.', 'ooooooooo', 'ggggggggg', 'ccccccccc', 'bbbbbbbbb', 'ooooooooo', '.ooooooo.'] },
  pizza: { say: { de: 'MJAM!', en: 'YUM!' }, map: [
    'ooooooooo', '.crcccrc.', '.ccccccc.', '..ccrcc..', '..ccccc..', '...crc...', '....c....'] },
  donut: { say: { de: 'MJAM!', en: 'YUM!' }, map: [
    '..pppp..', '.pwppwp.', 'pppoopwp', 'ppo..opp', 'pwo..opp', 'pppoopwp', '.pwppwp.', '..pppp..'] },
  gpu: { say: { de: '+1 GPU', en: '+1 GPU' }, map: [
    'dddddddddd', 'dmmmdmmmdd', 'dmwmdmwmdd', 'dmmmdmmmdd', 'dddddddddd', 't.t.t.t...'] },
};
const TREAT_KINDS = Object.keys(TREATS);
const TREAT_CHANCE = 0.18;

const PX = 3; // canvas pixels per sprite pixel (before device scaling)
const SPEED = 46; // px per second
const GAP = 26; // between coins

export function startDonate(canvas) {
  if (!canvas || canvas.dataset.running) return;
  canvas.dataset.running = '1';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const g = canvas.getContext('2d');
  let w = 0, h = 0, x = -40, coins = [], respawnAt = 0, last = 0;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    if (!coins.length) fillCoins();
  };
  const fillCoins = () => {
    coins = [];
    for (let cx = 30; cx < w - 10; cx += GAP) {
      const kind = Math.random() < TREAT_CHANCE ? TREAT_KINDS[Math.floor(Math.random() * TREAT_KINDS.length)] : 'coin';
      coins.push({ x: cx, kind, eaten: false, pop: 0 });
    }
  };

  const sprite = (sx, sy, frame, chomp) => {
    const rows = [...BODY, ...LEGS[frame]];
    rows.forEach((row, y) => [...row].forEach((c, xx) => {
      if (!PAL[c]) return;
      if (chomp && MOUTH.some(([mx, my]) => mx === xx && my === y)) return;
      g.fillStyle = PAL[c];
      g.fillRect(sx + xx * PX, sy + y * PX, PX, PX);
    }));
  };

  const coin = (cx, cy, t) => {
    // pixel coin that slowly "spins" (gets narrower and wider)
    const wv = Math.max(2, Math.round(3 + 2 * Math.cos(t / 300 + cx)));
    g.fillStyle = '#c98a00';
    g.fillRect(cx - wv, cy - 5, wv * 2, 10);
    g.fillStyle = '#ffd23a';
    g.fillRect(cx - wv + 1, cy - 4, wv * 2 - 2, 8);
    g.fillStyle = '#fff6b0';
    g.fillRect(cx - wv + 1, cy - 4, 2, 2);
  };

  const treat = (kind, cx, cy, t) => {
    const map = TREATS[kind].map;
    const tw = map[0].length * 2, th = map.length * 2;
    const bob = Math.round(Math.sin(t / 250 + cx) * 1.5);
    const ox = Math.round(cx - tw / 2), oy = Math.round(cy - th / 2) + bob;
    map.forEach((row, y) => [...row].forEach((c, x) => {
      if (!TREAT_PAL[c]) return;
      g.fillStyle = TREAT_PAL[c];
      g.fillRect(ox + x * 2, oy + y * 2, 2, 2);
    }));
  };
  const lang = () => (document.documentElement.lang === 'de' ? 'de' : 'en');

  const draw = (t) => {
    g.clearRect(0, 0, w, h);
    const ground = h - 4;
    // dotted floor line like a maze lane
    g.fillStyle = 'rgba(56, 242, 255, .25)';
    for (let i = 0; i < w; i += 8) g.fillRect(i, ground, 4, 2);
    const cy = ground - 15;
    for (const c of coins) {
      if (!c.eaten) {
        if (c.kind === 'coin') coin(c.x, cy, t);
        else treat(c.kind, c.x, cy - 1, t);
      } else if (c.pop > 0) {
        const text = c.kind === 'coin' ? '+1' : TREATS[c.kind].say[lang()];
        g.fillStyle = c.kind === 'coin' ? `rgba(255, 225, 77, ${c.pop})` : `rgba(255, 138, 198, ${c.pop})`;
        g.font = '8px "Press Start 2P", monospace';
        const tw = g.measureText(text).width;
        g.fillText(text, Math.min(w - tw - 2, Math.max(2, c.x - tw / 2)), cy - 12 - (1 - c.pop) * 10);
      }
    }
    const frame = Math.floor(t / 140) % 2;
    const chomp = Math.floor(t / 110) % 2 === 0;
    sprite(Math.round(x), ground - 10 * PX - 1, frame, chomp);
  };

  const step = (t) => {
    if (!canvas.isConnected) { delete canvas.dataset.running; return; }
    const visible = canvas.offsetParent !== null && !document.hidden;
    const dt = Math.min(0.1, (t - (last || t)) / 1000);
    last = t;
    if (visible) {
      if (canvas.clientWidth !== w) resize();
      x += SPEED * dt;
      if (x > w + 10) x = -12 * PX - 10; // through the "tunnel" back to the left
      const mouthX = x + 11 * PX;
      for (const c of coins) {
        if (!c.eaten && mouthX >= c.x - 2 && x < c.x) { c.eaten = true; c.pop = 1; }
        if (c.pop > 0) c.pop = Math.max(0, c.pop - dt * (c.kind === 'coin' ? 1.6 : 0.8));
      }
      if (coins.length && coins.every(c => c.eaten)) {
        if (!respawnAt) respawnAt = t + 1200;
        else if (t > respawnAt) { respawnAt = 0; fillCoins(); }
      }
      draw(t);
    }
    requestAnimationFrame(step);
  };

  resize();
  if (reduce) {
    x = w / 2 - 6 * PX;
    draw(0);
    delete canvas.dataset.running;
    return;
  }
  requestAnimationFrame(step);
}
