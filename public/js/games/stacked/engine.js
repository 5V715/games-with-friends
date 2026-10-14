// Stacked: versus falling-blocks game for 1–4 players, best of 3.
//
// Every player's well runs on their own device. The host is the referee: it
// hands out the round's seed (same pieces for everyone), receives a report
// each time a piece locks (lines, garbage sent, board), routes the garbage to
// an opponent and tracks who is still standing. Bots' wells run on the host.

import './strings.js';
import { GameError } from '../../engine.js';
import { Well, bestPlacement, COLS, VISIBLE } from './well.js';

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
export const WINS_NEEDED = 2;
const TPS = 60;
const COUNTDOWN = 3 * TPS;
const END_DELAY = TPS;
const RESULT_TICKS = Math.round(3.5 * TPS);
const AWAY_LIMIT = 15 * TPS; // a disconnected player tops out after this
const ATTACKER_MEMORY = 10 * TPS;
const MAX_EVENTS = 16;

const fail = (key, params) => { throw new GameError(key, params); };
const BOARD_RE = /^[.IJLOSTZG]{200}$/;
const EMPTY_BOARD = '.'.repeat(COLS * VISIBLE);

export class StackedGame {
  constructor({ random = Math.random } = {}) {
    this.type = 'stacked';
    this.realtime = true;
    this.rnd = random;
    this.phase = 'lobby';
    this.players = [];
    this.round = 0;
    this.gameNo = 0;
    this.history = [];
    this.votes = {};
    this.result = null;
    this.changed = false;
    this.tickNo = 0;
    this.events = [];
    this.eventNo = 0;
    this.garbageNo = 0;
  }

  addPlayer(id, name, { bot = false } = {}) {
    if (this.phase !== 'lobby') fail('err.gameStarted');
    if (this.players.length >= MAX_PLAYERS) fail('err.tableFull');
    if (this.player(id)) return this.player(id);
    const p = { id, name: String(name || 'Player').slice(0, 20), bot, wins: 0, alive: true, board: EMPTY_BOARD, incoming: [], used: {}, away: 0 };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    if (this.phase === 'lobby') this.players = this.players.filter(p => p.id !== id);
  }

  player(id) {
    return this.players.find(p => p.id === id);
  }

  get pendingVoters() { return []; }
  get actors() { return []; }

  start() {
    if (this.players.length < MIN_PLAYERS) fail('err.minPlayers', { n: MIN_PLAYERS });
    this.gameNo++;
    this.round = 0;
    this.history = [];
    for (const p of this.players) p.wins = 0;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.phase = 'play';
    this.result = null;
    this.seed = Math.floor(this.rnd() * 2 ** 31);
    this.t = -COUNTDOWN;
    this.live = false;
    this.endIn = null;
    this.events = [];
    for (const p of this.players) {
      Object.assign(p, { alive: true, board: EMPTY_BOARD, incoming: [], used: {}, attackers: new Map(), lines: 0, sentTotal: 0, away: 0, koAt: null });
      if (p.bot) {
        p.well = new Well(this.seed);
        // Every bot has its own touch: some are sloppier, some slower.
        p.botNoise = 0.6 + this.rnd() * 2.4;
        p.botPace = 0.8 + this.rnd() * 0.5;
      }
    }
    this.changed = true;
  }

  // Called by the host for players who lost their connection.
  setInput(pid, inp) {
    const p = this.player(pid);
    if (p && inp === null) p.away++;
  }

  resetInput(pid) {
    const p = this.player(pid);
    if (p) p.away = 0;
  }

  steer() { /* bots are driven in tick() */ }

  apply(playerId, action) {
    try {
      const p = this.player(playerId);
      if (!p) fail('err.unknownPlayer');
      if (action?.type !== 'lock') fail('err.unknownAction');
      this.#report(p, action);
      return { ok: true };
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      return { ok: false, error: e.message, key: e.key, params: e.params };
    }
  }

