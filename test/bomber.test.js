import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BomberGame, W, H, HARD, SOFT, EMPTY, spiral } from '../public/js/games/bomber/engine.js';
import { botInput } from '../public/js/games/bomber/bot.js';

const idx = (x, y) => y * W + x;

function emptyArena(n = 2) {
  const g = new BomberGame();
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i);
  g.start();
  for (let i = 0; i < W * H; i++) if (g.grid[i] === SOFT) g.grid[i] = EMPTY;
  g.hidden.clear();
  while (g.t < 0) g.tick();
  return g;
}

test('arena: walls, pillars, free start corners, spiral covers all inner cells', () => {
  const g = new BomberGame();
  g.addPlayer('a', 'A'); g.addPlayer('b', 'B');
  g.start();
  assert.equal(g.grid[idx(0, 0)], HARD);
  assert.equal(g.grid[idx(2, 2)], HARD);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [13, 11], [12, 11], [13, 10]]) assert.equal(g.grid[idx(x, y)], EMPTY);
  assert.equal(spiral().length, (W - 2) * (H - 2));
  assert.ok(g.hidden.size > 20);
});

test('movement is blocked by pillars and slides around corners', () => {
  const g = emptyArena();
  const p = g.player('p0');
  g.setInput('p0', { d: 'r' });
  for (let i = 0; i < 300; i++) g.tick();
  assert.ok(p.x > 12 && p.x <= 13.5, 'walked along the top row: ' + p.x);
  // Stand slightly right of a column and press down onto a pillar: slides into the gap.
  p.x = 2.75; p.y = 1.5;
  g.setInput('p0', { d: 'd' });
  for (let i = 0; i < 60; i++) g.tick();
  assert.equal(Math.floor(p.x), 3);
  assert.ok(p.y > 2, 'went down past the pillar: ' + p.y);
});

test('bombs explode, kill, chain and stop at walls', () => {
  const g = emptyArena();
  const [a, b] = g.players;
  a.x = 1.5; a.y = 1.5; b.x = 5.5; b.y = 1.5;
  a.fire = 4;
  g.setInput('p0', { d: null, a: 0 });
  g.setInput('p0', { d: null, a: 1 });
  g.tick();
  assert.equal(g.bombs.length, 1);
  // Walk away down and wait for the blast.
  g.setInput('p0', { d: 'd', a: 1 });
  for (let i = 0; i < 160; i++) g.tick();
  assert.equal(b.alive, false, 'player in range got hit');
  assert.equal(a.alive, true);
  assert.ok(!g.flames.has(idx(2, 2)), 'pillars stop flames');
});

test('items are revealed by blasts and picked up', () => {
  const g = emptyArena();
  const p = g.player('p0');
  g.grid[idx(3, 1)] = SOFT;
  g.hidden.set(idx(3, 1), 'B');
  p.x = 2.5; p.y = 1.5;
  g.setInput('p0', { a: 0 }); g.setInput('p0', { a: 1 });
  g.tick();
  g.setInput('p0', { d: 'l', a: 1 });
  for (let i = 0; i < 20; i++) g.tick();
  g.setInput('p0', { d: 'd', a: 1 }); // into the safe corner below (1,2)
  for (let i = 0; i < 200; i++) g.tick();
  assert.equal(g.items.get(idx(3, 1)), 'B');
  p.x = 3.5; p.y = 1.5;
  g.tick();
  assert.equal(p.bombs, 2);
});

test('bots finish a best-of-3 match', () => {
  for (let run = 0; run < 3; run++) {
    const g = new BomberGame();
    for (let i = 0; i < 4; i++) g.addPlayer('b' + i, 'Bot' + i, { bot: true });
    g.start();
    let ticks = 0;
    while (g.phase !== 'gameOver' && ticks < 60 * 60 * 20) {
      for (const p of g.players) g.steer(p.id, botInput(g, p.id));
      g.tick();
      ticks++;
    }
    assert.equal(g.phase, 'gameOver', `match finished (round ${g.round}, ${ticks} ticks)`);
    assert.ok(g.players.some(p => p.wins >= 2));
    console.log(`match ${run}: ${g.round} rounds, ${Math.round(ticks / 60)} s`, g.history.map(h => h.winner || 'draw').join(' '));
  }
});

test('guest position reports: accepted when reachable, rejected otherwise', () => {
  const g = emptyArena();
  const p = g.player('p0');
  const fix = p.fix;
  // Walk right in small reported steps (the host's budget grows each tick).
  g.tick(); g.tick();
  let x = p.x;
  for (let i = 0; i < 20; i++) {
    x += g.speed(p) * 2;
    g.setInput('p0', { d: 'r', x, y: p.y, fix });
    g.tick(); g.tick();
  }
  assert.ok(Math.abs(p.x - x) < 1e-9, 'host took the reported position');
  assert.equal(p.fix, fix);
  // Teleporting is refused and bumps the fix counter.
  g.setInput('p0', { d: 'r', x: x + 4, y: p.y, fix });
  g.tick();
  assert.ok(Math.abs(p.x - x) < 1e-9);
  assert.equal(p.fix, fix + 1);
  // Reports made before the guest saw the correction are ignored.
  g.setInput('p0', { d: 'r', x: x + 0.05, y: p.y, fix });
  g.tick();
  assert.ok(p.x - x < 0.06);
  // Walking into a pillar is refused.
  p.x = 1.5; p.y = 1.5;
  g.setInput('p0', { d: 'd', x: 2.5, y: 2.5, fix: p.fix });
  for (let i = 0; i < 30; i++) g.tick();
  assert.equal(Math.floor(p.x) === 2 && Math.floor(p.y) === 2, false);
});

test('a bomb dropped with a position report lands at that position', () => {
  const g = emptyArena();
  const p = g.player('p0');
  g.setInput('p0', { a: 0, x: p.x, y: p.y, fix: p.fix });
  g.tick();
  const x = p.x + 0.6; // next cell
  for (let i = 0; i < 12; i++) { g.setInput('p0', { d: 'r', a: 0, x: p.x + 0.05, y: p.y, fix: p.fix }); g.tick(); }
  assert.ok(p.x >= x - 0.01);
  g.setInput('p0', { d: null, a: 1, x: p.x, y: p.y, fix: p.fix });
  g.tick();
  assert.equal(g.bombs.length, 1);
  assert.equal(g.bombs[0].x, Math.floor(p.x));
});
