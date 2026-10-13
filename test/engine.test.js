import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine.js';
import { botStep } from '../public/js/bot.js';

function newGame(n) {
  const g = new Game();
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i, { bot: true });
  g.start();
  return g;
}

test('deal', () => {
  const g = newGame(3);
  assert.equal(g.phase, 'draw');
  for (const p of g.players) assert.equal(p.hand.length, 13);
  assert.equal(g.discard.length, 1);
  assert.equal(g.stock.length, 110 - 39 - 1);
});

test('turn enforcement', () => {
  const g = newGame(2);
  const other = g.players.find(p => p !== g.current);
  assert.equal(g.apply(other.id, { type: 'draw' }).ok, false);
  assert.equal(g.apply(g.current.id, { type: 'discard', cardId: g.current.hand[0].id }).error, 'Draw a card first');
  const me = g.current;
  me.cameOut = true;
  assert.ok(g.apply(me.id, { type: 'draw', from: 'discard' }).ok);
  const picked = g.drawnFromDiscard;
  assert.equal(g.apply(me.id, { type: 'discard', cardId: picked }).ok, false);
  assert.equal(g.apply(me.id, { type: 'layoff', meldId: 1, cardIds: [me.hand[0].id] }).ok, false);
});

test('views hide other hands', () => {
  const g = newGame(2);
  const v = g.view('p0');
  assert.equal(v.hand.length, 13);
  assert.ok(!('hand' in v.players[1]));
  assert.equal(v.players[1].count, 13);
});

test('bots can finish many rounds without getting stuck', () => {
  for (let n = 2; n <= 6; n++) {
    for (let r = 0; r < 15; r++) {
      const g = newGame(n);
      let steps = 0;
      while (g.phase !== 'roundOver') {
        const id = g.current.id;
        const action = botStep(g.view(id));
        const res = g.apply(id, action);
        assert.ok(res.ok, `${JSON.stringify(action)}: ${res.error}`);
        assert.ok(++steps < 20000, 'game did not finish');
      }
      const total = g.players.reduce((s, p) => s + p.hand.length, 0) +
        g.stock.length + g.discard.length + g.melds.reduce((s, m) => s + m.slots.length, 0);
      assert.equal(total, 110, 'cards are conserved');
      assert.ok(g.result.winner);
    }
  }
});

test('discard pile is only available once you are out', () => {
  const g = newGame(2);
  const p = g.current;
  const res = g.apply(p.id, { type: 'draw', from: 'discard' });
  assert.equal(res.ok, false);
  assert.match(res.error, /once you are out/);
  p.cameOut = true;
  assert.ok(g.apply(p.id, { type: 'draw', from: 'discard' }).ok);
});

test('first meld needs 40 points; lay off and swap need to be out and on turn', () => {
  const g = newGame(2);
  const p = g.current;
  const other = g.players.find(x => x !== p);
  const card = (id, suit, rank) => ({ id, suit, rank, joker: false });
  // 9-9-9 (27) + 2-3-4 (9) = 36 < 40
  p.hand = [card('a', 'H', 9), card('b', 'S', 9), card('c', 'D', 9),
    card('d', 'C', 2), card('e', 'C', 3), card('f', 'C', 4), card('g', 'H', 13), card('h', 'S', 13)];
  assert.ok(g.apply(p.id, { type: 'draw', from: 'stock' }).ok);
  const short = g.apply(p.id, { type: 'meld', groups: [['a', 'b', 'c'], ['d', 'e', 'f']] });
  assert.match(short.error, /40 points/);
  p.hand.push(card('i', 'C', 5));
  assert.ok(g.apply(p.id, { type: 'meld', groups: [['a', 'b', 'c'], ['d', 'e', 'f', 'i']] }).ok); // 27 + 14 = 41
  // the other player is not out and it's not their turn
  other.hand.push(card('z', 'C', 6));
  assert.equal(g.apply(other.id, { type: 'layoff', meldId: g.melds[1].id, cardIds: ['z'] }).ok, false);
  other.cameOut = true;
  assert.match(g.apply(other.id, { type: 'layoff', meldId: g.melds[1].id, cardIds: ['z'] }).error, /not your turn/);
});
