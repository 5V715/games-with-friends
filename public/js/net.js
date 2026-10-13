// Peer-to-peer networking over WebRTC data channels.
//
// Topology is a star: the host opens one RTCPeerConnection per guest and runs
// the authoritative game. ICE (STUN/TURN) finds a path between the browsers;
// game messages never touch a server.
//
// Two ways to exchange the offer/answer + ICE candidates ("signaling"):
//   • Signaling – via the signaling server (server/, shipped as an OCI image),
//                 trickle ICE, automatic. The page itself is static (GitHub
//                 Pages); the server URL comes from config.js, the ?signal=
//                 URL parameter or the connection settings.
//   • Manual    – copy/paste a connection code (works with no server at all).

import { SIGNALING_URL } from '../config.js';

const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const TURN_KEY = 'romme.turn';
const SIGNAL_KEY = 'romme.signal';

function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

// Signaling server base URL: ?signal= parameter > saved setting > config.js.
export function signalingUrl() {
  const param = new URLSearchParams(location.search).get('signal');
  if (param) return normalizeUrl(param);
  let saved = '';
  try { saved = localStorage.getItem(SIGNAL_KEY) || ''; } catch { /* storage blocked */ }
  return normalizeUrl(saved || SIGNALING_URL);
}

export function savedSignalingUrl() {
  try { return localStorage.getItem(SIGNAL_KEY) || ''; } catch { return ''; }
}

export function saveSignalingUrl(u) {
  try {
    if (u) localStorage.setItem(SIGNAL_KEY, normalizeUrl(u));
    else localStorage.removeItem(SIGNAL_KEY);
  } catch { /* storage blocked */ }
  serverInfo = null;
}

export function defaultSignalingUrl() {
  return normalizeUrl(SIGNALING_URL);
}

export function randomId(len = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map(b => chars[b % chars.length]).join('');
}

export function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  return [...buf].map(b => chars[b % chars.length]).join('');
}

export function loadTurnSettings() {
  try { return JSON.parse(localStorage.getItem(TURN_KEY)) || {}; } catch { return {}; }
}

export function saveTurnSettings(s) {
  try { localStorage.setItem(TURN_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

let serverInfo = null; // { base, promise } – cached probe of the signaling server

async function probeServer(base) {
  if (!base) return { signaling: false, iceServers: DEFAULT_ICE };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${base}/api/ice`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.ok) {
      const body = await res.json();
      return { signaling: true, iceServers: body.iceServers?.length ? body.iceServers : DEFAULT_ICE };
    }
  } catch { /* server unreachable: manual codes only */ }
  return { signaling: false, iceServers: DEFAULT_ICE };
}

// Returns { base, signaling, iceServers, relayOnly }.
export async function getNetConfig() {
  const base = signalingUrl();
  if (!serverInfo || serverInfo.base !== base) serverInfo = { base, promise: probeServer(base) };
  const info = await serverInfo.promise;
  if (!info.signaling) serverInfo = null; // retry next time
  const iceServers = info.iceServers.slice();
  const turn = loadTurnSettings();
  if (turn.urls) {
    iceServers.push({
      urls: turn.urls.split(',').map(s => s.trim()).filter(Boolean),
      username: turn.username || undefined,
      credential: turn.credential || undefined,
    });
  }
  return { base, signaling: info.signaling, iceServers, relayOnly: !!turn.relayOnly };
}

// ---- Connection codes for manual signaling --------------------------------

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, ch => ch.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeCode(desc) {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  if (typeof CompressionStream === 'function') {
    return 'R1z' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  return 'R1p' + toBase64Url(raw);
}

export async function decodeCode(code) {
  code = String(code).replace(/\s+/g, '');
  const kind = code.slice(0, 3);
  let bytes = fromBase64Url(code.slice(3));
  if (kind === 'R1z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'R1p') throw new Error('Not a Rommé connection code');
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  return { type: obj.t, sdp: obj.s };
}

// ---- Server signaling channel ---------------------------------------------

export class Signaling extends EventTarget {
  constructor(base, room, peerId, role) {
    super();
    this.base = base;
    this.room = room;
    this.peerId = peerId;
    this.role = role;
    this.es = null;
  }

  // Resolves once the server has registered us in the room.
  connect() {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({ room: this.room, peer: this.peerId, role: this.role });
      this.es = new EventSource(`${this.base}/api/signal?${q}`);
      let settled = false;
      this.es.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.from === 'server' && msg.data.type === 'ready') {
          if (!settled) { settled = true; resolve(); }
          return;
        }
        if (msg.from === 'server' && msg.data.type === 'error') {
          this.close();
          if (!settled) { settled = true; reject(new Error(msg.data.code)); }
          else this.dispatchEvent(new CustomEvent('closed', { detail: { code: msg.data.code } }));
          return;
        }
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
      };
      this.es.onerror = () => {
        if (!settled && this.es.readyState === EventSource.CLOSED) {
          settled = true;
          reject(new Error('signaling-unavailable'));
        }
      };
    });
  }

  async send(to, data) {
    const res = await fetch(`${this.base}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: this.room, from: this.peerId, to, data }),
    });
    if (!res.ok) throw new Error(`signal failed (${res.status})`);
  }

  close() {
    this.es?.close();
    this.es = null;
  }
}

