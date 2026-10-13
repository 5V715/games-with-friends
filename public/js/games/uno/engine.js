// UNO rules engine (authoritative, runs on the host).
//
// 108 cards: per color (R, Y, G, B) one 0, two each of 1–9, Skip, Reverse
// and +2; plus 4 Wild and 4 Wild +4. Everyone gets 7 cards. Match the top
// card by color, number or symbol, or play a wild. If you can't (or don't
// want to), draw one card; you may play it right away if it fits.
// The round winner scores the cards left in everyone else's hand; the first
// to 500 wins the game. Between rounds everyone votes on another round.

import './strings.js';
import { shuffle } from '../../cards.js';
import { GameError } from '../../engine.js';

export const COLORS = ['R', 'Y', 'G', 'B'];
export const HAND_SIZE = 7;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TARGET_SCORE = 500;

const fail = (key, params) => { throw new GameError(key, params); };

export function createUnoDeck() {
  const cards = [];
  let n = 0;
  const add = (color, kind, value = null) => cards.push({ id: `u${n++}`, color, kind, value });
  for (const c of COLORS) {
    add(c, 'num', 0);
    for (let v = 1; v <= 9; v++) { add(c, 'num', v); add(c, 'num', v); }
    for (const k of ['skip', 'rev', 'draw2']) { add(c, k); add(c, k); }
  }
  for (let i = 0; i < 4; i++) { add(null, 'wild'); add(null, 'wild4'); }
  return cards;
}

export function cardPoints(card) {
  if (card.kind === 'num') return card.value;
  if (card.kind === 'wild' || card.kind === 'wild4') return 50;
  return 20;
}

// Translatable label, e.g. { t: 'uno.card', p: { color: {t:'uno.color.R'}, sym: 7 } }.
export function cardLabel(card) {
  if (card.kind === 'wild' || card.kind === 'wild4') return { t: `uno.sym.${card.kind}` };
  const sym = card.kind === 'num' ? String(card.value) : { t: `uno.sym.${card.kind}` };
  return { t: 'uno.card', p: { color: { t: `uno.color.${card.color}` }, sym } };
}

export function playable(card, top, color) {
  if (card.kind === 'wild' || card.kind === 'wild4') return true;
  if (card.color === color) return true;
  if (card.kind === 'num') return top.kind === 'num' && top.value === card.value;
  return top.kind === card.kind;
}

export class UnoGame {
  constructor() {
    this.type = 'uno';
    this.phase = 'lobby';
    this.players = [];
    this.round = 0;
    this.gameNo = 0;
    this.dealer = -1;
    this.deck = [];
    this.discard = [];
    this.color = null;
    this.dir = 1;
    this.turn = 0;
    this.drawn = null; // id of the card drawn this turn (may still be played)
    this.result = null;
    this.history = [];
    this.votes = {};
    this.log = [];
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') fail('err.gameStarted');
    if (this.players.length >= MAX_PLAYERS) fail('err.tableFull');
    if (this.player(id)) return this.player(id);
    const p = { id, name: String(name || 'Player').slice(0, 20), bot, hand: [], score: 0, unoCalled: false, vulnerable: false };
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

  get top() {
    return this.discard[this.discard.length - 1];
  }

  get pendingVoters() {
    return this.phase === 'roundOver' ? this.players.filter(p => !(p.id in this.votes)) : [];
  }

  // Players who have to act now (used to drive bots and away players).
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
    this.dealer = Math.floor(Math.random() * this.players.length);
    this.startRound();
  }

  startRound() {
    this.round++;
    this.votes = {};
    this.result = null;
    this.dealer = (this.dealer + 1) % this.players.length;
    this.deck = shuffle(createUnoDeck());
    for (const p of this.players) {
      p.hand = this.deck.splice(0, HAND_SIZE);
      p.unoCalled = false;
      p.vulnerable = false;
    }
    // The first discard is always a number card.
    let i = this.deck.findIndex(c => c.kind === 'num');
    this.discard = this.deck.splice(i, 1);
    this.color = this.top.color;
    this.dir = 1;
    this.turn = (this.dealer + 1) % this.players.length;
    this.drawn = null;
    this.phase = 'play';
    this.say('uno.log.start', { round: this.round, name: this.current.name });
  }

