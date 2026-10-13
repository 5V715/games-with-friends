// Glue between the game engine, the network and the UI.
//
// HostSession owns the authoritative Game, applies everyone's actions and
// sends each player only their own view. GuestSession forwards actions to the
// host and renders whatever state it receives. Both emit:
//   'state'  { view }      – new state to render
//   'error'  { message, fatal }
//   'link'   { state, route } (guest only) – connection quality to the host
//   'voice'  { from, blob } – a push-to-talk clip from another player

import { GameError } from './engine.js';
import { tr } from './i18n.js';
import { gameInfo } from './games/index.js';
import { VoiceAssembler, clipToMessages, validVoiceMessage } from './voice.js';

const BOT_NAMES = ['Ada', 'Bruno', 'Clara', 'Dieter', 'Erika', 'Fritz', 'Greta', 'Hans'];
const BOT_DELAY = 750;
const AWAY_DELAY = 8000; // a disconnected human is auto-played after this

function emit(target, type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

// Error message for a guest: translation key + params, plus English text.
function errorMsg(key, params = {}, extra = {}) {
  return { t: 'error', key, params, message: tr('en', key, params), ...extra };
}

function cleanId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

export class HostSession extends EventTarget {
  constructor({ name, clientId, net = null, room = null, gameType = 'romme' }) {
    super();
    this.isHost = true;
    this.net = net;
    this.room = room;
    this.myId = cleanId(clientId);
    this.info = gameInfo(gameType);
    this.game = this.info.create();
    this.game.addPlayer(this.myId, name);
    this.peerToPlayer = new Map();
    this.playerToPeer = new Map();
    this.links = new Map(); // playerId -> { state, route }
    this.botTimer = null;
    this.voice = new VoiceAssembler();

    if (net) {
      net.addEventListener('message', (ev) => this.#onMessage(ev.detail.peerId, ev.detail.msg));
      net.addEventListener('linkstate', (ev) => this.#onLinkState(ev.detail));
      net.addEventListener('leave', (ev) => this.#onLeave(ev.detail.peerId));
    }
  }

  #onLinkState({ peerId, state, route }) {
    const pid = this.peerToPlayer.get(peerId);
    if (!pid) return;
    this.links.set(pid, { state, route });
    this.broadcast();
  }

  #onMessage(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') return this.#onJoin(peerId, msg);
    const pid = this.peerToPlayer.get(peerId);
    if (!pid) return;
    if (msg.t === 'action') {
      const res = this.apply(pid, msg.action);
      if (!res.ok) this.net.send(peerId, errorMsg(res.key || 'err.badAction', res.params));
    } else if (msg.t === 'voice' && validVoiceMessage(msg)) {
      // The host decides who a clip is from, then forwards it to everyone else.
      const chunk = { ...msg, from: pid };
      for (const [other, otherPeer] of this.playerToPeer) {
        if (other !== pid) this.net.send(otherPeer, chunk);
      }
      const clip = this.voice.add(chunk);
      if (clip) emit(this, 'voice', clip);
    }
  }

  get canTalk() {
    return this.playerToPeer.size > 0;
  }

  async sendVoice(blob) {
    for (const m of await clipToMessages(blob, this.myId)) {
      for (const peerId of this.playerToPeer.values()) this.net.send(peerId, m);
    }
  }

  #onJoin(peerId, msg) {
    const pid = cleanId(msg.clientId);
    if (!pid) return;
    let player = this.game.player(pid);
    if (!player) {
      if (this.game.phase !== 'lobby') {
        this.net.send(peerId, errorMsg('err.gameStartedJoin', {}, { fatal: true }));
        return;
      }
      if (this.game.players.length >= this.info.max) {
        this.net.send(peerId, errorMsg('err.tableFull', {}, { fatal: true }));
        return;
      }
      player = this.game.addPlayer(pid, msg.name);
    } else if (player.bot || pid === this.myId) {
      this.net.send(peerId, errorMsg('err.seatTaken', {}, { fatal: true }));
      return;
    }
    const oldPeer = this.playerToPeer.get(pid);
    if (oldPeer && oldPeer !== peerId) {
      this.peerToPlayer.delete(oldPeer);
      this.net.kick(oldPeer);
    }
    this.peerToPlayer.set(peerId, pid);
    this.playerToPeer.set(pid, peerId);
    const link = this.net.links.get(peerId);
    this.links.set(pid, { state: link?.state || 'open', route: link?.route || null });
    this.net.send(peerId, { t: 'welcome', you: pid, room: this.room });
    this.broadcast();
  }

  #onLeave(peerId) {
    const pid = this.peerToPlayer.get(peerId);
    this.peerToPlayer.delete(peerId);
    if (!pid || this.playerToPeer.get(pid) !== peerId) return;
    this.playerToPeer.delete(pid);
    this.links.set(pid, { state: 'offline', route: null });
    if (this.game.phase === 'lobby') this.game.removePlayer(pid);
    this.broadcast();
  }

  // Actions only the host may take.
  #hostAction(action) {
    const g = this.game;
    switch (action.type) {
      case 'start':
        if (g.phase !== 'lobby') throw new GameError('err.gameStarted');
        g.start();
        return;
      case 'newGame':
        if (g.phase !== 'gameOver') throw new GameError('err.roundRunning');
        g.start();
        return;
      case 'addBot': {
        if (g.players.length >= this.info.max) throw new GameError('err.tableFull');
        const used = new Set(g.players.map(p => p.name.replace(/\s*🤖$/, '')));
        const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
        g.addPlayer('bot-' + Math.random().toString(36).slice(2, 8), name + ' 🤖', { bot: true });
        return;
      }
      case 'setGame': {
        // Switch the game in the lobby; everyone keeps their seat.
        if (g.phase !== 'lobby') throw new GameError('err.gameStarted');
        const info = gameInfo(action.game);
        if (g.players.length > info.max) throw new GameError('err.tableFull');
        const next = info.create();
        for (const p of g.players) next.addPlayer(p.id, p.name, { bot: p.bot });
        this.info = info;
        this.game = next;
        return;
      }
      case 'removePlayer': {
        if (action.playerId === this.myId) throw new GameError('err.removeSelf');
        const peer = this.playerToPeer.get(action.playerId);
        if (peer) {
          this.net.send(peer, errorMsg('err.removed', {}, { fatal: true }));
          this.net.kick(peer);
        }
        g.removePlayer(action.playerId);
        return;
      }
      default:
        throw new GameError('err.unknownAction');
    }
  }

  apply(pid, action) {
    this.lastAuto = null; // a real move: the next auto-play waits the grace period again
    if (!action || typeof action !== 'object') return { ok: false, error: 'Bad action', key: 'err.badAction' };
    let res;
    const hostOnly = ['start', 'addBot', 'removePlayer', 'newGame', 'setGame'].includes(action.type);
    if (hostOnly && pid !== this.myId) {
      res = { ok: false, error: 'Only the host can do that', key: 'err.hostOnly' };
    } else if (hostOnly) {
      try { this.#hostAction(action); res = { ok: true }; } catch (e) { res = { ok: false, error: e.message, key: e.key, params: e.params }; }
    } else {
      res = this.game.apply(pid, action);
    }
    if (res.ok) this.broadcast();
    return res;
  }

  act(action) {
    const res = this.apply(this.myId, action);
    if (!res.ok) emit(this, 'error', { message: res.error, key: res.key, params: res.params });
    return res;
  }

  #connInfo(p) {
    if (p.id === this.myId) return { state: 'host' };
    if (p.bot) return { state: 'bot' };
    return this.links.get(p.id) || { state: 'offline' };
  }

  viewFor(pid) {
    const view = this.game.view(pid);
    view.host = this.myId;
    view.room = this.room;
    for (const p of view.players) p.conn = this.#connInfo(p);
    return view;
  }

  broadcast() {
    for (const [pid, peerId] of this.playerToPeer) this.net?.send(peerId, { t: 'state', view: this.viewFor(pid) });
    emit(this, 'state', { view: this.viewFor(this.myId) });
    this.#scheduleBot();
  }

  #scheduleBot() {
    clearTimeout(this.botTimer);
    const g = this.game;
    const isAway = (p) => !p.bot && p.id !== this.myId && !this.playerToPeer.has(p.id);
    // Bots act for themselves; players who lost their connection are
    // auto-played after a grace period (then quickly for the rest of the turn).
    const cur = g.actors.find(p => p.bot || isAway(p));
    if (!cur) return;
    const quick = cur.bot || this.lastAuto === cur.id;
    const delay = quick ? (g.phase === 'cut' ? BOT_DELAY * 2 : BOT_DELAY) : AWAY_DELAY;
    this.botTimer = setTimeout(() => {
      if (this.game !== g || !g.actors.includes(cur)) return;
      const action = this.info.bot(g.view(cur.id));
      this.lastAuto = cur.id;
      if (action && g.apply(cur.id, action).ok) this.broadcast();
    }, delay);
  }

  close() {
    clearTimeout(this.botTimer);
    this.net?.close();
  }
}