// ---- One WebRTC link (host ↔ guest) ---------------------------------------

export class PeerLink extends EventTarget {
  // sendSignal: function(data) for trickle signaling, or null for manual codes.
  constructor({ iceServers, initiator, sendSignal = null, relayOnly = false }) {
    super();
    this.initiator = initiator;
    this.sendSignal = sendSignal;
    this.pendingCandidates = [];
    this.state = 'new';
    this.route = null;
    this.pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: relayOnly ? 'relay' : 'all',
    });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate && this.sendSignal) this.sendSignal({ type: 'candidate', candidate: ev.candidate.toJSON() });
    };
    this.pc.oniceconnectionstatechange = () => this.#onIceState();
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.#onIceState();
    };

    if (initiator) {
      this.#setupChannel(this.pc.createDataChannel('romme', { ordered: true }));
    } else {
      this.pc.ondatachannel = (ev) => this.#setupChannel(ev.channel);
    }
  }

  #setupChannel(dc) {
    this.dc = dc;
    dc.onopen = () => {
      this.#setState('open');
      this.#updateRoute();
      this.dispatchEvent(new Event('open'));
    };
    dc.onclose = () => this.#emitClose();
    dc.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    };
  }

  #emitClose() {
    this.#setState('closed');
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  #setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent('state', { detail: s }));
  }

  #onIceState() {
    const s = this.pc.iceConnectionState;
    if (s === 'checking') this.#setState('connecting');
    else if (s === 'connected' || s === 'completed') {
      if (this.dc?.readyState === 'open') this.#setState('open');
      this.#updateRoute();
    } else if (s === 'disconnected') this.#setState('unstable');
    else if (s === 'failed') {
      this.#setState('failed');
      // Only the offering side restarts ICE; it needs live signaling.
      if (this.initiator && this.sendSignal) this.restartIce();
    }
  }

  // Looks up the selected candidate pair: host/srflx = direct, relay = TURN.
  async #updateRoute() {
    try {
      const stats = await this.pc.getStats();
      let pair = null;
      stats.forEach(r => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
      });
      if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      this.route = {
        relay,
        local: local?.candidateType,
        remote: remote?.candidateType,
        rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
      };
      this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
    } catch { /* stats not available */ }
  }

  async restartIce() {
    try {
      this.#setState('connecting');
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ type: 'offer', sdp: this.pc.localDescription.sdp });
    } catch (e) {
      console.warn('ICE restart failed', e);
    }
  }

  // Trickle mode: initiator sends the first offer.
  async start() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: this.pc.localDescription.sdp });
  }

  async handleSignal(data) {
    if (data.type === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await this.#flushCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignal({ type: 'answer', sdp: this.pc.localDescription.sdp });
    } else if (data.type === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this.#flushCandidates();
    } else if (data.type === 'candidate') {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate).catch(() => {});
      else this.pendingCandidates.push(data.candidate);
    }
  }

  async #flushCandidates() {
    const list = this.pendingCandidates.splice(0);
    for (const c of list) await this.pc.addIceCandidate(c).catch(() => {});
  }

  // Manual mode: wait until all candidates are inside the SDP.
  #gathered(timeoutMs = 6000) {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      this.pc.addEventListener('icegatheringstatechange', () => {
        if (this.pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
      });
    });
  }

  async createOfferCode() {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.#gathered();
    return encodeCode(this.pc.localDescription);
  }

  async acceptOfferCode(code) {
    const desc = await decodeCode(code);
    if (desc.type !== 'offer') throw new Error('That is a reply code — paste the host\'s invite code');
    await this.pc.setRemoteDescription(desc);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.#gathered();
    return encodeCode(this.pc.localDescription);
  }

  async acceptAnswerCode(code) {
    const desc = await decodeCode(code);
    if (desc.type !== 'answer') throw new Error('That is an invite code — paste the guest\'s reply code');
    await this.pc.setRemoteDescription(desc);
  }

  send(msg) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  close() {
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc.close(); } catch { /* ignore */ }
    this.#emitClose();
  }
}

