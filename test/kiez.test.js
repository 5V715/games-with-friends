import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KiezGame, scoreFor, totals, CATEGORIES } from '../public/js/games/kiez/engine.js';
import { botStep } from '../public/js/games/kiez/bot.js';

// Dice that come out in a fixed order.
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('box scores', () => {
  assert.equal(scoreFor('threes', [3, 3, 1, 3, 6]), 9);
  assert.equal(scoreFor('three', [4, 4, 4, 2, 1]), 15);
  assert.equal(scoreFor('three', [4, 4, 5, 2, 1]), 0);
  assert.equal(scoreFor('four', [6, 6, 6, 6, 1]), 25);
  assert.equal(scoreFor('full', [2, 2, 5, 5, 5]), 25);
  assert.equal(scoreFor('full', [5, 5, 5, 5, 5]), 0, 'five of a kind is no full house without joker');
  assert.equal(scoreFor('full', [5, 5, 5, 5, 5], { joker: true }), 25);
  assert.equal(scoreFor('small', [1, 3, 4, 2, 6]), 30);
  assert.equal(scoreFor('small', [1, 3, 5, 2, 6]), 0);
  assert.equal(scoreFor('large', [2, 3, 4, 5, 6]), 40);
  assert.equal(scoreFor('large', [1, 2, 3, 4, 6]), 0);
  assert.equal(scoreFor('king', [3, 3, 3, 3, 3]), 50);
  assert.equal(scoreFor('chance', [1, 2, 3, 4, 6]), 16);
});

test('upper bonus from 63', () => {
  const sheet = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
  assert.deepEqual(totals(sheet), { upper: 63, bonus: 35, lower: 0, kingBonus: 0, total: 98 });
  assert.equal(totals({ ...sheet, sixes: 12 }).bonus, 0);
});

test('a turn: roll, hold, roll, enter; then the next player', () => {
  const g = new KiezGame({ rng: seq(6, 6, 2, 3, 6, 6, 1) });
  g.addPlayer('a', 'A');
  g.addPlayer('b', 'B');
  g.start();
  const p = g.current;
  assert.equal(g.apply(p.id, { type: 'score', cat: 'sixes' }).key, 'kiez.err.rollFirst');
  assert.ok(g.apply(p.id, { type: 'roll' }).ok);
  assert.deepEqual(g.dice, [6, 6, 2, 3, 6]);
  // Hold the sixes, roll the rest.
  assert.ok(g.apply(p.id, { type: 'roll', held: [true, true, false, false, true] }).ok);
  assert.deepEqual(g.dice, [6, 6, 6, 1, 6]);
  assert.ok(g.apply(p.id, { type: 'roll', held: [true, true, true, false, true] }).ok);
  assert.equal(g.apply(p.id, { type: 'roll' }).key, 'kiez.err.noRolls');
  assert.ok(g.apply(p.id, { type: 'score', cat: 'sixes' }).ok);
  assert.equal(p.sheet.sixes, 30);
  assert.notEqual(g.current, p);
  assert.equal(g.apply(p.id, { type: 'roll' }).key, 'err.notYourTurn');
});

test('a box can only be filled once', () => {
  const g = new KiezGame({ rng: seq(1) });
  g.addPlayer('a', 'A');
  g.start();
  g.apply('a', { type: 'roll' });
  assert.ok(g.apply('a', { type: 'score', cat: 'ones' }).ok);
  g.apply('a', { type: 'roll' });
  assert.equal(g.apply('a', { type: 'score', cat: 'ones' }).key, 'kiez.err.taken');
});

test('another Kiez King: +50 bonus and joker for the straights', () => {
  const g = new KiezGame({ rng: seq(4) });
  g.addPlayer('a', 'A');
  g.start();
  const p = g.player('a');
  g.apply('a', { type: 'roll' });
  assert.ok(g.apply('a', { type: 'score', cat: 'king' }).ok);
  assert.equal(p.sheet.king, 50);
  g.apply('a', { type: 'roll' });
  assert.ok(g.apply('a', { type: 'score', cat: 'large' }).ok);
  assert.equal(p.sheet.large, 40, 'joker counts as large straight');
  assert.equal(p.kings, 1);
  assert.equal(totals(p.sheet, p.kings * 50).total, 140);
});

test('bots play whole games for 1 to 4 players', () => {
  for (let n = 1; n <= 4; n++) {
    const g = new KiezGame();
    for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i, { bot: true });
    g.start();
    let steps = 0;
    while (g.phase === 'play') {
      const id = g.current.id;
      const res = g.apply(id, botStep(g.view(id)));
      assert.ok(res.ok, res.error);
      assert.ok(++steps < 13 * n * 4 + 5, 'no endless turns');
    }
    assert.equal(g.phase, 'roundOver');
    for (const p of g.players) {
      assert.ok(CATEGORIES.every(k => p.sheet[k] != null));
      assert.ok(p.score > 80, `bot scored ${p.score}`);
    }
    assert.ok(g.result.winner);
    for (const p of g.players) g.apply(p.id, { type: 'vote', yes: true });
    assert.equal(g.phase, 'play');
    assert.equal(g.round, 2);
  }
});
