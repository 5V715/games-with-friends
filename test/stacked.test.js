import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Well, CELLS, COLS, ROWS, PIECES } from '../public/js/games/stacked/well.js';
import { StackedGame } from '../public/js/games/stacked/engine.js';

const fill = (w, rows) => {
  // rows: strings from the bottom up, '#' filled, '.' empty
  rows.forEach((r, i) => { w.grid[ROWS - 1 - i] = [...r].map(c => (c === '#' ? 'G' : '.')); });
};

test('pieces come in bags of seven; same seed, same order', () => {
  const a = new Well(42), b = new Well(42);
  const seq = (w) => [w.piece.type, ...w.queue.slice(0, 6)];
  assert.deepEqual(seq(a), seq(b));
  assert.deepEqual([...seq(a)].sort(), [...PIECES].sort());
  for (const k of PIECES) for (const r of CELLS[k]) assert.equal(r.length, 4);
});

test('moving, walls and a hard drop to the floor', () => {
  const w = new Well(1);
  w.piece = { type: 'O', rot: 0, x: 4, y: 1 };
  for (let i = 0; i < 10; i++) w.move(-1);
  assert.equal(w.piece.x, 0);
  w.hardDrop();
  assert.equal(w.grid[ROWS - 1][0], 'O');
  assert.equal(w.grid[ROWS - 2][1], 'O');
});

test('four lines send 4 (+10 for an empty well), the next one is back-to-back', () => {
  const w = new Well(1);
  fill(w, ['#########.', '#########.', '#########.', '#########.']);
  w.piece = { type: 'I', rot: 1, x: 7, y: 1 };
  let r = w.hardDrop();
  assert.equal(r.lines, 4);
  assert.ok(r.perfect, 'that cleared everything');
  assert.equal(r.attack, 4 + 10);
  // Again, with a row left over: 4 + back-to-back 1 (combo bonus starts at the third clear).
  fill(w, ['#########.', '#########.', '#########.', '#########.', '.########.']);
  w.piece = { type: 'I', rot: 1, x: 7, y: 1 };
  r = w.hardDrop();
  assert.equal(r.lines, 4);
  assert.ok(r.b2b);
  assert.equal(r.attack, 4 + 1);
});

test('a T-spin double sends 4', () => {
  const w = new Well(1);
  // Slot for a T pointing down, with an overhang on the left.
  fill(w, ['####.#####', '###...####', '##........']);
  for (let x = 0; x <= 3; x++) w.grid[ROWS - 3][x] = 'G'; // overhang over the slot
  // T upside down (rot 2) sitting in the slot, reached by a rotation.
  w.piece = { type: 'T', rot: 1, x: 3, y: ROWS - 3 };
  assert.ok(w.rotate(1), 'rotated into the slot');
  const r = w.hardDrop();
  assert.equal(r.lines, 2);
  assert.equal(r.tspin, 'full');
  assert.equal(r.attack, 4);
});

test('attacks cancel incoming garbage; the rest rises after a piece without clears', () => {
  const w = new Well(3);
  w.incoming = [{ id: 1, lines: 3, gap: 2 }];
  fill(w, ['#########.', '#########.']);
  w.piece = { type: 'I', rot: 1, x: 7, y: 1 };
  const r = w.hardDrop(); // clears 2 lines: attack 1 cancels 1 of 3
  assert.equal(r.attack, 1);
  assert.equal(r.sent, 0);
  assert.equal(w.pending, 2);
  w.piece = { type: 'O', rot: 0, x: 0, y: 1 };
  const r2 = w.hardDrop();
  assert.equal(r2.received, 2);
  assert.equal(w.pending, 0);
  assert.equal(w.grid[ROWS - 1][2], '.');
  assert.equal(w.grid[ROWS - 1][3], 'G');
});

test('bots play a best-of-3 match to the end', () => {
  for (let run = 0; run < 3; run++) {
    const g = new StackedGame();
    for (let i = 0; i < 3; i++) g.addPlayer('b' + i, 'Bot' + i, { bot: true });
    g.start();
    let ticks = 0;
    while (g.phase !== 'gameOver' && ticks < 60 * 60 * 30) { g.tick(); ticks++; }
    assert.equal(g.phase, 'gameOver', `finished (round ${g.round}, ${ticks} ticks)`);
    assert.ok(g.players.some(p => p.wins >= 2));
    const sent = g.players.reduce((s, p) => s + p.sentTotal, 0);
    console.log(`match ${run}: ${g.round} rounds, ${Math.round(ticks / 60)} s, garbage in last round ${sent}`);
  }
});

test('reports from players route garbage to an opponent', () => {
  const g = new StackedGame();
  g.addPlayer('a', 'A'); g.addPlayer('b', 'B');
  g.start();
  for (let i = 0; i < 180; i++) g.tick();
  assert.ok(g.live);
  const res = g.apply('a', { type: 'lock', round: g.round, lines: 4, sent: 4, board: '.'.repeat(200), used: {} });
  assert.ok(res.ok);
  const b = g.player('b');
  assert.equal(b.incoming.length, 1);
  assert.equal(b.incoming[0].lines, 4);
  assert.equal(g.events.at(-1).to, 'b');
  g.apply('b', { type: 'lock', round: g.round, lines: 0, sent: 0, board: '.'.repeat(200), used: { [b.incoming[0].id]: 4 } });
  assert.equal(b.incoming.length, 0);
  g.apply('b', { type: 'lock', round: g.round, lines: 0, sent: 0, board: '.'.repeat(200), topOut: true });
  for (let i = 0; i < 70; i++) g.tick();
  assert.equal(g.phase, 'roundEnd');
  assert.equal(g.player('a').wins, 1);
});
