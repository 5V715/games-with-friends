// Push-to-talk voice messages.
//
// Hold the button to record (MediaRecorder, Opus where available), release
// to send. Clips travel over the existing WebRTC data channels, split into
// small chunks; the host forwards them to everyone else at the table.
// Receivers play clips immediately, one after another.

export const VOICE_MAX_MS = 15000;
export const VOICE_MIN_MS = 300;
const CHUNK_BYTES = 12 * 1024; // raw bytes per data channel message
const MAX_CHUNKS = 64; // 768 KB, far more than 15 s of speech needs
const MIME_RE = /^audio\/(webm|ogg|mp4|mpeg|aac)(;.*)?$/;
const RELEASE_MIC_AFTER_MS = 60000;

export function voiceSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext);
}

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

// ---- recording --------------------------------------------------------------

export class PushToTalk extends EventTarget {
  constructor() {
    super();
    this.stream = null;
    this.recorder = null;
    this.recording = false;
    this.pendingStop = false;
    this.releaseTimer = null;
    this.maxTimer = null;
  }

  async #mic() {
    clearTimeout(this.releaseTimer);
    const live = this.stream?.getAudioTracks().some(t => t.readyState === 'live');
    if (!live) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    return this.stream;
  }

  // Keep the mic open for a minute so quick follow-ups start instantly,
  // then release it (turns off the browser's recording indicator).
  #scheduleRelease() {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.stream?.getTracks().forEach(t => t.stop());
      this.stream = null;
    }, RELEASE_MIC_AFTER_MS);
  }

  async start() {
    if (this.recording) return;
    this.recording = true;
    this.pendingStop = false;
    this.dispatchEvent(new CustomEvent('state', { detail: 'starting' }));
    let stream;
    try {
      stream = await this.#mic();
    } catch (e) {
      this.recording = false;
      this.dispatchEvent(new CustomEvent('state', { detail: 'idle' }));
      throw e;
    }
    // Released before the mic was ready: nothing to record.
    if (this.pendingStop) {
      this.recording = false;
      this.#scheduleRelease();
      this.dispatchEvent(new CustomEvent('state', { detail: 'idle' }));
      return;
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    this.recorder = rec;
    this.startedAt = performance.now();
    this.done = new Promise(resolve => {
      rec.onstop = () => {
        const ms = performance.now() - this.startedAt;
        const type = rec.mimeType || mimeType || 'audio/webm';
        resolve(ms >= VOICE_MIN_MS && parts.length ? { blob: new Blob(parts, { type }), ms } : null);
      };
    });
    rec.start();
    this.maxTimer = setTimeout(() => this.stop(), VOICE_MAX_MS);
    this.dispatchEvent(new CustomEvent('state', { detail: 'recording' }));
  }

  // Resolves with { blob, ms } or null (too short / cancelled).
  async stop() {
    if (!this.recording) return null;
    clearTimeout(this.maxTimer);
    if (!this.recorder) {
      this.pendingStop = true;
      return null;
    }
    const rec = this.recorder;
    this.recorder = null;
    if (rec.state !== 'inactive') rec.stop();
    const result = await this.done;
    this.recording = false;
    this.#scheduleRelease();
    this.dispatchEvent(new CustomEvent('state', { detail: 'idle' }));
    if (result) this.dispatchEvent(new CustomEvent('clip', { detail: result }));
    return result;
  }
}

// ---- chunking ---------------------------------------------------------------

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Splits a clip into data channel messages.
export async function clipToMessages(blob, from) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const total = Math.ceil(bytes.length / CHUNK_BYTES);
  if (!total || total > MAX_CHUNKS) return [];
  const id = Math.random().toString(36).slice(2, 12);
  const mime = blob.type || 'audio/webm';
  const msgs = [];
  for (let seq = 0; seq < total; seq++) {
    msgs.push({ t: 'voice', id, seq, total, mime, from, data: toBase64(bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)) });
  }
  return msgs;
}

export function validVoiceMessage(m) {
  return m && m.t === 'voice' && typeof m.id === 'string' && m.id.length <= 32 &&
    Number.isInteger(m.seq) && Number.isInteger(m.total) && m.total > 0 && m.total <= MAX_CHUNKS &&
    m.seq >= 0 && m.seq < m.total && typeof m.mime === 'string' && MIME_RE.test(m.mime) &&
    typeof m.data === 'string' && m.data.length <= Math.ceil(CHUNK_BYTES / 3) * 4 + 4;
}

// Collects chunks and returns { from, blob } once a clip is complete.
export class VoiceAssembler {
  constructor() {
    this.pending = new Map();
  }

  add(m) {
    if (!validVoiceMessage(m)) return null;
    const key = `${m.from}:${m.id}`;
    let p = this.pending.get(key);
    if (!p) {
      p = { parts: new Array(m.total), got: 0, total: m.total, mime: m.mime, from: m.from };
      p.timer = setTimeout(() => this.pending.delete(key), 30000);
      p.timer.unref?.();
      this.pending.set(key, p);
    }
    if (m.total !== p.total || p.parts[m.seq]) return null;
    p.parts[m.seq] = fromBase64(m.data);
    if (++p.got < p.total) return null;
    clearTimeout(p.timer);
    this.pending.delete(key);
    return { from: p.from, blob: new Blob(p.parts, { type: p.mime }) };
  }
}

// ---- playback ---------------------------------------------------------------

export class VoicePlayer extends EventTarget {
  constructor() {
    super();
    this.queue = [];
    this.playing = false;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.unlocked = false;
  }

  // Mobile browsers only allow audio after a user gesture; call this from one.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    // A tiny silent WAV, played once inside the gesture, unlocks the element.
    this.audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    this.audio.play().catch(() => { this.unlocked = false; });
  }

  enqueue(clip) {
    if (this.queue.length > 10) return;
    this.queue.push(clip);
    if (!this.playing) this.#next();
  }

  async #next() {
    const clip = this.queue.shift();
    if (!clip) {
      this.playing = false;
      return;
    }
    this.playing = true;
    const url = URL.createObjectURL(clip.blob);
    const finish = (ok) => {
      URL.revokeObjectURL(url);
      this.audio.onended = this.audio.onerror = null;
      this.dispatchEvent(new CustomEvent('end', { detail: { from: clip.from, ok } }));
      this.#next();
    };
    this.audio.onended = () => finish(true);
    this.audio.onerror = () => finish(false);
    this.audio.src = url;
    this.dispatchEvent(new CustomEvent('start', { detail: { from: clip.from } }));
    try {
      await this.audio.play();
    } catch {
      finish(false);
    }
  }
}
