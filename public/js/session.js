// Glue between the game engine, the network and the UI.
//
// HostSession owns the authoritative Game, applies everyone's actions and
// sends each player only their own view. GuestSession forwards actions to the
// host and renders whatever state it receives. Both emit:
//   'state'  { view }      – new state to render
//   'error'  { message, fatal }
//   'link'   { state, route } (guest only) – connection quality to the host

import { Game, MAX_PLAYERS } from './engine.js';
import { botStep } from './bot.js';

const BOT_NAMES = ['Ada', 'Bruno', 'Clara', 'Dieter', 'Erika', 'Fritz', 'Greta', 'Hans'];
const BOT_DELAY = 750;
const AWAY_DELAY = 8000; // a disconnected human is auto-played after this

function emit(target, type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

function cleanId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

export class HostSession extends EventTarget {
  constructor({ name, clientId, net = null, room = null }) {
    super();
    this.isHost = true;
    this.net = net;
    this.room = room;
    this.myId = cleanId(clientId);
    this.game = new Game();
    this.game.addPlayer(this.myId, name);
    this.peerToPlayer = new Map();
    this.playerToPeer = new Map();
    this.links = new Map(); // playerId -> { state, route }
    this.botTimer = null;

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
      if (!res.ok) this.net.send(peerId, { t: 'error', message: res.error });
    }
  }

  #onJoin(peerId, msg) {
    const pid = cleanId(msg.clientId);
    if (!pid) return;
    let player = this.game.player(pid);
    if (!player) {
      if (this.game.phase !== 'lobby') {
        this.net.send(peerId, { t: 'error', message: 'This game has already started', fatal: true });
        return;
      }
      if (this.game.players.length >= MAX_PLAYERS) {
        this.net.send(peerId, { t: 'error', message: 'The table is full', fatal: true });
        return;
      }
      player = this.game.addPlayer(pid, msg.name);
    } else if (player.bot || pid === this.myId) {
      this.net.send(peerId, { t: 'error', message: 'Seat is taken', fatal: true });
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
        g.start();
        return;
      case 'addBot': {
        const used = new Set(g.players.map(p => p.name.replace(/\s*🤖$/, '')));
        const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
        g.addPlayer('bot-' + Math.random().toString(36).slice(2, 8), name + ' 🤖', { bot: true });
        return;
      }
      case 'removePlayer': {
        if (action.playerId === this.myId) throw new Error('You cannot remove yourself');
        const peer = this.playerToPeer.get(action.playerId);
        if (peer) {
          this.net.send(peer, { t: 'error', message: 'The host removed you from the table', fatal: true });
          this.net.kick(peer);
        }
        g.removePlayer(action.playerId);
        return;
      }
      default:
        throw new Error('Unknown action');
    }
  }

  apply(pid, action) {
    if (!action || typeof action !== 'object') return { ok: false, error: 'Bad action' };
    let res;
    if (['start', 'addBot', 'removePlayer', 'nextRound'].includes(action.type) && pid !== this.myId) {
      res = { ok: false, error: 'Only the host can do that' };
    } else if (['start', 'addBot', 'removePlayer'].includes(action.type)) {
      try { this.#hostAction(action); res = { ok: true }; } catch (e) { res = { ok: false, error: e.message }; }
    } else {
      res = this.game.apply(pid, action);
    }
    if (res.ok) this.broadcast();
    return res;
  }

  act(action) {
    const res = this.apply(this.myId, action);
    if (!res.ok) emit(this, 'error', { message: res.error });
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
    const cur = g.actor;
    if (!cur) return;
    const away = !cur.bot && cur.id !== this.myId && !this.playerToPeer.has(cur.id);
    if (!cur.bot && !away) return;
    this.botTimer = setTimeout(() => {
      if (g.actor !== cur) return;
      const action = botStep(g.view(cur.id));
      if (action && g.apply(cur.id, action).ok) this.broadcast();
    }, cur.bot || g.phase === 'play' ? (g.phase === 'cut' ? BOT_DELAY * 2 : BOT_DELAY) : AWAY_DELAY);
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

    net.addEventListener('open', () => net.send({ t: 'join', name, clientId: this.clientId }));
    net.addEventListener('message', (ev) => this.#onMessage(ev.detail));
    net.addEventListener('linkstate', (ev) => emit(this, 'link', ev.detail));
    net.addEventListener('close', () => this.#lost());
    net.addEventListener('hostleft', () => this.#lost());
  }

  #lost() {
    if (this.ended) return;
    emit(this, 'link', { state: 'offline', route: null });
    emit(this, 'disconnected', {});
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      this.myId = msg.you;
    } else if (msg.t === 'state') {
      this.view = msg.view;
      emit(this, 'state', { view: msg.view });
    } else if (msg.t === 'error') {
      if (msg.fatal) this.ended = true;
      emit(this, 'error', { message: msg.message, fatal: !!msg.fatal });
    }
  }

  act(action) {
    this.net.send({ t: 'action', action });
    return { ok: true };
  }

  close() {
    this.ended = true;
    this.net.close();
  }
}