export class GuestSession extends EventTarget {
  constructor({ name, clientId, net }) {
    super();
    this.isHost = false;
    this.name = name;
    this.clientId = cleanId(clientId);
    this.myId = this.clientId;
    this.net = net;
    this.view = null;
    this.ended = false;
    this.voice = new VoiceAssembler();

    // The very first message on a fresh data channel is occasionally lost, so
    // keep asking to join until the host welcomes us (joining is idempotent).
    net.addEventListener('open', () => {
      clearInterval(this.joinTimer);
      const join = () => net.send({ t: 'join', name, clientId: this.clientId });
      join();
      this.joinTimer = setInterval(join, 1500);
    });
    net.addEventListener('message', (ev) => this.#onMessage(ev.detail));
    net.addEventListener('linkstate', (ev) => emit(this, 'link', ev.detail));
    net.addEventListener('close', () => this.#lost());
    net.addEventListener('hostleft', () => this.#lost());
  }

  #lost() {
    clearInterval(this.joinTimer);
    if (this.ended) return;
    emit(this, 'link', { state: 'offline', route: null });
    emit(this, 'disconnected', {});
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      clearInterval(this.joinTimer);
      this.myId = msg.you;
    } else if (msg.t === 'state') {
      this.view = msg.view;
      emit(this, 'state', { view: msg.view });
    } else if (msg.t === 'error') {
      if (msg.fatal) {
        this.ended = true;
        clearInterval(this.joinTimer);
      }
      emit(this, 'error', { message: msg.message, key: msg.key, params: msg.params, fatal: !!msg.fatal });
    } else if (msg.t === 'voice') {
      const clip = this.voice.add(msg);
      if (clip) emit(this, 'voice', clip);
    }
  }

  get canTalk() {
    return this.net.link?.state === 'open';
  }

  async sendVoice(blob) {
    for (const m of await clipToMessages(blob, this.myId)) this.net.send(m);
  }

  act(action) {
    this.net.send({ t: 'action', action });
    return { ok: true };
  }

  close() {
    this.ended = true;
    clearInterval(this.joinTimer);
    this.net.close();
  }
}
