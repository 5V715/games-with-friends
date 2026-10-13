import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine.js';
import { botStep } from '../public/js/bot.js';

function newGame(n) {
  const g = new Game();
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i, { bot: true });
  g.start();
  assert.equal(g.phase, 'cut');
  assert.ok(g.apply(g.cutter.id, { type: 'cut', at: Math.random() }).ok);
  return g;
}

// Plays the opening move (the starting player only discards), so the next
// player is in the normal draw phase.
function afterOpening(n) {
  const g = newGame(n);
  assert.ok(g.apply(g.current.id, { type: 'discard', cardId: g.current.hand[0].id }).ok);
  return g;
}

test('deal', () => {
  const g = newGame(3);
  assert.equal(g.phase, 'play', 'starting player skips the draw');
  for (const p of g.players) assert.equal(p.hand.length, p === g.current ? 13 : 12);
  const jokers = g.cutResult.kept.length;
  assert.equal(g.cutResult.peek.length, 3);
  assert.equal(g.discard.length, 0);
  assert.equal(g.stock.length, 110 - 36 - 1);
  const first = g.current;
  assert.ok(g.apply(first.id, { type: 'discard', cardId: first.hand[0].id }).ok);
  assert.equal(first.hand.length, 12);
  assert.equal(g.discard.length, 1);
  assert.equal(g.phase, 'draw');
  assert.ok(g.apply(g.current.id, { type: 'draw', from: 'stock' }).ok);
  assert.equal(g.current.hand.length, 13);
});

test('turn enforcement', () => {
  const g = afterOpening(2);
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
  assert.equal(v.hand.length, g.player('p0').hand.length);
  assert.ok(!('hand' in v.players[1]));
  assert.equal(v.players[1].count, g.player('p1').hand.length);
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
  const g = afterOpening(2);
  const p = g.current;
  const res = g.apply(p.id, { type: 'draw', from: 'discard' });
  assert.equal(res.ok, false);
  assert.match(res.error, /once you are out/);
  p.cameOut = true;
  assert.ok(g.apply(p.id, { type: 'draw', from: 'discard' }).ok);
});

