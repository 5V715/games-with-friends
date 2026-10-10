import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMeld, layOff, swapJoker } from '../public/js/rules.js';

const c = (s) => {
  if (s === 'X') return { id: 'X' + Math.random(), joker: true, rank: 0, suit: null };
  const suit = s.slice(-1);
  const r = s.slice(0, -1);
  const rank = { A: 1, J: 11, Q: 12, K: 13 }[r] || Number(r);
  return { id: s + Math.random(), suit, rank, joker: false };
};
const cards = (str) => str.split(' ').map(c);
const labels = (m) => m.slots.map(s => s.rank + s.suit);

test('sets', () => {
  assert.equal(analyzeMeld(cards('7H 7S 7D')).type, 'set');
  assert.equal(analyzeMeld(cards('7H 7S 7D')).points, 21);
  assert.equal(analyzeMeld(cards('AH AS AD AC')).points, 44);
  assert.equal(analyzeMeld(cards('7H 7H 7D')), null, 'duplicate suit');
  assert.equal(analyzeMeld(cards('7H 7S 7D 7C X')), null, 'max 4');
  assert.equal(analyzeMeld(cards('7H 7S')), null, 'min 3');
  assert.equal(analyzeMeld(cards('KH KS X')).points, 30);
});

test('runs', () => {
  assert.equal(analyzeMeld(cards('5H 6H 7H')).type, 'run');
  assert.equal(analyzeMeld(cards('5H 6H 7S')), null);
  assert.equal(analyzeMeld(cards('5H 7H 8H')), null);
  assert.equal(analyzeMeld(cards('AH 2H 3H')).points, 6);
  assert.equal(analyzeMeld(cards('QH KH AH')).points, 31);
  assert.equal(analyzeMeld(cards('KH AH 2H')), null, 'no wrap-around');
  const gap = analyzeMeld(cards('5H X 7H'));
  assert.deepEqual(labels(gap), ['5H', '6H', '7H']);
  const end = analyzeMeld(cards('JH QH KH X'));
  assert.deepEqual(labels(end), ['11H', '12H', '13H', '14H']);
  const low = analyzeMeld(cards('QH KH AH X'));
  assert.deepEqual(labels(low), ['11H', '12H', '13H', '14H']);
  assert.equal(analyzeMeld(cards('X X X')), null);
});

test('lay off keeps jokers in place', () => {
  const m = analyzeMeld(cards('5H X 7H'));
  assert.equal(layOff(m, cards('6H')), null, '6H must be swapped, not added');
  assert.deepEqual(labels(layOff(m, cards('8H'))), ['5H', '6H', '7H', '8H']);
  assert.deepEqual(labels(layOff(m, cards('4H'))), ['4H', '5H', '6H', '7H']);
  assert.equal(layOff(m, cards('8S')), null);
  const set = analyzeMeld(cards('9H 9S 9D'));
  assert.equal(layOff(set, cards('9C')).slots.length, 4);
  assert.equal(layOff(set, cards('9H')), null);
});

test('joker swap', () => {
  const m = analyzeMeld(cards('5H X 7H'));
  const joker = m.slots[1].card.id;
  assert.ok(swapJoker(m, joker, c('6H')));
  assert.equal(swapJoker(m, joker, c('6S')), null);
  const set = analyzeMeld(cards('9H 9S X'));
  const sj = set.slots.find(s => s.card.joker).card.id;
  assert.ok(swapJoker(set, sj, c('9C')));
  assert.ok(swapJoker(set, sj, c('9D')));
  assert.equal(swapJoker(set, sj, c('9H')), null);
  const high = analyzeMeld(cards('QH KH X'));
  const hj = high.slots.find(s => s.card.joker).card.id;
  assert.ok(swapJoker(high, hj, c('AH')));
});