  #step(steps = 1) {
    const n = this.players.length;
    return (((this.turn + this.dir * steps) % n) + n) % n;
  }

  #drawCards(p, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) {
        const top = this.discard.pop();
        this.deck = shuffle(this.discard);
        this.discard = top ? [top] : [];
        if (this.deck.length) this.say('uno.log.reshuffle');
      }
      const c = this.deck.pop();
      if (!c) break;
      p.hand.push(c);
      got.push(c);
    }
    if (got.length) p.unoCalled = false;
    return got;
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
    switch (action.type) {
      case 'vote': return this.#vote(p, action.yes);
      case 'uno': return this.#callUno(p);
      case 'catch': return this.#catch(p);
      default: break;
    }
    if (this.phase !== 'play') fail('err.noRound');
    if (this.current !== p) fail('err.notYourTurn');
    switch (action.type) {
      case 'play': this.#play(p, action); break;
      case 'draw': this.#draw(p); break;
      case 'pass': this.#pass(p); break;
      default: fail('err.unknownAction');
    }
    // The next player's move closes the window for catching a missed UNO.
    for (const o of this.players) if (o !== p) o.vulnerable = false;
  }

  #callUno(p) {
    if (this.phase !== 'play' || p.hand.length > 2) fail('uno.err.noUno');
    if (!p.unoCalled) this.say('uno.log.uno', { name: p.name });
    p.unoCalled = true;
    p.vulnerable = false;
  }

  #catch(catcher) {
    const target = this.players.find(o => o.vulnerable && o !== catcher);
    if (this.phase !== 'play' || !target) fail('uno.err.cannotCatch');
    target.vulnerable = false;
    this.#drawCards(target, 2);
    this.say('uno.log.caught', { catcher: catcher.name, name: target.name });
  }

  #play(p, { cardId, color, uno }) {
    const card = p.hand.find(c => c.id === cardId);
    if (!card) fail('err.notInHand');
    if (this.drawn && card.id !== this.drawn) fail('uno.err.onlyDrawn');
    if (!playable(card, this.top, this.color)) fail('uno.err.notPlayable');
    const wild = card.kind === 'wild' || card.kind === 'wild4';
    if (wild && !COLORS.includes(color)) fail('uno.err.chooseColor');
    if (uno && p.hand.length <= 2) p.unoCalled = true;

    p.hand = p.hand.filter(c => c !== card);
    this.discard.push(card);
    this.color = wild ? color : card.color;
    this.drawn = null;
    if (wild) this.say('uno.log.wild', { name: p.name, card: cardLabel(card), color: { t: `uno.color.${color}` } });
    else this.say('uno.log.played', { name: p.name, card: cardLabel(card) });

    const n = this.players.length;
    let steps = 1;
    if (card.kind === 'skip') steps = 2;
    else if (card.kind === 'rev') {
      this.dir = -this.dir;
      if (n === 2) steps = 2;
    } else if (card.kind === 'draw2' || card.kind === 'wild4') {
      const victim = this.players[this.#step(1)];
      const got = this.#drawCards(victim, card.kind === 'draw2' ? 2 : 4);
      this.say('uno.log.drew', { name: victim.name, n: got.length });
      steps = 2;
    }

    if (!p.hand.length) return this.#endRound(p);
    if (p.hand.length === 1 && !p.unoCalled) p.vulnerable = true;
    this.turn = this.#step(steps);
  }

  #draw(p) {
    if (this.drawn) fail('uno.err.alreadyDrew');
    const [card] = this.#drawCards(p, 1);
    this.say('uno.log.drew', { name: p.name, n: card ? 1 : 0 });
    if (card && playable(card, this.top, this.color)) {
      this.drawn = card.id; // may play it now, or keep it with "pass"
      return;
    }
    this.turn = this.#step(1);
  }

  #pass(p) {
    if (!this.drawn) fail('uno.err.cannotPass');
    this.drawn = null;
    this.say('uno.log.passed', { name: p.name });
    this.turn = this.#step(1);
  }

  #endRound(winner) {
    const gained = {};
    let points = 0;
    for (const o of this.players) {
      const pts = o.hand.reduce((s, c) => s + cardPoints(c), 0);
      gained[o.id] = 0;
      points += pts;
    }
    gained[winner.id] = points;
    winner.score += points;
    const hands = Object.fromEntries(this.players.map(o => [o.id, o.hand.slice()]));
    this.result = { winner: winner.id, points, gained, hands };
    this.history.push({ round: this.round, winner: winner.id, gained });
    this.votes = {};
    this.say('uno.log.won', { name: winner.name, round: this.round, points });
    if (winner.score >= TARGET_SCORE) {
      this.phase = 'gameOver';
      this.say('uno.log.gameOver', { name: winner.name, points: winner.score });
    } else {
      this.phase = 'roundOver';
    }
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
    this.say('uno.log.gameOver', { name: best.name, points: best.score });
  }

  view(playerId) {
    const me = this.player(playerId);
    const cur = this.phase === 'play' ? this.current : null;
    return {
      game: 'uno',
      you: playerId,
      phase: this.phase,
      round: this.round,
      gameNo: this.gameNo,
      turn: cur?.id || null,
      dir: this.dir,
      color: this.color,
      top: this.top || null,
      deckCount: this.deck.length,
      drawn: cur?.id === playerId ? this.drawn : null,
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, count: p.hand.length, score: p.score,
        uno: p.unoCalled && p.hand.length <= 2, vulnerable: p.vulnerable,
      })),
      hand: me ? me.hand.slice() : [],
      target: TARGET_SCORE,
      result: this.result,
      history: this.history,
      votes: this.votes,
      log: this.log.slice(-6),
    };
  }
}
