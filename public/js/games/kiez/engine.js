// Knobel-Kiez: the classic five-dice game (authoritative, runs on the host).
//
// Each turn you roll five dice up to three times, holding any dice between
// rolls, then enter the result in one free box of your sheet. After 13 turns
// each the highest total wins. Upper section: 35 bonus points from 63 on.
// Five of a kind ("Kiez-König") scores 50; every further one adds a 50 bonus
// and may also count as a joker for full house and the straights.
// After a game everyone votes on another one; totals add up across games.

import './strings.js';
import { GameError } from '../../engine.js';

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
export const ROLLS = 3;
export const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER = ['three', 'four', 'full', 'small', 'large', 'king', 'chance'];
export const CATEGORIES = [...UPPER, ...LOWER];
export const BONUS_AT = 63;
export const BONUS = 35;
export const KING_BONUS = 50;

const fail = (key, params) => { throw new GameError(key, params); };

function randomDie() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(1);
    do c.getRandomValues(b); while (b[0] >= 252); // 252 = 6 * 42, no modulo bias
    return (b[0] % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}

const sum = (dice) => dice.reduce((s, d) => s + d, 0);
const counts = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
};
const hasRun = (dice, len) => {
  const have = new Set(dice);
  for (let start = 1; start + len - 1 <= 6; start++) {
    let ok = true;
    for (let v = start; v < start + len; v++) if (!have.has(v)) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};
export const isKing = (dice) => dice.length === 5 && dice.every(d => d === dice[0]);

// Points `dice` would score in `cat`. `joker`: a further five of a kind,
// which counts as full house and both straights.
export function scoreFor(cat, dice, { joker = false } = {}) {
  const c = counts(dice);
  const i = UPPER.indexOf(cat);
  if (i >= 0) return c[i + 1] * (i + 1);
  const max = Math.max(...c);
  switch (cat) {
    case 'three': return max >= 3 ? sum(dice) : 0;
    case 'four': return max >= 4 ? sum(dice) : 0;
    case 'full': return joker || (c.includes(3) && c.includes(2)) ? 25 : 0;
    case 'small': return joker || hasRun(dice, 4) ? 30 : 0;
    case 'large': return joker || hasRun(dice, 5) ? 40 : 0;
    case 'king': return isKing(dice) ? 50 : 0;
    case 'chance': return sum(dice);
    default: return 0;
  }
}

export function totals(sheet, kingBonus = 0) {
  const upper = UPPER.reduce((s, k) => s + (sheet[k] ?? 0), 0);
  const bonus = upper >= BONUS_AT ? BONUS : 0;
  const lower = LOWER.reduce((s, k) => s + (sheet[k] ?? 0), 0);
  return { upper, bonus, lower, kingBonus, total: upper + bonus + lower + kingBonus };
}

// A further five of a kind once the Kiez-König box holds 50.
export const jokerFor = (sheet, dice) => isKing(dice) && sheet.king != null;

const emptySheet = () => Object.fromEntries(CATEGORIES.map(k => [k, null]));

export class KiezGame {
  constructor({ rng = randomDie } = {}) {
    this.type = 'kiez';
    this.rng = rng;
    this.phase = 'lobby';
    this.players = [];
    this.round = 0;
    this.gameNo = 0;
    this.starter = -1;
    this.turn = 0;
    this.dice = [1, 1, 1, 1, 1];
    this.held = [false, false, false, false, false];
    this.rollsLeft = ROLLS;
    this.rollNo = 0; // counts every roll, so clients can animate new ones
    this.result = null;
    this.history = [];
    this.votes = {};
    this.log = [];
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') fail('err.gameStarted');
    if (this.players.length >= MAX_PLAYERS) fail('err.tableFull');
    if (this.player(id)) return this.player(id);
    const p = { id, name: String(name || 'Player').slice(0, 20), bot, sheet: emptySheet(), kings: 0, score: 0 };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    if (this.phase === 'lobby') this.players = this.players.filter(p => p.id !== id);
  }

  player(id) {
    return this.players.find(p => p.id === id);
  }

  get current() {
    return this.players[this.turn];
  }

  get pendingVoters() {
    return this.phase === 'roundOver' ? this.players.filter(p => !(p.id in this.votes)) : [];
  }

  get actors() {
    if (this.phase === 'play') return [this.current];
    return this.pendingVoters;
  }

  say(key, params = {}) {
    this.log.push({ key, params });
    if (this.log.length > 40) this.log.shift();
  }

  start() {
    if (this.players.length < MIN_PLAYERS) fail('err.minPlayers', { n: MIN_PLAYERS });
    this.round = 0;
    this.gameNo++;
    this.history = [];
    for (const p of this.players) p.score = 0;
    this.starter = Math.floor(Math.random() * this.players.length) - 1;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.votes = {};
    this.result = null;
    for (const p of this.players) { p.sheet = emptySheet(); p.kings = 0; }
    this.starter = (this.starter + 1) % this.players.length;
    this.turn = this.starter;
    this.phase = 'play';
    this.#newTurn();
    this.say('kiez.log.start', { round: this.round, name: this.current.name });
  }

  #newTurn() {
    this.held = [false, false, false, false, false];
    this.rollsLeft = ROLLS;
  }

  apply(playerId, action) {
    try {
      this.#apply(playerId, action || {});
      return { ok: true };
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      return { ok: false, error: e.message, key: e.key, params: e.params };
    }
  }

  #apply(playerId, action) {
    const p = this.player(playerId);
    if (!p) fail('err.unknownPlayer');
    if (action.type === 'vote') return this.#vote(p, action.yes);
    if (this.phase !== 'play') fail('err.noRound');
    if (this.current !== p) fail('err.notYourTurn');
    switch (action.type) {
      case 'hold': return this.#hold(action.index);
      case 'roll': return this.#roll(p, action.held);
      case 'score': return this.#score(p, action.cat);
      default: fail('err.unknownAction');
    }
  }

  #hold(index) {
    if (this.rollsLeft === ROLLS) fail('kiez.err.rollFirst');
    if (!Number.isInteger(index) || index < 0 || index > 4) fail('err.badAction');
    this.held[index] = !this.held[index];
  }

  #roll(p, held) {
    if (this.rollsLeft <= 0) fail('kiez.err.noRolls');
    if (this.rollsLeft < ROLLS && Array.isArray(held) && held.length === 5) this.held = held.map(Boolean);
    if (this.rollsLeft === ROLLS) this.held = [false, false, false, false, false];
    this.dice = this.dice.map((d, i) => (this.held[i] ? d : this.rng()));
    this.rollsLeft--;
    this.rollNo++;
    if (isKing(this.dice)) this.say('kiez.log.king', { name: p.name });
  }

  #score(p, cat) {
    if (this.rollsLeft === ROLLS) fail('kiez.err.rollFirst');
    if (!CATEGORIES.includes(cat)) fail('err.badAction');
    if (p.sheet[cat] != null) fail('kiez.err.taken');
    const joker = jokerFor(p.sheet, this.dice);
    if (joker && p.sheet.king === 50) {
      p.kings++;
      this.say('kiez.log.kingBonus', { name: p.name, n: KING_BONUS });
    }
    const pts = scoreFor(cat, this.dice, { joker });
    p.sheet[cat] = pts;
    this.say('kiez.log.scored', { name: p.name, cat: { t: `kiez.cat.${cat}` }, n: pts });
    const done = this.players.every(o => CATEGORIES.every(k => o.sheet[k] != null));
    if (done) return this.#endRound();
    this.turn = (this.turn + 1) % this.players.length;
    this.#newTurn();
  }

  #endRound() {
    const gained = {};
    for (const p of this.players) {
      gained[p.id] = totals(p.sheet, p.kings * KING_BONUS).total;
      p.score += gained[p.id];
    }
    const best = Math.max(...Object.values(gained));
    const winner = this.players.find(p => gained[p.id] === best);
    this.result = { winner: winner.id, gained, points: best };
    this.history.push({ round: this.round, winner: winner.id, gained });
    this.votes = {};
    this.phase = 'roundOver';
    this.say('kiez.log.won', { name: winner.name, round: this.round, points: best });
  }

  #vote(p, yes) {
    if (this.phase !== 'roundOver') fail('err.noVote');
    this.votes[p.id] = !!yes;
    if (this.pendingVoters.length) return;
    const all = Object.values(this.votes);
    const ayes = all.filter(Boolean).length;
    if (ayes >= all.length - ayes) return this.startRound();
    this.phase = 'gameOver';
    const best = this.players.reduce((a, b) => (b.score > a.score ? b : a));
    this.say('kiez.log.gameOver', { name: best.name, points: best.score });
  }

  view(playerId) {
    return {
      game: 'kiez',
      you: playerId,
      phase: this.phase,
      round: this.round,
      gameNo: this.gameNo,
      turn: this.phase === 'play' ? this.current.id : null,
      dice: this.dice.slice(),
      held: this.held.slice(),
      rollsLeft: this.rollsLeft,
      rolled: this.rollsLeft < ROLLS,
      rollNo: this.rollNo,
      hand: [], // the shared screen keeps a hand order for card games
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, score: p.score, kings: p.kings,
        sheet: { ...p.sheet }, total: totals(p.sheet, p.kings * KING_BONUS).total,
      })),
      result: this.result,
      history: this.history,
      votes: this.votes,
      log: this.log.slice(-6),
    };
  }
}
