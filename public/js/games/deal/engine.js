// Monopoly Deal rules engine (authoritative, runs on the host).
//
// Everyone starts with 5 cards. On your turn you draw 2 (5 with an empty
// hand) and play up to 3 cards: money/actions into your bank, properties
// onto the table, or action cards. Hand limit at the end of a turn is 7.
// The first player with three complete sets of different colors wins.
//
// Actions against other players create a `pending` step that is settled one
// target at a time: the target may answer with Just Say No (which the
// attacker may counter with another one), and debts are paid with cards the
// payer chooses from their bank and table.

import './strings.js';
import { shuffle } from '../../cards.js';
import { GameError } from '../../engine.js';
import { SETS, COLORS, NO_BUILDINGS, createDealDeck, cardColors, cardLabel, colorT } from './cards.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const START_HAND = 5;
export const HAND_LIMIT = 7;
export const PLAYS = 3;
export const SETS_TO_WIN = 3;

const fail = (key, params) => { throw new GameError(key, params); };

// ---- table helpers (shared with the bot and UI) ----------------------------

export function stack(p, color) {
  return p.props.filter(e => e.color === color);
}

export function isFull(p, color) {
  return stack(p, color).length >= SETS[color].size;
}

export function fullColors(p) {
  return COLORS.filter(c => isFull(p, c));
}

export function rentFor(p, color) {
  const n = Math.min(stack(p, color).length, SETS[color].size);
  if (!n) return 0;
  let rent = SETS[color].rent[n - 1];
  if (isFull(p, color)) {
    const b = p.buildings[color] || {};
    if (b.house) rent += 3;
    if (b.hotel) rent += 4;
  }
  return rent;
}

// Everything a player could pay with (cards in hand never count).
export function payables(p) {
  const out = p.bank.map(card => ({ card, where: 'bank' }));
  for (const e of p.props) if (e.card.value > 0) out.push({ card: e.card, where: 'prop', color: e.color });
  for (const [color, b] of Object.entries(p.buildings)) {
    for (const k of ['house', 'hotel']) if (b[k]) out.push({ card: b[k], where: 'building', color });
  }
  return out;
}

export function worth(p) {
  return payables(p).reduce((s, x) => s + x.card.value, 0);
}

