import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../public/js/session.js';

// A host session without network; guests are faked as connected peers.
function table(game, guests = []) {
  const s = new HostSession({ name: 'Host', clientId: 'host', gameType: game });
  for (const id of guests) {
    s.game.addPlayer(id, id);
    s.playerToPeer.set(id, 'peer-' + id);
  }
  s.act({ type: 'addBot' });
  s.act({ type: 'start' });
  return s;
}
const finishRound = (s) => { s.game.phase = 'roundOver'; s.game.votes = {}; s.broadcast(); };

test('practice: the host alone picks, another round starts at once', () => {
  const s = table('kiez');
  finishRound(s);
  assert.ok(s.viewFor('host').next, 'vote is open');
  assert.deepEqual(s.viewFor('host').next.voters, ['host'], 'bots do not vote');
  assert.ok(s.act({ type: 'next', game: 'kiez' }).ok);
  assert.equal(s.game.phase, 'play');
  assert.equal(s.game.round, 2);
  assert.equal(s.viewFor('host').next, null);
});

test('everyone agrees on another game: it starts with the same players', () => {
  const s = table('kiez', ['g1']);
  finishRound(s);
  s.act({ type: 'next', game: 'uno' });
  assert.equal(s.game.type, 'kiez', 'waits for the guest');
  assert.ok(s.apply('g1', { type: 'next', game: 'uno' }).ok);
  assert.equal(s.game.type, 'uno');
  assert.equal(s.game.phase, 'play');
  assert.deepEqual(s.game.players.map(p => p.id).sort(), ['bot', 'g1', 'host'].map(x => s.game.players.find(p => p.id.startsWith(x))?.id).sort());
});

test('a split vote goes to the host; guests cannot decide', () => {
  const s = table('kiez', ['g1']);
  finishRound(s);
  s.act({ type: 'next', game: 'kiez' });
  s.apply('g1', { type: 'next', game: 'bomber' });
  const n = s.viewFor('g1').next;
  assert.equal(n.deciding, true);
  assert.ok(n.left > 0);
  assert.equal(s.apply('g1', { type: 'nextDecide', game: 'bomber' }).ok, false);
  assert.ok(s.act({ type: 'nextDecide', game: 'bomber' }).ok);
  assert.equal(s.game.type, 'bomber');
  clearInterval(s.loop);
});

test('games without enough seats cannot be chosen', () => {
  const s = table('romme', ['g1', 'g2', 'g3']); // host + 3 guests + bot = 5
  finishRound(s);
  assert.ok(!s.viewFor('host').next.playable.includes('kiez'), 'Knobel-Kiez seats 4');
  assert.equal(s.act({ type: 'next', game: 'kiez' }).ok, false);
});