test('first meld needs 40 points; lay off and swap need to be out and on turn', () => {
  const g = afterOpening(2);
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

test('cutting: only the cutter, jokers at the cut are kept and count towards 12', () => {
  for (let i = 0; i < 300; i++) {
    const g = new Game();
    for (let k = 0; k < 3; k++) g.addPlayer('p' + k, 'P' + k, { bot: true });
    g.start();
    const cutter = g.cutter;
    const other = g.players.find(p => p !== cutter);
    assert.equal(g.apply(other.id, { type: 'cut', at: 0.5 }).ok, false);
    assert.equal(g.apply(g.current.id, { type: 'draw', from: 'stock' }).ok, false, 'no play before the cut');
    assert.ok(g.apply(cutter.id, { type: 'cut', at: i / 299 }).ok);
    assert.equal(g.apply(cutter.id, { type: 'cut', at: 0.5 }).ok, false, 'only once');
    const { peek, kept } = g.cutResult;
    assert.deepEqual(kept, peek.filter(c => c.joker).map(c => c.id));
    for (const id of kept) assert.ok(cutter.hand.some(c => c.id === id), 'cutter keeps the joker');
    for (const p of g.players) assert.equal(p.hand.length, p === g.current ? 13 : 12);
    const total = g.players.reduce((n, p) => n + p.hand.length, 0) + g.stock.length + g.discard.length;
    assert.equal(total, 110);
    assert.equal(g.view(cutter.id).cut.peek.length, 3, 'cutter sees the cut');
    assert.equal(g.view(other.id).cut, null, 'others do not');
  }
});

test('a joker at the cut point goes to the cutter', () => {
  const g = new Game();
  g.addPlayer('a', 'A');
  g.addPlayer('b', 'B');
  g.start();
  // Put a joker exactly where a cut at 0 lands (index 3).
  const j = g.stock.findIndex(c => c.joker);
  [g.stock[3], g.stock[j]] = [g.stock[j], g.stock[3]];
  const jokerId = g.stock[3].id;
  assert.ok(g.apply(g.cutter.id, { type: 'cut', at: 0 }).ok);
  assert.ok(g.cutter.hand.some(c => c.id === jokerId));
  assert.ok(g.cutResult.kept.includes(jokerId));
});

// Helper: a 3-player game after the cut, with the current player about to go
// out by melding everything (7-8-9-10♥ = 34 + K♠ K♥ K♦ = 30 → 64 points).
function goingOut() {
  const g = newGame(3);
  const p = g.current;
  const c = (id, suit, rank) => ({ id, suit, rank, joker: false });
  p.hand = [c('a', 'H', 7), c('b', 'H', 8), c('c', 'H', 9), c('d', 'H', 10), c('e', 'S', 13), c('f', 'H', 13), c('g', 'D', 13)];
  g.phase = 'play';
  return g;
}
const outMove = { type: 'meld', groups: [['a', 'b', 'c', 'd'], ['e', 'f', 'g']] };
const handPenalty = (pl) => pl.hand.reduce((s, x) => s + (x.joker ? 20 : x.rank === 1 ? 11 : x.rank >= 10 ? 10 : x.rank), 0);

test('winner scores 0, others their cards; "Hand" doubles only if nobody was out', () => {
  const g = goingOut();
  const p = g.current;
  const others = g.players.filter(x => x !== p);
  const expected = others.map(handPenalty);
  assert.ok(g.apply(p.id, outMove).ok);
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.result.handRomme, true);
  assert.equal(g.result.penalties[p.id], 0);
  others.forEach((o, i) => assert.equal(g.result.penalties[o.id], expected[i] * 2));

  const g2 = goingOut();
  const p2 = g2.current;
  const other = g2.players.find(x => x !== p2);
  other.cameOut = true; // someone else is already out → no Hand
  const exp2 = handPenalty(other);
  assert.ok(g2.apply(p2.id, outMove).ok);
  assert.equal(g2.result.handRomme, false);
  assert.equal(g2.result.penalties[other.id], exp2);
});

test('voting: majority decides, a tie plays on, then game over', () => {
  const g = goingOut();
  const [a, b, c] = g.players;
  g.apply(g.current.id, outMove);
  assert.equal(g.history.length, 1);
  assert.equal(g.apply(a.id, { type: 'cut', at: 0.5 }).ok, false);
  assert.ok(g.apply(a.id, { type: 'vote', yes: false }).ok);
  assert.ok(g.apply(b.id, { type: 'vote', yes: true }).ok);
  assert.equal(g.phase, 'roundOver', 'waits for everyone');
  assert.ok(g.apply(b.id, { type: 'vote', yes: false }).ok, 'votes can be changed');
  assert.ok(g.apply(c.id, { type: 'vote', yes: true }).ok);
  assert.equal(g.phase, 'gameOver', '2 of 3 want to stop');
  assert.equal(g.log.at(-1).key, 'log.gameOver');
  assert.equal(g.apply(a.id, { type: 'vote', yes: true }).ok, false);

  const g2 = newGame(2);
  const [x, y] = g2.players;
  g2.phase = 'roundOver';
  g2.votes = {};
  g2.apply(x.id, { type: 'vote', yes: true });
  g2.apply(y.id, { type: 'vote', yes: false });
  assert.equal(g2.phase, 'cut', 'tie → next round');
  assert.equal(g2.round, 2);
});

test('bots vote to play on', () => {
  const g = goingOut();
  g.apply(g.current.id, outMove);
  for (const p of g.players) {
    const action = botStep(g.view(p.id));
    assert.deepEqual(action, { type: 'vote', yes: true });
  }
});
