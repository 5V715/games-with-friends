// Authoritative Rommé game state. Runs on the host (or in practice mode);
// guests only ever see the per-player views produced by view().
//
// Turn flow: draw (stock, or the discard pile once you are out) → optionally
// meld / lay off / swap jokers → discard one card. A player's first meld must
// be worth at least 40 points; laying off and joker swaps need you to be out. The round ends when a player has no cards left; everyone else
// scores penalty points for the cards still in their hand (doubled when the
// winner went out in one go — "Hand‑Rommé").

import { createDeck, shuffle, penalty, describe } from './cards.js';
import { analyzeMeld, layOff, swapJoker, MIN_INITIAL_MELD } from './rules.js';

export const HAND_SIZE = 13;
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
    this.log = [];
    this.nextMeldId = 1;
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') throw new Error('Game already started');
    if (this.players.length >= MAX_PLAYERS) throw new Error('Table is full');
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

  start() {
    if (this.players.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
    this.round = 0;
    this.dealer = Math.floor(Math.random() * this.players.length);
    for (const p of this.players) p.score = 0;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.dealer = (this.dealer + 1) % this.players.length;
    const deck = shuffle(createDeck());
    for (const p of this.players) {
      p.hand = deck.splice(0, HAND_SIZE);
      p.cameOut = false;
      p.cameOutTurn = -1;
    }
    this.discard = [deck.pop()];
    this.stock = deck;
    this.melds = [];
    this.turn = (this.dealer + 1) % this.players.length;
    this.turnNo = 0;
    this.phase = 'draw';
    this.drawnFromDiscard = null;
    this.result = null;
    this.say(`Round ${this.round} — ${this.current.name} starts`);
  }

  say(text) {
    this.log.push(text);
    if (this.log.length > 40) this.log.shift();
  }

  // Applies an action for a player. Returns { ok: true } or { ok: false, error }.
  apply(playerId, action) {
    try {
      this.#apply(playerId, action || {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  #apply(playerId, action) {
    const p = this.player(playerId);
    if (!p) throw new Error('Unknown player');
    if (action.type === 'nextRound') {
      if (this.phase !== 'roundOver') throw new Error('Round is still running');
      this.startRound();
      return;
    }
    if (this.phase !== 'draw' && this.phase !== 'play') throw new Error('No round in progress');
    if (this.current !== p) throw new Error("It's not your turn");

    switch (action.type) {
      case 'draw': return this.#draw(p, action.from);
      case 'meld': return this.#meld(p, action.groups);
      case 'layoff': return this.#layoff(p, action.meldId, action.cardIds);
      case 'swap': return this.#swap(p, action.meldId, action.jokerId, action.cardId);
      case 'discard': return this.#discard(p, action.cardId);
      default: throw new Error('Unknown action');
    }
  }

  #requirePlay() {
    if (this.phase === 'draw') throw new Error('Draw a card first');
  }

  #takeFromHand(p, ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Select some cards');
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate cards');
    const cards = ids.map(id => p.hand.find(c => c.id === id));
    if (cards.some(c => !c)) throw new Error('Card not in your hand');
    return cards;
  }

  #removeFromHand(p, cards) {
    const ids = new Set(cards.map(c => c.id));
    p.hand = p.hand.filter(c => !ids.has(c.id));
  }

  #draw(p, from) {
    if (this.phase !== 'draw') throw new Error('You already drew a card');
    if (from === 'discard') {
      if (!p.cameOut) throw new Error(`You may take from the discard pile once you are out (${MIN_INITIAL_MELD}+ points)`);
      const card = this.discard.pop();
      if (!card) throw new Error('Discard pile is empty');
      p.hand.push(card);
      this.drawnFromDiscard = card.id;
      this.say(`${p.name} took ${describe(card)} from the discard pile`);
    } else {
      if (!this.stock.length) this.#recycleDiscard();
      const card = this.stock.pop();
      if (!card) throw new Error('No cards left to draw');
      p.hand.push(card);
      this.drawnFromDiscard = null;
      this.say(`${p.name} drew from the stock`);
    }
    this.phase = 'play';
  }

  #recycleDiscard() {
    const top = this.discard.pop();
    this.stock = shuffle(this.discard);
    this.discard = top ? [top] : [];
    this.say('Discard pile reshuffled into the stock');
  }

  #meld(p, groups) {
    this.#requirePlay();
    if (!Array.isArray(groups) || !groups.length) throw new Error('Nothing to meld');
    const allIds = groups.flat();
    const cards = this.#takeFromHand(p, allIds);
    const byId = new Map(cards.map(c => [c.id, c]));
    const melds = groups.map(g => {
      const m = analyzeMeld(g.map(id => byId.get(id)));
      if (!m) throw new Error(`Not a valid set or run: ${g.map(id => describe(byId.get(id))).join(' ')}`);
      return m;
    });
    const points = melds.reduce((s, m) => s + m.points, 0);
    if (!p.cameOut && points < MIN_INITIAL_MELD) {
      throw new Error(`First meld needs ${MIN_INITIAL_MELD} points (you have ${points})`);
    }
    this.#removeFromHand(p, cards);
    for (const m of melds) this.melds.push({ id: this.nextMeldId++, owner: p.id, ...m });
    if (!p.cameOut) {
      p.cameOut = true;
      p.cameOutTurn = this.turnNo;
      this.say(`${p.name} came out with ${points} points`);
    } else {
      this.say(`${p.name} melded ${melds.length > 1 ? melds.length + ' groups' : 'a ' + melds[0].type}`);
    }
    this.#checkOut(p);
  }

  #findMeld(id) {
    const m = this.melds.find(x => x.id === id);
    if (!m) throw new Error('Meld not found');
    return m;
  }

  #layoff(p, meldId, cardIds) {
    this.#requirePlay();
    if (!p.cameOut) throw new Error(`Make your first meld (${MIN_INITIAL_MELD}+ points) before adding to the table`);
    const meld = this.#findMeld(meldId);
    const cards = this.#takeFromHand(p, cardIds);
    const result = layOff(meld, cards);
    if (!result) throw new Error(`${cards.map(describe).join(' ')} does not fit there`);
    meld.slots = result.slots;
    meld.points = result.points;
    this.#removeFromHand(p, cards);
    this.say(`${p.name} added ${cards.map(describe).join(' ')}`);
    this.#checkOut(p);
  }

  #swap(p, meldId, jokerId, cardId) {
    this.#requirePlay();
    if (!p.cameOut) throw new Error('Make your first meld before swapping jokers');
    const meld = this.#findMeld(meldId);
    const [card] = this.#takeFromHand(p, [cardId]);
    const joker = meld.slots.find(s => s.card.id === jokerId)?.card;
    const result = swapJoker(meld, jokerId, card);
    if (!result || !joker) throw new Error(`${describe(card)} cannot replace that joker`);
    meld.slots = result.slots;
    meld.points = result.points;
    this.#removeFromHand(p, [card]);
    p.hand.push(joker);
    this.say(`${p.name} swapped ${describe(card)} for a joker`);
  }

  #discard(p, cardId) {
    this.#requirePlay();
    const [card] = this.#takeFromHand(p, [cardId]);
    if (card.id === this.drawnFromDiscard && p.hand.length > 1) {
      throw new Error('You cannot throw back the card you just picked up');
    }
    this.#removeFromHand(p, [card]);
    this.discard.push(card);
    this.say(`${p.name} discarded ${describe(card)}`);
    if (this.#checkOut(p)) return;
    this.turn = (this.turn + 1) % this.players.length;
    this.turnNo++;
    this.phase = 'draw';
    this.drawnFromDiscard = null;
  }

  #checkOut(p) {
    if (p.hand.length) return false;
    const handRomme = p.cameOutTurn === this.turnNo;
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
    this.phase = 'roundOver';
    this.say(`${p.name} wins round ${this.round}${handRomme ? ' with Hand‑Rommé!' : '!'}`);
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
      log: this.log.slice(-6),
    };
  }
}
