import test from 'node:test';
import assert from 'node:assert/strict';
import { _strings, tr, LANGS } from '../public/js/i18n.js';
import { Game } from '../public/js/engine.js';

const placeholders = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort() : null);

test('every language has every key, with the same placeholders', () => {
  const en = _strings.en;
  for (const code of Object.keys(LANGS)) {
    const other = _strings[code];
    for (const key of Object.keys(en)) {
      assert.ok(key in other, `${code} is missing ${key}`);
      assert.equal(typeof other[key], typeof en[key], `${code}.${key} type`);
      assert.deepEqual(placeholders(other[key]), placeholders(en[key]), `${code}.${key} placeholders`);
    }
    for (const key of Object.keys(other)) assert.ok(key in en, `${code} has unknown key ${key}`);
  }
});

test('translation with parameters, plurals and fallback', () => {
  assert.equal(tr('en', 'err.minPlayers', { n: 2 }), 'Need at least 2 players');
  assert.equal(tr('de', 'err.minPlayers', { n: 2 }), 'Es braucht mindestens 2 Spieler');
  assert.equal(tr('fr', 'err.minPlayers', { n: 2 }), 'Need at least 2 players', 'unknown language falls back to English');
  assert.equal(tr('de', 'no.such.key'), 'no.such.key');
  assert.match(tr('de', 'log.cut', { name: 'Ada', kept: 1, starter: 'Bo' }), /einen Joker/);
  assert.match(tr('de', 'log.cut', { name: 'Ada', kept: 2, starter: 'Bo' }), /2 Joker/);
  assert.match(tr('en', 'log.cut', { name: 'Ada', kept: 0, starter: 'Bo' }), /no joker\. Bo starts/);
});

test('engine errors and log entries carry translation keys', () => {
  const g = new Game();
  g.addPlayer('a', 'Anna');
  g.addPlayer('b', 'Ben');
  g.start();
  const res = g.apply(g.current.id, { type: 'draw', from: 'stock' });
  assert.equal(res.ok, false);
  assert.equal(res.key, 'err.waitCut');
  assert.equal(res.params.name, g.cutter.name);
  assert.equal(res.error, `Waiting for ${g.cutter.name} to cut the deck`);
  assert.equal(tr('de', res.key, res.params), `Warte, bis ${g.cutter.name} abgehoben hat`);
  const entry = g.view('a').log.at(-1);
  assert.equal(entry.key, 'log.roundCut');
  assert.equal(tr('de', entry.key, entry.params), `Runde 1 — ${g.cutter.name} hebt ab`);
});