// ---- Host side: many links ------------------------------------------------

export class HostNet extends EventTarget {
  constructor({ room, config }) {
    super();
    this.room = room;
    this.config = config;
    this.links = new Map(); // peerId -> PeerLink
    this.signaling = null;
  }

  async listen() {
    if (!this.config.signaling) return false;
    this.signaling = new Signaling(this.config.base, this.room, 'host', 'host');
    this.signaling.addEventListener('message', (ev) => this.#onSignal(ev.detail));
    this.signaling.addEventListener('closed', (ev) => {
      this.signaling = null;
      this.dispatchEvent(new CustomEvent('signalclosed', { detail: ev.detail }));
    });
    await this.signaling.connect();
    return true;
  }

  async #onSignal({ from, data }) {
    if (from === 'server') {
      if (data.type === 'peer-left') this.#drop(data.peer);
      return;
    }
    if (data.type === 'hello') {
      this.#drop(from);
      const link = this.#makeLink(from, (d) => this.signaling?.send(from, d).catch(() => {}));
      await link.start();
      return;
    }
    await this.links.get(from)?.handleSignal(data).catch(e => console.warn('signal error', e));
  }

  #makeLink(peerId, sendSignal) {
    const link = new PeerLink({
      iceServers: this.config.iceServers,
      relayOnly: this.config.relayOnly,
      initiator: true,
      sendSignal,
    });
    this.links.set(peerId, link);
    const emit = (type, detail) => this.dispatchEvent(new CustomEvent(type, { detail: { peerId, ...detail } }));
    link.addEventListener('message', (ev) => emit('message', { msg: ev.detail }));
    link.addEventListener('state', () => emit('linkstate', { state: link.state, route: link.route }));
    link.addEventListener('close', () => {
      if (this.links.get(peerId) === link) this.links.delete(peerId);
      emit('leave', {});
    });
    return link;
  }

  #drop(peerId) {
    const link = this.links.get(peerId);
    if (link) { this.links.delete(peerId); link.close(); }
  }

  // Manual invite: returns { peerId, code, accept(answerCode) }.
  async createManualInvite() {
    const peerId = 'm' + randomId(8);
    const link = this.#makeLink(peerId, null);
    const code = await link.createOfferCode();
    return {
      peerId,
      code,
      accept: (answer) => link.acceptAnswerCode(answer),
      cancel: () => this.#drop(peerId),
    };
  }

  send(peerId, msg) {
    this.links.get(peerId)?.send(msg);
  }

  kick(peerId) {
    this.#drop(peerId);
  }

  close() {
    for (const id of [...this.links.keys()]) this.#drop(id);
    this.signaling?.close();
  }
}

// ---- Guest side: one link to the host --------------------------------------

export class GuestNet extends EventTarget {
  constructor({ config }) {
    super();
    this.config = config;
    this.link = null;
    this.signaling = null;
  }

  #makeLink(sendSignal) {
    const old = this.link;
    this.link = null;
    old?.close();
    const link = new PeerLink({
      iceServers: this.config.iceServers,
      relayOnly: this.config.relayOnly,
      initiator: false,
      sendSignal,
    });
    this.link = link;
    link.addEventListener('open', () => this.dispatchEvent(new Event('open')));
    link.addEventListener('message', (ev) => this.dispatchEvent(new CustomEvent('message', { detail: ev.detail })));
    link.addEventListener('state', () => this.dispatchEvent(new CustomEvent('linkstate', { detail: { state: link.state, route: link.route } })));
    link.addEventListener('close', () => { if (this.link === link) this.dispatchEvent(new Event('close')); });
    return link;
  }

  async join(room) {
    this.signaling = new Signaling(this.config.base, room, randomId(10), 'guest');
    const send = (d) => this.signaling.send('host', d).catch(() => {});
    this.signaling.addEventListener('message', async ({ detail: { from, data } }) => {
      if (from === 'server') {
        if (data.type === 'host-left') this.dispatchEvent(new Event('hostleft'));
        return;
      }
      if (data.type === 'offer' && !this.link?.pc.remoteDescription) this.#makeLink(send);
      await this.link?.handleSignal(data).catch(e => console.warn('signal error', e));
    });
    await this.signaling.connect();
    await send({ type: 'hello' });
  }

  // Manual: turns the host's invite code into a reply code.
  async answerManual(code) {
    const link = this.#makeLink(null);
    return link.acceptOfferCode(code);
  }

  send(msg) {
    this.link?.send(msg);
  }

  close() {
    this.link?.close();
    this.signaling?.close();
  }
}
