import test from 'node:test';
import assert from 'node:assert/strict';
import { DealGame, rentFor, isFull, fullColors, worth } from '../public/js/games/deal/engine.js';
import { createDealDeck } from '../public/js/games/deal/cards.js';
import { botStep } from '../public/js/games/deal/bot.js';
import { tr } from '../public/js/i18n.js';

let uid = 0;
const card = (c) => ({ id: 't' + (uid++), ...c });
const money = (v) => card({ type: 'money', value: v });
const prop = (color, value = 1) => card({ type: 'prop', color, value });
const act = (action, value = 1) => card({ type: 'action', action, value });

function game(n = 3) {
  const g = new DealGame();
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i, { bot: true });
  g.start();
  // deterministic setup: player 0's turn, empty tables
  g.turn = 0;
  g.playsLeft = 3;
  g.pending = null;
  for (const p of g.players) { p.hand = []; p.bank = []; p.props = []; p.buildings = {}; }
  return g;
}

test('deck: 106 cards', () => {
  const d = createDealDeck();
  assert.equal(d.length, 106);
  assert.equal(d.filter(c => c.type === 'money').length, 20);
  assert.equal(d.filter(c => c.type === 'prop').length, 28);
  assert.equal(d.filter(c => c.type === 'wild').length, 11);
  assert.equal(d.filter(c => c.type === 'rent').length, 13);
  assert.equal(d.filter(c => c.type === 'action').length, 34);
});

test('start: 5 cards each, current player drew 2', () => {
  const g = new DealGame();
  for (let i = 0; i < 3; i++) g.addPlayer('p' + i, 'P' + i);
  g.start();
  for (const p of g.players) assert.equal(p.hand.length, p === g.current ? 7 : 5);
  assert.equal(g.playsLeft, 3);
});

test('bank, property and the 3-play limit; hand limit 7', () => {
  const g = game();
  const [a] = g.players;
  const m = money(3), pr = prop('brown'), m2 = money(1), m3 = money(2);
  a.hand = [m, pr, m2, m3, ...Array.from({ length: 7 }, () => money(1))];
  assert.ok(g.apply(a.id, { type: 'bank', cardId: m.id }).ok);
  assert.equal(g.apply(a.id, { type: 'bank', cardId: pr.id }).key, 'deal.err.cannotBank');
  assert.equal(g.apply(a.id, { type: 'property', cardId: pr.id, color: 'red' }).key, 'deal.err.badColor');
  assert.ok(g.apply(a.id, { type: 'property', cardId: pr.id, color: 'brown' }).ok);
  assert.ok(g.apply(a.id, { type: 'bank', cardId: m2.id }).ok);
  assert.equal(g.apply(a.id, { type: 'bank', cardId: m3.id }).key, 'deal.err.noPlays');
  assert.ok(g.apply(a.id, { type: 'end' }).ok);
  assert.equal(g.phase, 'discard', '8 cards in hand');
  assert.equal(g.apply(a.id, { type: 'discard', cardIds: [m3.id, a.hand[1].id] }).key, 'deal.err.discardCount');
  assert.ok(g.apply(a.id, { type: 'discard', cardIds: [m3.id] }).ok);
  assert.equal(g.current.id, 'p1');
});

test('rent: everyone pays, no change, payer chooses', () => {
  const g = game();
  const [a, b, c] = g.players;
  a.props = [{ card: prop('red', 3), color: 'red' }, { card: prop('red', 3), color: 'red' }];
  const rent = card({ type: 'rent', colors: ['red', 'yellow'], value: 1 });
  a.hand = [rent];
  b.bank = [money(5)];
  c.bank = [money(1), money(1), money(2)];
  assert.equal(rentFor(a, 'red'), 3);
  assert.ok(g.apply(a.id, { type: 'action', cardId: rent.id, color: 'red' }).ok);
  assert.equal(g.pending.stage, 'pay');
  assert.equal(g.apply(c.id, { type: 'pay', cardIds: [] }).ok, false, 'not c\'s turn to decide');
  assert.ok(g.apply(b.id, { type: 'pay', cardIds: [b.bank[0].id] }).ok, 'pays 5 for 3, no change');
  assert.equal(g.apply(c.id, { type: 'pay', cardIds: [c.bank[0].id] }).key, 'deal.err.payMore');
  assert.ok(g.apply(c.id, { type: 'pay', cardIds: [c.bank[0].id, c.bank[2].id] }).ok);
  assert.equal(g.pending, null);
  assert.equal(worth(a), 3 + 3 + 5 + 3);
});

test('paying with properties moves them to the receiver; not enough = everything', () => {
  const g = game(2);
  const [a, b] = g.players;
  const debt = act('debt', 3);
  a.hand = [debt];
  b.props = [{ card: prop('green', 4), color: 'green' }];
  assert.ok(g.apply(a.id, { type: 'action', cardId: debt.id, target: b.id }).ok);
  assert.ok(g.apply(b.id, { type: 'pay', cardIds: [b.props[0].card.id] }).ok, 'all they have');
  assert.equal(a.props.length, 1);
  assert.equal(b.props.length, 0);
});