  // A piece locked in someone's well.
  #report(p, r) {
    if (this.phase !== 'play' || !this.live || !p.alive) return;
    if (r.round !== this.round) return; // late report from the last round
    p.away = 0;
    if (typeof r.board === 'string' && BOARD_RE.test(r.board)) p.board = r.board;
    if (r.used && typeof r.used === 'object') {
      for (const e of p.incoming) {
        const n = Number(r.used[e.id]) | 0;
        if (n > (p.used[e.id] || 0)) p.used[e.id] = Math.min(e.lines, n);
      }
      p.incoming = p.incoming.filter(e => (p.used[e.id] || 0) < e.lines);
    }
    const lines = Math.max(0, Math.min(4, Number(r.lines) | 0));
    const sent = Math.max(0, Math.min(24, Number(r.sent) | 0));
    p.lines += lines;
    let to = null;
    if (sent > 0) {
      const target = this.#target(p);
      if (target) {
        target.incoming.push({ id: ++this.garbageNo, lines: sent, from: p.id, gap: Math.floor(this.rnd() * COLS) });
        target.attackers.set(p.id, this.tickNo);
        p.sentTotal += sent;
        to = target.id;
      }
    }
    if (lines || sent || r.topOut) {
      this.events.push({
        n: ++this.eventNo, from: p.id, lines, sent, to,
        tspin: r.tspin === 'full' || r.tspin === 'mini' ? r.tspin : null,
        combo: Math.max(0, Math.min(20, Number(r.combo) | 0)), b2b: !!r.b2b, perfect: !!r.perfect, ko: !!r.topOut,
      });
      if (this.events.length > MAX_EVENTS) this.events.shift();
    }
    if (r.topOut) this.#knockOut(p);
    this.changed = true;
  }

  // Garbage goes to whoever attacked you lately, otherwise to someone at random.
  #target(p) {
    const others = this.players.filter(o => o !== p && o.alive);
    if (!others.length) return null;
    const attackers = others.filter(o => this.tickNo - (p.attackers.get(o.id) ?? -Infinity) < ATTACKER_MEMORY);
    const pool = attackers.length ? attackers : others;
    return pool[Math.floor(this.rnd() * pool.length)];
  }

  #knockOut(p) {
    if (!p.alive) return;
    p.alive = false;
    p.koAt = this.tickNo;
    this.changed = true;
  }

  tick() {
    this.tickNo++;
    if (this.phase === 'roundEnd') {
      if (--this.resultIn <= 0) this.#afterRound();
      return;
    }
    if (this.phase !== 'play') return;
    this.t++;
    if (this.t === 0) {
      this.live = true;
      this.changed = true;
    }
    if (!this.live) return;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.bot) this.#botTick(p);
      else if (p.away > AWAY_LIMIT) {
        this.events.push({ n: ++this.eventNo, from: p.id, lines: 0, sent: 0, to: null, ko: true });
        this.#knockOut(p);
      }
    }
    this.#checkEnd();
  }

  #botTick(p) {
    const w = p.well;
    w.incoming = p.incoming;
    w.used = p.used;
    let res = w.update(1000 / TPS);
    if (!res) {
      if (p.botPiece !== w.pieceNo) {
        p.botPiece = w.pieceNo;
        // Think time per piece: a bit quicker the longer the round lasts.
        const base = Math.max(22, 48 - this.t / 600) * p.botPace;
        p.botAt = this.t + base + Math.floor(this.rnd() * base);
        p.botPlan = bestPlacement(w, () => (this.rnd() - 0.5) * p.botNoise);
      }
      if (this.t >= p.botAt && p.botPlan) {
        const { rot, x } = p.botPlan;
        let piece = { ...w.piece, rot, x };
        if (!w.fits(piece)) piece = { ...piece, y: 0 };
        if (w.fits(piece)) w.piece = piece;
        res = w.hardDrop();
      }
    }
    if (res) this.#report(p, { ...res, round: this.round, board: w.board(), used: { ...w.used } });
  }

  #checkEnd() {
    const alive = this.players.filter(p => p.alive);
    const solo = this.players.length === 1;
    if (solo ? alive.length > 0 : alive.length > 1) return;
    if (this.endIn == null) this.endIn = END_DELAY;
    if (--this.endIn > 0) return;
    const winner = solo ? null : alive[0] || null;
    if (winner) winner.wins++;
    this.result = { winner: winner?.id || null, round: this.round };
    this.history.push({ round: this.round, winner: winner?.id || null });
    this.phase = 'roundEnd';
    this.live = false;
    this.resultIn = RESULT_TICKS;
    this.changed = true;
  }

  #afterRound() {
    const champ = this.players.find(p => p.wins >= WINS_NEEDED);
    if (champ || (this.players.length === 1 && this.round >= 3)) {
      this.phase = 'gameOver';
      this.result = { ...this.result, champion: champ?.id || null };
      this.changed = true;
      return;
    }
    this.startRound();
  }

  frame() { return null; }

  view(playerId) {
    const me = this.player(playerId);
    return {
      game: 'stacked',
      you: playerId,
      phase: this.phase,
      round: this.round,
      gameNo: this.gameNo,
      winsNeeded: WINS_NEEDED,
      seed: this.seed,
      live: !!this.live,
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, wins: p.wins, score: p.wins, alive: p.alive,
        board: p.board, lines: p.lines || 0, sent: p.sentTotal || 0,
        pending: (p.incoming || []).reduce((s, e) => s + e.lines - (p.used[e.id] || 0), 0),
      })),
      incoming: me ? me.incoming : [],
      events: this.events,
      hand: [],
      result: this.result,
      history: [],
      votes: {},
    };
  }
}