export class DealGame {
  constructor() {
    this.type = 'deal';
    this.phase = 'lobby';
    this.players = [];
    this.gameNo = 0;
    this.deck = [];
    this.discard = [];
    this.turn = 0;
    this.playsLeft = 0;
    this.pending = null;
    this.winner = null;
    this.step = 0; // increases with every successful move
    this.log = [];
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') fail('err.gameStarted');
    if (this.players.length >= MAX_PLAYERS) fail('err.tableFull');
    if (this.player(id)) return this.player(id);
    const p = { id, name: String(name || 'Player').slice(0, 20), bot, hand: [], bank: [], props: [], buildings: {} };
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

  // Whoever has to decide right now.
  get decider() {
    if (this.phase !== 'play' && this.phase !== 'discard') return null;
    if (!this.pending) return this.current;
    const pd = this.pending;
    return this.player(pd.stage === 'counter' ? pd.source : pd.targets[pd.i]);
  }

  get actors() {
    return this.decider ? [this.decider] : [];
  }

  get pendingVoters() {
    return [];
  }

  say(key, params = {}) {
    this.log.push({ key, params });
    if (this.log.length > 40) this.log.shift();
  }

  start() {
    if (this.players.length < MIN_PLAYERS) fail('err.minPlayers', { n: MIN_PLAYERS });
    this.gameNo++;
    this.deck = shuffle(createDealDeck());
    this.discard = [];
    for (const p of this.players) {
      p.hand = [];
      p.bank = [];
      p.props = [];
      p.buildings = {};
      this.#draw(p, START_HAND);
    }
    this.winner = null;
    this.pending = null;
    this.turn = Math.floor(Math.random() * this.players.length);
    this.phase = 'play';
    this.say('deal.log.start', { name: this.current.name });
    this.#startTurn();
  }

  #draw(p, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!this.deck.length && this.discard.length) {
        this.deck = shuffle(this.discard);
        this.discard = [];
        this.say('deal.log.reshuffle');
      }
      const c = this.deck.pop();
      if (!c) break;
      p.hand.push(c);
      got++;
    }
    return got;
  }

  #startTurn() {
    const p = this.current;
    const n = this.#draw(p, p.hand.length ? 2 : 5);
    this.say('deal.log.turn', { name: p.name, n });
    this.playsLeft = PLAYS;
    this.phase = 'play';
  }

  apply(playerId, action) {
    try {
      this.#apply(playerId, action || {});
      this.#checkWin();
      this.step++;
      return { ok: true };
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      return { ok: false, error: e.message, key: e.key, params: e.params };
    }
  }

  #checkWin() {
    if (this.phase === 'gameOver' || this.phase === 'lobby') return;
    const order = [this.current, ...this.players.filter(p => p !== this.current)];
    const w = order.find(p => fullColors(p).length >= SETS_TO_WIN);
    if (!w) return;
    this.winner = w.id;
    this.pending = null;
    this.phase = 'gameOver';
    this.say('deal.log.won', { name: w.name });
  }

  #apply(playerId, action) {
    const p = this.player(playerId);
    if (!p) fail('err.unknownPlayer');
    if (this.phase !== 'play' && this.phase !== 'discard') fail('err.noRound');
    if (this.pending) {
      if (this.decider !== p) fail(p === this.current ? 'deal.err.pending' : 'deal.err.notYourDecision');
      if (action.type === 'respond') return this.#respond(p, action);
      if (action.type === 'pay') return this.#pay(p, action.cardIds);
      fail('deal.err.pending');
    }
    if (this.current !== p) fail('err.notYourTurn');
    if (this.phase === 'discard') {
      if (action.type !== 'discard') fail('deal.err.mustDiscard');
      return this.#discard(p, action.cardIds);
    }
    switch (action.type) {
      case 'bank': return this.#bank(p, action.cardId);
      case 'property': return this.#property(p, action.cardId, action.color);
      case 'move': return this.#move(p, action.cardId, action.color);
      case 'action': return this.#action(p, action);
      case 'end': return this.#end(p);
      default: fail('err.unknownAction');
    }
  }

  #fromHand(p, id) {
    const card = p.hand.find(c => c.id === id);
    if (!card) fail('err.notInHand');
    return card;
  }

  #usePlay(n = 1) {
    if (this.playsLeft < n) fail('deal.err.noPlays');
    this.playsLeft -= n;
  }

  #remove(p, card) {
    p.hand = p.hand.filter(c => c !== card);
  }

  // Buildings fall back into the bank when their set is no longer complete.
  #normalize(p) {
    for (const [color, b] of Object.entries(p.buildings)) {
      if (!isFull(p, color) || (b.hotel && !b.house)) {
        if (b.house) p.bank.push(b.house);
        if (b.hotel) p.bank.push(b.hotel);
        delete p.buildings[color];
      }
    }
  }

  #bank(p, id) {
    const card = this.#fromHand(p, id);
    if (!(card.type === 'money' || card.type === 'action' || card.type === 'rent') || card.value <= 0) fail('deal.err.cannotBank');
    this.#usePlay();
    this.#remove(p, card);
    p.bank.push(card);
    this.say('deal.log.bank', { name: p.name, card: cardLabel(card) });
  }

  #property(p, id, color) {
    const card = this.#fromHand(p, id);
    if (card.type !== 'prop' && card.type !== 'wild') fail('deal.err.notProperty');
    if (!cardColors(card).includes(color)) fail('deal.err.badColor');
    this.#usePlay();
    this.#remove(p, card);
    p.props.push({ card, color });
    this.say('deal.log.property', { name: p.name, card: cardLabel(card), color: colorT(color) });
  }

  // Rearranging wild properties on your turn is free.
  #move(p, id, color) {
    const e = p.props.find(x => x.card.id === id);
    if (!e) fail('deal.err.noSuchProp');
    if (e.card.type !== 'wild' || !cardColors(e.card).includes(color)) fail('deal.err.badColor');
    e.color = color;
    this.#normalize(p);
    this.say('deal.log.move', { name: p.name, card: cardLabel(e.card), color: colorT(color) });
  }

  #target(p, id) {
    const t = this.player(id);
    if (!id) fail('deal.err.needTarget');
    if (!t || t === p) fail('deal.err.badTarget');
    return t;
  }

  #action(p, a) {
    const card = this.#fromHand(p, a.cardId);
    const others = this.players.filter(o => o !== p);
    let pending = null;

    if (card.type === 'rent') {
      const colors = card.colors === 'any' ? COLORS : card.colors;
      if (!colors.includes(a.color) || !stack(p, a.color).length) fail('deal.err.noRentColor');
      const doubles = (a.doubles || []).map(id => this.#fromHand(p, id));
      if (doubles.some(d => d.action !== 'double') || new Set(a.doubles).size !== doubles.length) fail('deal.err.badDouble');
      const targets = card.colors === 'any' ? [this.#target(p, a.target)] : others;
      this.#usePlay(1 + doubles.length);
      for (const d of doubles) { this.#remove(p, d); this.discard.push(d); }
      const amount = rentFor(p, a.color) * 2 ** doubles.length;
      pending = { kind: 'pay', card, amount, targets: targets.map(t => t.id) };
      this.#remove(p, card);
      this.discard.push(card);
      this.say('deal.log.rent', { name: p.name, amount, color: colorT(a.color), doubled: doubles.length > 0 });
    } else if (card.type === 'action') {
      switch (card.action) {
        case 'passgo':
          break;
        case 'debt':
          pending = { kind: 'pay', amount: 5, targets: [this.#target(p, a.target).id] };
          break;
        case 'birthday':
          pending = { kind: 'pay', amount: 2, targets: others.map(o => o.id) };
          break;
        case 'sly': {
          const t = this.#target(p, a.target);
          const e = t.props.find(x => x.card.id === a.propId);
          if (!e) fail('deal.err.noSuchProp');
          if (isFull(t, e.color)) fail('deal.err.inFullSet');
          pending = { kind: 'sly', propId: a.propId, targets: [t.id] };
          break;
        }
        case 'forced': {
          const t = this.#target(p, a.target);
          const theirs = t.props.find(x => x.card.id === a.propId);
          const mine = p.props.find(x => x.card.id === a.myPropId);
          if (!theirs || !mine) fail('deal.err.noSuchProp');
          if (isFull(t, theirs.color) || isFull(p, mine.color)) fail('deal.err.inFullSet');
          pending = { kind: 'forced', propId: a.propId, myPropId: a.myPropId, targets: [t.id] };
          break;
        }
        case 'dealbreaker': {
          const t = this.#target(p, a.target);
          if (!COLORS.includes(a.color) || !isFull(t, a.color)) fail('deal.err.notFullSet');
          pending = { kind: 'dealbreaker', color: a.color, targets: [t.id] };
          break;
        }
        case 'house':
        case 'hotel': {
          const b = p.buildings[a.color] || {};
          const ok = COLORS.includes(a.color) && isFull(p, a.color) && !NO_BUILDINGS.has(a.color) &&
            (card.action === 'house' ? !b.house : b.house && !b.hotel);
          if (!ok) fail('deal.err.noBuilding');
          break;
        }
        case 'jsn': fail('deal.err.jsnResponse'); break;
        case 'double': fail('deal.err.badDouble'); break;
        default: fail('deal.err.notAction');
      }
      this.#usePlay();
      this.#remove(p, card);
      this.say('deal.log.action', { name: p.name, card: cardLabel(card) });
      if (card.action === 'house' || card.action === 'hotel') {
        (p.buildings[a.color] ||= {})[card.action] = card;
        this.say('deal.log.built', { name: p.name, card: cardLabel(card), color: colorT(a.color) });
      } else {
        this.discard.push(card);
      }
      if (card.action === 'passgo') this.#draw(p, 2);
    } else {
      fail('deal.err.notAction');
    }

    if (pending) {
      this.pending = { ...pending, source: p.id, label: cardLabel(card), i: -1, stage: null };
      this.#nextTarget();
    }
  }

  #hasJsn(p) {
    return p.hand.some(c => c.action === 'jsn');
  }

  #playJsn(p) {
    const jsn = p.hand.find(c => c.action === 'jsn');
    if (!jsn) fail('deal.err.noJsn');
    this.#remove(p, jsn);
    this.discard.push(jsn);
    this.say('deal.log.jsn', { name: p.name });
  }

  // Moves on to the next target; skips decisions nobody can make.
  #nextTarget() {
    const pd = this.pending;
    pd.i++;
    if (pd.i >= pd.targets.length) {
      this.pending = null;
      return;
    }
    const target = this.player(pd.targets[pd.i]);
    if (this.#hasJsn(target)) pd.stage = 'respond';
    else this.#resolve();
  }

  // The target accepted: apply the effect (or ask them to pay).
  #resolve() {
    const pd = this.pending;
    const src = this.player(pd.source);
    const target = this.player(pd.targets[pd.i]);
    if (pd.kind === 'pay') {
      if (worth(target) === 0) {
        this.say('deal.log.cantPay', { name: target.name });
        return this.#nextTarget();
      }
      pd.stage = 'pay';
      return;
    }
    if (pd.kind === 'sly') {
      const e = target.props.find(x => x.card.id === pd.propId);
      if (e && !isFull(target, e.color)) {
        target.props = target.props.filter(x => x !== e);
        src.props.push(e);
        this.say('deal.log.stole', { name: src.name, card: cardLabel(e.card), from: target.name });
      }
    } else if (pd.kind === 'forced') {
      const theirs = target.props.find(x => x.card.id === pd.propId);
      const mine = src.props.find(x => x.card.id === pd.myPropId);
      if (theirs && mine) {
        target.props = target.props.filter(x => x !== theirs);
        src.props = src.props.filter(x => x !== mine);
        src.props.push(theirs);
        target.props.push(mine);
        this.say('deal.log.swapped', { name: src.name, mine: cardLabel(mine.card), theirs: cardLabel(theirs.card), from: target.name });
      }
    } else if (pd.kind === 'dealbreaker') {
      const set = stack(target, pd.color);
      if (set.length) {
        target.props = target.props.filter(x => x.color !== pd.color);
        src.props.push(...set);
        const b = target.buildings[pd.color];
        if (b) {
          src.buildings[pd.color] = b;
          delete target.buildings[pd.color];
        }
        this.say('deal.log.dealbreaker', { name: src.name, color: colorT(pd.color), from: target.name });
      }
    }
    this.#normalize(src);
    this.#normalize(target);
    this.#nextTarget();
  }

  #respond(p, { jsn }) {
    const pd = this.pending;
    if (pd.stage !== 'respond' && pd.stage !== 'counter') fail('deal.err.notYourDecision');
    const target = this.player(pd.targets[pd.i]);
    const src = this.player(pd.source);
    if (pd.stage === 'respond') {
      if (!jsn) return this.#resolve();
      this.#playJsn(p);
      // The attacker may answer with their own Just Say No.
      if (this.#hasJsn(src)) pd.stage = 'counter';
      else {
        this.say('deal.log.blocked', { name: target.name });
        this.#nextTarget();
      }
      return;
    }
    // stage === 'counter' (the attacker decides)
    if (!jsn) {
      this.say('deal.log.blocked', { name: target.name });
      return this.#nextTarget();
    }
    this.#playJsn(p);
    if (this.#hasJsn(target)) pd.stage = 'respond';
    else this.#resolve();
  }

  #pay(p, cardIds) {
    const pd = this.pending;
    if (pd.stage !== 'pay') fail('deal.err.notYourDecision');
    const all = payables(p);
    const ids = [...new Set(cardIds || [])];
    const chosen = ids.map(id => all.find(x => x.card.id === id));
    if (chosen.some(x => !x)) fail('deal.err.notYours');
    const sum = chosen.reduce((s, x) => s + x.card.value, 0);
    if (sum < pd.amount && chosen.length < all.length) fail('deal.err.payMore', { amount: pd.amount });
    const src = this.player(pd.source);
    for (const x of chosen) {
      if (x.where === 'bank') {
        p.bank = p.bank.filter(c => c !== x.card);
        src.bank.push(x.card);
      } else if (x.where === 'prop') {
        const e = p.props.find(y => y.card === x.card);
        p.props = p.props.filter(y => y !== e);
        src.props.push(e);
      } else {
        const b = p.buildings[x.color];
        for (const k of ['house', 'hotel']) if (b?.[k] === x.card) delete b[k];
        src.bank.push(x.card);
      }
    }
    this.#normalize(p);
    this.#normalize(src);
    this.say('deal.log.paid', { name: p.name, amount: sum, to: src.name });
    this.#nextTarget();
  }

  #end(p) {
    if (p.hand.length > HAND_LIMIT) {
      this.phase = 'discard';
      return;
    }
    this.#nextTurn();
  }

  #discard(p, cardIds) {
    const n = p.hand.length - HAND_LIMIT;
    const ids = [...new Set(cardIds || [])];
    if (ids.length !== n) fail('deal.err.discardCount', { n });
    const cards = ids.map(id => this.#fromHand(p, id));
    for (const c of cards) { this.#remove(p, c); this.discard.push(c); }
    this.say('deal.log.discard', { name: p.name, n });
    this.#nextTurn();
  }

  #nextTurn() {
    // Nothing left to draw and nobody holds a card: the game cannot move on.
    if (!this.deck.length && !this.discard.length && this.players.every(p => !p.hand.length)) {
      const best = [...this.players].sort((a, b) => fullColors(b).length - fullColors(a).length || worth(b) - worth(a))[0];
      this.winner = best.id;
      this.phase = 'gameOver';
      this.say('deal.log.won', { name: best.name });
      return;
    }
    this.turn = (this.turn + 1) % this.players.length;
    this.#startTurn();
  }

  view(playerId) {
    const me = this.player(playerId);
    const pd = this.pending;
    return {
      game: 'deal',
      you: playerId,
      phase: this.phase,
      gameNo: this.gameNo,
      step: this.step,
      turn: this.phase === 'play' || this.phase === 'discard' ? this.current.id : null,
      decider: this.decider?.id || null,
      playsLeft: this.playsLeft,
      handLimit: HAND_LIMIT,
      pending: pd && {
        kind: pd.kind, source: pd.source, target: pd.targets[pd.i], stage: pd.stage, amount: pd.amount,
        label: pd.label, propId: pd.propId, myPropId: pd.myPropId, color: pd.color,
      },
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, count: p.hand.length,
        bank: p.bank, props: p.props, buildings: p.buildings,
        sets: fullColors(p).length, worth: worth(p),
      })),
      hand: me ? me.hand.slice() : [],
      deckCount: this.deck.length,
      discardTop: this.discard[this.discard.length - 1] || null,
      winner: this.winner,
      log: this.log.slice(-6),
    };
  }
}
