// Authoritative Rommé game state. Runs on the host (or in practice mode);
// guests only ever see the per-player views produced by view().
//
// Round start: the player before the dealer cuts the deck ("abheben") and
// looks at the 3 cards at the cut; any jokers among them they keep (they
// count towards their 12 cards). Then everyone gets 12 cards, the starter 13.
//
// Turn flow: draw (stock, or the discard pile once you are out) → optionally
// meld / lay off / swap jokers → discard one card. A player's first meld must
// be worth at least 40 points; laying off and joker swaps need you to be out. The round ends when a player has no cards left; everyone else
// scores penalty points for the cards still in their hand (doubled when the
// winner went out in one go while nobody else was out — "Hand").
//
// After a round everyone votes whether to play another one; the majority
// decides (a tie means play on). Otherwise the game is over and the lowest
// total score wins.

import { createDeck, shuffle, penalty } from './cards.js';
import { analyzeMeld, layOff, swapJoker, MIN_INITIAL_MELD } from './rules.js';
import { tr } from './i18n.js';

// Errors carry a translation key + params; `message` is the English text.
export class GameError extends Error {
  constructor(key, params = {}) {
    super(tr('en', key, params));
    this.key = key;
    this.params = params;
  }
}
const fail = (key, params) => { throw new GameError(key, params); };
// Cards in messages are sent as codes ('H11', 'X' = joker); every device
// labels them in its own language (J/Q/K or B/D/K).
const cardCodes = (cards) => cards.map(c => (c.joker ? 'X' : c.suit + c.rank));

