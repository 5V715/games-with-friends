import test from 'node:test';
import assert from 'node:assert/strict';
import { UnoGame, createUnoDeck, playable, cardPoints } from '../public/js/games/uno/engine.js';
import { botStep } from '../public/js/games/uno/bot.js';
import { tr } from '../public/js/i18n.js';

function game(n) {
  const g = new UnoGame();
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i, { bot: true });
  g.start();
  return g;
}
const C = (color, kind, value = null, id = Math.random().toString(36)) => ({ id, color, kind, value });

test('deck has 108 cards', () => {
  const d = createUnoDeck();
  assert.equal(d.length, 108);
  assert.equal(d.filter(c => c.kind === 'wild4').length, 4);
  assert.equal(d.filter(c => c.color === 'R' && c.kind === 'num' && c.value === 0).length, 1);
  assert.equal(d.filter(c => c.color === 'B' && c.kind === 'draw2').length, 2);
});

test('deal and matching', () => {
  const g = game(3);
  for (const p of g.players) assert.equal(p.hand.length, 7);
  assert.equal(g.top.kind, 'num');
  assert.ok(playable(C('R', 'num', 5), C('R', 'num', 1), 'R'));
  assert.ok(playable(C('B', 'num', 1), C('R', 'num', 1), 'R'));
  assert.ok(!playable(C('B', 'num', 2), C('R', 'num', 1), 'R'));
  assert.ok(playable(C('B', 'skip'), C('R', 'skip'), 'R'));
  assert.ok(playable(C(null, 'wild4'), C('R', 'num', 1), 'R'));
  assert.ok(playable(C('G', 'num', 3), C(null, 'wild'), 'G'));
  assert.equal(cardPoints(C('R', 'draw2')), 20);
  assert.equal(cardPoints(C(null, 'wild')), 50);
});

test('action cards: skip, reverse, +2, wild +4', () => {
  const g = game(3);
  const [a, b, c] = g.players;
  g.turn = 0; g.dir = 1; g.color = 'R'; g.discard = [C('R', 'num', 5)];
  a.hand = [C('R', 'skip', null, 's1'), C('G', 'num', 1)];
  assert.ok(g.apply(a.id, { type: 'play', cardId: 's1' }).ok);
  assert.equal(g.current, c, 'b was skipped');
  c.hand = [C('R', 'rev', null, 'r1'), C('G', 'num', 1)];
  assert.ok(g.apply(c.id, { type: 'play', cardId: 'r1' }).ok);
  assert.equal(g.current, b, 'direction reversed');
  const before = a.hand.length;
  b.hand = [C('R', 'draw2', null, 'd2'), C('G', 'num', 1)];
  assert.ok(g.apply(b.id, { type: 'play', cardId: 'd2' }).ok);
  assert.equal(a.hand.length, before + 2);
  assert.equal(g.current, c, 'a drew 2 and was skipped');
  c.hand = [C(null, 'wild4', null, 'w4'), C('G', 'num', 1), C('Y', 'num', 2)];
  assert.equal(g.apply(c.id, { type: 'play', cardId: 'w4' }).key, 'uno.err.chooseColor');
  const bBefore = b.hand.length;
  assert.ok(g.apply(c.id, { type: 'play', cardId: 'w4', color: 'Y' }).ok);
  assert.equal(g.color, 'Y');
  assert.equal(b.hand.length, bBefore + 4);
  assert.equal(g.current, a);
});

test('reverse with two players works like skip', () => {
  const g = game(2);
  const [a] = g.players;
  g.turn = 0; g.color = 'R'; g.discard = [C('R', 'num', 5)];
  a.hand = [C('R', 'rev', null, 'r'), C('B', 'num', 1)];
  assert.ok(g.apply(a.id, { type: 'play', cardId: 'r' }).ok);
  assert.equal(g.current, a);
});