test('Just Say No and counter', () => {
  const g = game(2);
  const [a, b] = g.players;
  const debt = act('debt', 3), jsnA = act('jsn', 4), jsnB = act('jsn', 4);
  a.hand = [debt, jsnA];
  b.hand = [jsnB];
  b.bank = [money(5)];
  assert.ok(g.apply(a.id, { type: 'action', cardId: debt.id, target: b.id }).ok);
  assert.equal(g.pending.stage, 'respond');
  assert.ok(g.apply(b.id, { type: 'respond', jsn: true }).ok);
  assert.equal(g.pending.stage, 'counter');
  assert.ok(g.apply(a.id, { type: 'respond', jsn: true }).ok);
  assert.equal(g.pending.stage, 'pay', 'b has no more JSN: must pay');
  assert.ok(g.apply(b.id, { type: 'pay', cardIds: [b.bank[0].id] }).ok);
  assert.equal(a.bank.length, 1);

  const g2 = game(2);
  const [x, y] = g2.players;
  const bday = act('birthday', 2);
  x.hand = [bday];
  y.hand = [act('jsn', 4)];
  y.bank = [money(2)];
  assert.ok(g2.apply(x.id, { type: 'action', cardId: bday.id }).ok);
  assert.ok(g2.apply(y.id, { type: 'respond', jsn: true }).ok);
  assert.equal(g2.pending, null, 'x has no JSN: blocked');
  assert.equal(y.bank.length, 1);
});

test('sly deal, forced deal, deal breaker and buildings', () => {
  const g = game(2);
  const [a, b] = g.players;
  const sly = act('sly', 3), forced = act('forced', 3), db = act('dealbreaker', 5);
  b.props = [
    { card: prop('dblue', 4), color: 'dblue' }, { card: prop('dblue', 4), color: 'dblue' },
    { card: prop('pink', 2), color: 'pink' }, { card: prop('orange', 2), color: 'orange' },
  ];
  b.buildings = { dblue: { house: act('house', 3) } };
  a.props = [{ card: prop('brown', 1), color: 'brown' }];
  a.hand = [sly, forced, db];
  assert.equal(g.apply(a.id, { type: 'action', cardId: sly.id, target: b.id, propId: b.props[0].card.id }).key, 'deal.err.inFullSet');
  assert.ok(g.apply(a.id, { type: 'action', cardId: sly.id, target: b.id, propId: b.props[2].card.id }).ok);
  assert.equal(a.props.length, 2);
  const orange = b.props.find(e => e.color === 'orange').card.id;
  assert.ok(g.apply(a.id, { type: 'action', cardId: forced.id, target: b.id, propId: orange, myPropId: a.props[0].card.id }).ok);
  assert.ok(a.props.some(e => e.color === 'orange') && b.props.some(e => e.color === 'brown'));
  assert.ok(g.apply(a.id, { type: 'action', cardId: db.id, target: b.id, color: 'dblue' }).ok);
  assert.ok(isFull(a, 'dblue'));
  assert.ok(a.buildings.dblue.house, 'the house comes along');
  assert.equal(rentFor(a, 'dblue'), 8 + 3);
});

test('three complete sets win', () => {
  const g = game(2);
  const [a] = g.players;
  a.props = [
    { card: prop('brown'), color: 'brown' }, { card: prop('brown'), color: 'brown' },
    { card: prop('dblue', 4), color: 'dblue' }, { card: prop('dblue', 4), color: 'dblue' },
    { card: prop('util', 2), color: 'util' },
  ];
  const last = prop('util', 2);
  a.hand = [last];
  assert.ok(g.apply(a.id, { type: 'property', cardId: last.id, color: 'util' }).ok);
  assert.deepEqual(fullColors(a).sort(), ['brown', 'dblue', 'util']);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, a.id);
});

test('messages translate', () => {
  assert.equal(tr('de', 'deal.log.rent', { name: 'A', amount: 6, color: { t: 'deal.color.red' }, doubled: true }), 'A verlangt 6M Miete für Rot (verdoppelt)');
  assert.equal(tr('en', 'deal.card.wild', { colors: { t: 'deal.two', p: { a: { t: 'deal.color.red' }, b: { t: 'deal.color.yellow' } } } }), 'Wild Red/Yellow');
});

test('bots play complete games', () => {
  let winners = 0;
  for (let n = 2; n <= 5; n++) {
    for (let r = 0; r < 12; r++) {
      const g = new DealGame();
      for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i, { bot: true });
      g.start();
      let steps = 0;
      while (g.phase !== 'gameOver' && steps < 50000) {
        const actor = g.actors[0];
        const action = botStep(g.view(actor.id));
        const res = g.apply(actor.id, action);
        assert.ok(res.ok, `${JSON.stringify(action)} → ${res.error}`);
        steps++;
        const count = g.deck.length + g.discard.length + g.players.reduce((s, p) =>
          s + p.hand.length + p.bank.length + p.props.length +
          Object.values(p.buildings).reduce((t, b) => t + (b.house ? 1 : 0) + (b.hotel ? 1 : 0), 0), 0);
        assert.equal(count, 106, 'cards are conserved');
      }
      assert.equal(g.phase, 'gameOver', `game with ${n} players finished`);
      if (fullColors(g.player(g.winner)).length >= 3) winners++;
    }
  }
  assert.ok(winners >= 24, `at least half the games end with three sets (${winners}/48)`);
});