export const HAND_SIZE = 12;
export const CUT_PEEK = 3;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export class Game {
  constructor() {
    this.phase = 'lobby';
    this.players = [];
    this.round = 0;
    this.dealer = -1;
    this.stock = [];
    this.discard = [];
    this.melds = [];
    this.turn = 0;
    this.turnNo = 0;
    this.drawnFromDiscard = null;
    this.result = null;
    this.gameNo = 0;
    this.history = []; // one entry per finished round: { round, winner, handRomme, penalties }
    this.votes = {}; // playerId -> true (play again) / false (stop)
    this.log = [];
    this.nextMeldId = 1;
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') fail('err.gameStarted');
    if (this.players.length >= MAX_PLAYERS) fail('err.tableFull');
    if (this.player(id)) return this.player(id);
    const p = { id, name: String(name || 'Player').slice(0, 20), bot, hand: [], cameOut: false, cameOutTurn: -1, score: 0 };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') return;
    this.players = this.players.filter(p => p.id !== id);
  }

  player(id) {
    return this.players.find(p => p.id === id);
  }

  get current() {
    return this.players[this.turn];
  }

  get cutter() {
    const n = this.players.length;
    return this.players[(this.dealer - 1 + n) % n];
  }

  // The player who has to act next (cutter during the cut, else whose turn).
  get actor() {
    if (this.phase === 'cut') return this.cutter;
    if (this.phase === 'draw' || this.phase === 'play') return this.current;
    return null;
  }

  // Players who still have to vote on another round.
  get pendingVoters() {
    return this.phase === 'roundOver' ? this.players.filter(p => !(p.id in this.votes)) : [];
  }

  start() {
    if (this.players.length < MIN_PLAYERS) fail('err.minPlayers', { n: MIN_PLAYERS });
    this.round = 0;
    this.dealer = Math.floor(Math.random() * this.players.length);
    for (const p of this.players) p.score = 0;
    this.history = [];
    this.gameNo++;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.votes = {};
    this.dealer = (this.dealer + 1) % this.players.length;
    for (const p of this.players) {
      p.hand = [];
      p.cameOut = false;
      p.cameOutTurn = -1;
    }
    this.stock = shuffle(createDeck());
    this.discard = [];
    this.melds = [];
    this.turn = (this.dealer + 1) % this.players.length;
    this.turnNo = 0;
    this.drawnFromDiscard = null;
    this.result = null;
    this.cutResult = null;
    this.phase = 'cut';
    this.say('log.roundCut', { round: this.round, name: this.cutter.name });
  }

  // `at` is where to cut, as a fraction 0..1 of the deck.
  #cut(p, at) {
    if (this.cutter !== p) fail('err.notCutter');
    const deck = this.stock;
    const frac = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : 0.5;
    const idx = CUT_PEEK + Math.round(frac * (deck.length - 2 * CUT_PEEK));
    const cut = deck.slice(idx).concat(deck.slice(0, idx));
    const peek = cut.slice(0, CUT_PEEK);
    const kept = peek.filter(c => c.joker);
    const rest = cut.filter(c => !kept.includes(c));
    p.hand.push(...kept);
    this.cutResult = { player: p.id, peek, kept: kept.map(c => c.id) };
    this.#deal(rest);
    this.say('log.cut', { name: p.name, kept: kept.length, starter: this.current.name });
  }

  #deal(deck) {
    for (const p of this.players) p.hand.push(...deck.splice(0, HAND_SIZE - p.hand.length));
    // The starting player gets one extra card instead of drawing, so the
    // player whose turn it is always holds 13 cards and starts the pile.
    this.current.hand.push(deck.pop());
    this.stock = deck;
    this.phase = 'play';
  }

  // Log entries are { key, params } so every device can show its own language.
  say(key, params = {}) {
    this.log.push({ key, params });
    if (this.log.length > 40) this.log.shift();
  }

  // Applies an action for a player. Returns { ok: true } or { ok: false, error }.
  apply(playerId, action) {
    try {
      this.#apply(playerId, action || {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message, key: e.key, params: e.params };
    }
  }

  #apply(playerId, action) {
    const p = this.player(playerId);
    if (!p) fail('err.unknownPlayer');
    if (action.type === 'vote') {
      if (this.phase !== 'roundOver') fail('err.noVote');
      this.votes[p.id] = !!action.yes;
      this.#resolveVote();
      return;
    }
    if (action.type === 'cut') {
      if (this.phase !== 'cut') fail('err.alreadyCut');
      return this.#cut(p, action.at);
    }
    if (this.phase === 'cut') fail('err.waitCut', { name: this.cutter.name });
    if (this.phase !== 'draw' && this.phase !== 'play') fail('err.noRound');
    if (this.current !== p) fail('err.notYourTurn');

    switch (action.type) {
      case 'draw': return this.#draw(p, action.from);
      case 'meld': return this.#meld(p, action.groups);
      case 'layoff': return this.#layoff(p, action.meldId, action.cardIds);
      case 'swap': return this.#swap(p, action.meldId, action.jokerId, action.cardId);
      case 'discard': return this.#discard(p, action.cardId);
      default: fail('err.unknownAction');
    }
  }

  #requirePlay() {
    if (this.phase === 'draw') fail('err.drawFirst');
  }

  #takeFromHand(p, ids) {
    if (!Array.isArray(ids) || !ids.length) fail('err.selectCards');
    if (new Set(ids).size !== ids.length) fail('err.duplicateCards');
    const cards = ids.map(id => p.hand.find(c => c.id === id));
    if (cards.some(c => !c)) fail('err.notInHand');
    return cards;
  }

  #removeFromHand(p, cards) {
    const ids = new Set(cards.map(c => c.id));
    p.hand = p.hand.filter(c => !ids.has(c.id));
  }

  #draw(p, from) {
    if (this.phase !== 'draw') fail('err.alreadyDrew');
    if (from === 'discard') {
      if (!p.cameOut) fail('err.discardNotOut', { min: MIN_INITIAL_MELD });
      const card = this.discard.pop();
      if (!card) fail('err.discardEmpty');
      p.hand.push(card);
      this.drawnFromDiscard = card.id;
      this.say('log.tookDiscard', { name: p.name, card: cardCodes([card]) });
    } else {
      if (!this.stock.length) this.#recycleDiscard();
      const card = this.stock.pop();
      if (!card) fail('err.stockEmpty');
      p.hand.push(card);
      this.drawnFromDiscard = null;
      this.say('log.drew', { name: p.name });
    }
    this.phase = 'play';
  }

  #recycleDiscard() {
    const top = this.discard.pop();
    this.stock = shuffle(this.discard);
    this.discard = top ? [top] : [];
    this.say('log.reshuffle');
  }

  #meld(p, groups) {
    this.#requirePlay();
    if (!Array.isArray(groups) || !groups.length) fail('err.nothingToMeld');
    const allIds = groups.flat();
    const cards = this.#takeFromHand(p, allIds);
    const byId = new Map(cards.map(c => [c.id, c]));
    const melds = groups.map(g => {
      const m = analyzeMeld(g.map(id => byId.get(id)));
      if (!m) fail('err.invalidMeld', { cards: cardCodes(g.map(id => byId.get(id))) });
      return m;
    });
    const points = melds.reduce((s, m) => s + m.points, 0);
    if (!p.cameOut && points < MIN_INITIAL_MELD) {
      fail('err.firstMeldMin', { min: MIN_INITIAL_MELD, points });
    }
    this.#removeFromHand(p, cards);
    for (const m of melds) this.melds.push({ id: this.nextMeldId++, owner: p.id, ...m });
    if (!p.cameOut) {
      p.cameOut = true;
      p.cameOutTurn = this.turnNo;
      this.say('log.cameOut', { name: p.name, points });
    } else {
      this.say('log.melded', { name: p.name, n: melds.length, type: melds[0].type });
    }
    this.#checkOut(p);
  }

  #findMeld(id) {
    const m = this.melds.find(x => x.id === id);
    if (!m) fail('err.meldNotFound');
    return m;
  }

  #layoff(p, meldId, cardIds) {
    this.#requirePlay();
    if (!p.cameOut) fail('err.layoffNotOut', { min: MIN_INITIAL_MELD });
    const meld = this.#findMeld(meldId);
    const cards = this.#takeFromHand(p, cardIds);
    const result = layOff(meld, cards);
    if (!result) fail('err.noFit', { cards: cardCodes(cards) });
    meld.slots = result.slots;
    meld.points = result.points;
    this.#removeFromHand(p, cards);
    this.say('log.added', { name: p.name, cards: cardCodes(cards) });
    this.#checkOut(p);
  }

  #swap(p, meldId, jokerId, cardId) {
    this.#requirePlay();
    if (!p.cameOut) fail('err.swapNotOut');
    const meld = this.#findMeld(meldId);
    const [card] = this.#takeFromHand(p, [cardId]);
    const joker = meld.slots.find(s => s.card.id === jokerId)?.card;
    const result = swapJoker(meld, jokerId, card);
    if (!result || !joker) fail('err.cannotSwap', { card: cardCodes([card]) });
    meld.slots = result.slots;
    meld.points = result.points;
    this.#removeFromHand(p, [card]);
    p.hand.push(joker);
    this.say('log.swapped', { name: p.name, card: cardCodes([card]) });
  }

  #discard(p, cardId) {
    this.#requirePlay();
    const [card] = this.#takeFromHand(p, [cardId]);
    if (card.id === this.drawnFromDiscard && p.hand.length > 1) {
      fail('err.throwBack');
    }
    this.#removeFromHand(p, [card]);
    this.discard.push(card);
    this.say('log.discarded', { name: p.name, card: cardCodes([card]) });
    if (this.#checkOut(p)) return;
    this.turn = (this.turn + 1) % this.players.length;
    this.turnNo++;
    this.phase = 'draw';
    this.drawnFromDiscard = null;
  }

  #resolveVote() {
    if (this.pendingVoters.length) return;
    const yes = Object.values(this.votes).filter(Boolean).length;
    const no = Object.values(this.votes).length - yes;
    if (yes >= no) {
      this.startRound();
      return;
    }
    this.phase = 'gameOver';
    const best = Math.min(...this.players.map(p => p.score));
    const winners = this.players.filter(p => p.score === best).map(p => p.name);
    this.say('log.gameOver', { names: winners.join(', '), points: best });
  }

  #checkOut(p) {
    if (p.hand.length) return false;
    // "Hand": the winner went out in this one turn and nobody else was out.
    const handRomme = p.cameOutTurn === this.turnNo && this.players.every(o => o === p || !o.cameOut);
    const penalties = {};
    const hands = {};
    for (const o of this.players) {
      let pts = o.hand.reduce((s, c) => s + penalty(c), 0);
      if (handRomme) pts *= 2;
      penalties[o.id] = pts;
      hands[o.id] = o.hand.slice();
      o.score += pts;
    }
    this.result = { winner: p.id, handRomme, penalties, hands };
    this.history.push({ round: this.round, winner: p.id, handRomme, penalties });
    this.votes = {};
    this.phase = 'roundOver';
    this.say('log.won', { name: p.name, round: this.round, handRomme });
    return true;
  }

  // What a given player is allowed to see.
  view(playerId) {
    const me = this.player(playerId);
    const top = this.discard[this.discard.length - 1] || null;
    return {
      you: playerId,
      phase: this.phase,
      round: this.round,
      turn: this.phase === 'draw' || this.phase === 'play' ? this.current?.id : null,
      cutter: this.phase === 'cut' ? this.cutter.id : null,
      // Only the cutter sees which cards were at the cut.
      cut: this.cutResult && this.cutResult.player === playerId ? this.cutResult : null,
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, count: p.hand.length, cameOut: p.cameOut, score: p.score,
      })),
      hand: me ? me.hand.slice() : [],
      stockCount: this.stock.length,
      discardTop: top,
      discardCount: this.discard.length,
      melds: this.melds,
      drawnFromDiscard: this.current?.id === playerId ? this.drawnFromDiscard : null,
      minInitial: MIN_INITIAL_MELD,
      result: this.result,
      history: this.history,
      gameNo: this.gameNo,
      votes: this.votes,
      log: this.log.slice(-6),
    };
  }
}