test('draw: play the drawn card or keep it', () => {
  const g = game(2);
  const [a, b] = g.players;
  g.turn = 0; g.color = 'R'; g.discard = [C('R', 'num', 5)];
  a.hand = [C('B', 'num', 1)];
  g.deck.push(C('R', 'num', 9, 'top'));
  assert.ok(g.apply(a.id, { type: 'draw' }).ok);
  assert.equal(g.drawn, 'top');
  assert.equal(g.apply(a.id, { type: 'draw' }).key, 'uno.err.alreadyDrew');
  assert.ok(g.apply(a.id, { type: 'pass' }).ok);
  assert.equal(g.current, b);
  b.hand = [C('B', 'num', 2), C('B', 'num', 3)];
  g.deck.push(C('G', 'num', 4));
  assert.ok(g.apply(b.id, { type: 'draw' }).ok, 'unplayable draw passes the turn');
  assert.equal(g.current, a);
});

test('missing UNO can be caught until the next player moves', () => {
  const g = game(3);
  const [a, b, c] = g.players;
  g.turn = 0; g.color = 'R'; g.discard = [C('R', 'num', 5)];
  a.hand = [C('R', 'num', 1, 'x'), C('R', 'num', 2)];
  assert.ok(g.apply(a.id, { type: 'play', cardId: 'x' }).ok);
  assert.equal(a.vulnerable, true);
  assert.ok(g.apply(c.id, { type: 'catch' }).ok);
  assert.equal(a.hand.length, 3);
  // with UNO called there is nothing to catch
  g.turn = 0; a.hand = [C('R', 'num', 1, 'y'), C('R', 'num', 2)];
  assert.ok(g.apply(a.id, { type: 'uno' }).ok);
  assert.ok(g.apply(a.id, { type: 'play', cardId: 'y' }).ok);
  assert.equal(g.apply(c.id, { type: 'catch' }).ok, false);
});

test('winner scores the others\' cards; votes start the next round', () => {
  const g = game(3);
  const [a, b, c] = g.players;
  g.turn = 0; g.color = 'R'; g.discard = [C('R', 'num', 5)];
  a.hand = [C('R', 'num', 1, 'last')];
  b.hand = [C('G', 'num', 7), C(null, 'wild')];
  c.hand = [C('B', 'skip')];
  assert.ok(g.apply(a.id, { type: 'play', cardId: 'last' }).ok);
  assert.equal(g.phase, 'roundOver');
  assert.equal(a.score, 7 + 50 + 20);
  for (const p of g.players) assert.ok(g.apply(p.id, { type: 'vote', yes: true }).ok);
  assert.equal(g.phase, 'play');
  assert.equal(g.round, 2);
});

test('log messages translate', () => {
  const g = game(2);
  const e = g.log.at(-1);
  assert.match(tr('de', e.key, e.params), /Runde 1/);
  assert.equal(tr('de', 'uno.log.wild', { name: 'A', card: { t: 'uno.sym.wild4' }, color: { t: 'uno.color.G' } }), 'A hat Farbwahl +4 gespielt und Grün gewählt');
  assert.equal(tr('en', 'uno.log.played', { name: 'A', card: { t: 'uno.card', p: { color: { t: 'uno.color.R' }, sym: '7' } } }), 'A played red 7');
});

test('bots finish whole games', () => {
  for (let n = 2; n <= 6; n++) {
    for (let r = 0; r < 10; r++) {
      const g = game(n);
      let steps = 0;
      while (g.phase !== 'gameOver' && steps < 200000) {
        const actor = g.actors[0];
        const action = botStep(g.view(actor.id));
        const res = g.apply(actor.id, action);
        assert.ok(res.ok, `${JSON.stringify(action)} → ${res.error}`);
        steps++;
        const total = g.players.reduce((s, p) => s + p.hand.length, 0) + g.deck.length + g.discard.length;
        if (g.phase === 'play') assert.equal(total, 108);
      }
      assert.equal(g.phase, 'gameOver');
      assert.ok(g.players.some(p => p.score >= 500));
    }
  }
});
