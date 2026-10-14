// UI controller: screens, rendering, touch interaction and connection flows.

import { SUIT_SYMBOL, RED_SUITS } from './cards.js';
import { analyzeMeld, layOff, swapJoker } from './rules.js';
import { HostSession, GuestSession } from './session.js';
import { PushToTalk, VoicePlayer, voiceSupported, VOICE_MAX_MS } from './voice.js';
import { t, msg, applyI18n, setLang, savedLang, LANGS, rankName, lang as currentLang } from './i18n.js';
import { GAMES, GAME_IDS, gameInfo, DEFAULT_GAME } from './games/index.js';
import { createUnoUI } from './games/uno/ui.js';
import { createDealUI } from './games/deal/ui.js';
import { createBomberUI } from './games/bomber/ui.js';
import { closeChoice } from './ui-kit.js';

const PLAY_UIS = { uno: createUnoUI, deal: createDealUI, bomber: createBomberUI };
import {
  HostNet, GuestNet, getNetConfig, randomId, randomRoomCode, loadTurnSettings, saveTurnSettings,
  signalingUrl, savedSignalingUrl, saveSignalingUrl, defaultSignalingUrl,
} from './net.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------- storage

function store(kind, key, value) {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    s.setItem(key, value);
  } catch { /* storage blocked */ }
  return value;
}

// One id per browser tab so a reload reclaims the same seat.
const clientId = store('session', 'romme.cid') || store('session', 'romme.cid', 'p' + randomId(12));

// ---------------------------------------------------------------- state

const ui = {
  session: null,
  view: null,
  pendingView: null,
  room: null,
  mode: null, // 'practice' | 'online' | 'manual'
  handOrder: [],
  knownIds: new Set(),
  freshIds: new Set(),
  selected: new Set(),
  staged: [],
  // Players arrange their hand themselves (drag and drop); it is never sorted.
  shownResultKey: '',
  shownCutRound: 0,
  lastCutPrompt: 0,
  lastTurn: null,
  knownMelds: new Set(),
  link: null,
  reconnects: 0,
  invite: null,
  speaking: null, // player id whose voice message is playing
};

// ---------------------------------------------------------------- helpers

function show(screen) {
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === `screen-${screen}`);
}

let toastTimer;
function toast(msg, { error = false, ms = 2600 } = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  if (error) buzz(30);
}

function buzz(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

function playerName() {
  const n = $('#name').value.trim() || 'Player';
  store('local', 'romme.name', n);
  return n;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('toast.copied'));
}

function openDialog(id) {
  const d = document.getElementById(id);
  if (!d.open) d.showModal();
}

function closeDialog(id) {
  const d = document.getElementById(id);
  if (d.open) d.close();
}

// ---------------------------------------------------------------- cards

function cardEl(card, slot) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  if (card.joker) {
    el.classList.add('joker');
    el.innerHTML = '<span class="corner"><span>★</span><span class="s">J</span></span><span class="pip">★</span>';
    if (slot) {
      const as = document.createElement('span');
      as.className = 'as';
      as.textContent = rankName(slot.rank) + SUIT_SYMBOL[slot.suit];
      el.append(as);
    }
  } else {
    if (RED_SUITS.has(card.suit)) el.classList.add('red');
    const r = rankName(card.rank);
    const s = SUIT_SYMBOL[card.suit];
    el.innerHTML = `<span class="corner"><span>${r}</span><span class="s">${s}</span></span><span class="pip">${s}</span>`;
  }
  return el;
}

function meldEl(meld, { staged = false } = {}) {
  const el = document.createElement('div');
  el.className = 'meld';
  if (!staged) el.dataset.meld = meld.id;
  for (const s of meld.slots) el.append(cardEl(s.card, s));
  return el;
}

// ---------------------------------------------------------------- view helpers

const me = () => ui.view?.players.find(p => p.id === ui.view.you);
const myTurn = () => !!ui.view && ui.view.turn === ui.view.you;
const canPlay = () => myTurn() && ui.view.phase === 'play';
const handById = () => new Map((ui.view?.hand || []).map(c => [c.id, c]));
const stagedIds = () => new Set(ui.staged.flat());

function selectedCards() {
  const byId = handById();
  return [...ui.selected].map(id => byId.get(id)).filter(Boolean);
}

// ---------------------------------------------------------------- session wiring

function attach(session) {
  ui.session?.close();
  ui.session = session;
  ui.view = null;
  ui.pendingView = null;
  ui.handOrder = [];
  ui.knownIds = new Set();
  ui.selected.clear();
  ui.staged = [];
  ui.shownResultKey = '';
  ui.shownCutRound = 0;
  ui.lastCutPrompt = 0;
  ui.knownMelds = new Set();
  ui.link = null;
  ui.speaking = null;
  ui.play = null;
  document.body.classList.toggle('is-host', session.isHost);

  session.addEventListener('state', (ev) => {
    if (session !== ui.session) return;
    if (drag.active) ui.pendingView = ev.detail.view;
    else applyView(ev.detail.view);
  });
  session.addEventListener('error', (ev) => {
    if (session !== ui.session) return;
    toast(ev.detail.key ? t(ev.detail.key, ev.detail.params) : ev.detail.message, { error: true });
    if (ev.detail.fatal) leave();
  });
  session.addEventListener('link', (ev) => {
    if (session !== ui.session) return;
    ui.link = ev.detail;
    if (ev.detail.state === 'open') ui.reconnects = 0;
    renderLink();
  });
  session.addEventListener('frame', (ev) => {
    if (session !== ui.session) return;
    ui.play?.api.frame?.(ev.detail);
  });
  session.addEventListener('voice', (ev) => {
    if (session !== ui.session) return;
    voicePlayer.enqueue(ev.detail);
  });
  session.addEventListener('disconnected', () => {
    if (session !== ui.session) return;
    onGuestLost();
  });
}

function applyView(view) {
  const prev = ui.view;
  ui.view = view;
  if (ui.room == null && view.room) ui.room = view.room;

  // Keep the local hand order; append newly received cards at the end.
  const ids = view.hand.map(c => c.id);
  const idSet = new Set(ids);
  ui.freshIds = new Set(prev && prev.phase !== 'lobby' && prev.round === view.round
    ? ids.filter(id => !ui.knownIds.has(id)) : []);
  if (!prev || prev.round !== view.round || (prev.phase === 'cut' && view.phase !== 'cut')) {
    ui.handOrder = ids;
    ui.staged = [];
    ui.selected.clear();
  } else {
    ui.handOrder = ui.handOrder.filter(id => idSet.has(id)).concat(ids.filter(id => !ui.handOrder.includes(id)));
  }
  ui.knownIds = idSet;
  for (const id of [...ui.selected]) if (!idSet.has(id)) ui.selected.delete(id);
  ui.staged = ui.staged.filter(g => g.every(id => idSet.has(id)));
  for (const id of stagedIds()) ui.selected.delete(id);

  if (view.turn === view.you && ui.lastTurn !== view.you) buzz(25);
  ui.lastTurn = view.turn;

  render();
}

// ---------------------------------------------------------------- rendering

function render() {
  const v = ui.view;
  if (!v) return;
  const talk = ui.mode !== 'practice' && voiceSupported();
  for (const b of $$('.btn.ptt')) b.hidden = !talk;
  if (v.phase === 'lobby') {
    show('lobby');
    renderLobby();
    return;
  }
  if (v.game && v.game !== 'romme') {
    renderPlay(v);
    return;
  }
  show('game');
  closeDialog('dlg-invite');
  renderOpponents();
  renderTable();
  renderPiles();
  renderStaging();
  renderHand();
  renderActions();
  renderCut();
  renderRoundOver();
}

// ---------------------------------------------------------------- UNO / Monopoly Deal screen

function playUI(type) {
  if (ui.play?.type !== type) {
    ui.play = {
      type,
      api: PLAY_UIS[type]({
        els: { players: $('#play-players'), main: $('#play-main'), status: $('#play-status'), hand: $('#play-hand'), buttons: $('#play-buttons') },
        t, msg, toast, buzz,
        act: (a) => act(a),
        input: (inp) => ui.session?.input?.(inp),
        isHost: () => !!ui.session?.isHost,
        speaking: () => ui.speaking,
        dotClass: (p) => (p.id === ui.view.you && !ui.session.isHost ? linkDotClass() : dotClass(p)),
        fitHand: (hand) => fitCards(hand),
        addSheetButton: (box, show = true) => {
          if (!show || !ui.view.history?.length) return;
          const b = document.createElement('button');
          b.className = 'btn icon sheet-btn';
          b.textContent = '📊';
          b.title = t('sheet.open');
          b.setAttribute('aria-label', t('sheet.open'));
          b.onclick = openSheet;
          box.append(b);
        },
      }),
    };
  }
  return ui.play.api;
}

// Overlapping cards that always fit the width (like the Rommé hand).
function fitCards(hand) {
  const first = hand.firstElementChild;
  if (!first) return;
  const n = hand.children.length;
  const cw = first.offsetWidth;
  const step = n > 1 ? Math.min(cw + 6, (hand.clientWidth - cw) / (n - 1)) : cw;
  hand.style.setProperty('--step', `${Math.max(step, 14)}px`);
}

function renderPlay(v) {
  $('#screen-play').dataset.game = v.game;
  show('play');
  closeDialog('dlg-invite');
  const api = playUI(v.game);
  // Push to talk sits in the footer, unless the game screen offers a slot
  // for it (Bomber Buben: next to the A/B buttons).
  const ptt = $('#btn-ptt2');
  const footer = $('#screen-play .actions');
  if (ptt.parentElement !== footer) footer.append(ptt);
  api.render(v);
  $('#play-main [data-ptt-slot]')?.append(ptt);
  renderResult(v, api.result(v));
}

// Shared result dialog (round result + vote, or final standings).
function renderResult(v, res) {
  const open = $('#btn-result-open');
  open.hidden = !res;
  if (!res) {
    if (ui.resultFor === 'play') closeDialog('dlg-round');
    return;
  }
  ui.resultFor = 'play';
  open.textContent = res.over ? t('over.open') : t('round.open');
  $('#round-title').textContent = res.title;
  $('#round-sub').textContent = res.sub;
  $('#round-sub').hidden = !res.sub;
  $('#round-scores').innerHTML = res.html;
  $('#vote-box').hidden = !res.vote;
  $('#over-box').hidden = !res.over;
  if (res.vote) renderVotes();
  if (ui.shownResultKey === res.key) return;
  ui.shownResultKey = res.key;
  closeChoice();
  if (res.won) buzz([40, 60, 40]);
  setTimeout(() => openDialog('dlg-round'), 500);
}

// ---------------------------------------------------------------- game choice

function savedGame() {
  const g = store('local', 'romme.game');
  return GAMES[g] ? g : DEFAULT_GAME;
}

function renderGamePick(box, selected, onPick) {
  box.innerHTML = '';
  for (const id of GAME_IDS) {
    const b = document.createElement('button');
    b.className = 'game-opt' + (id === selected ? ' on' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', id === selected);
    b.innerHTML = `<span class="game-icon">${GAMES[id].icon}</span><span>${esc(t('game.' + id))}</span>`;
    b.onclick = () => onPick(id);
    box.append(b);
  }
}

function renderHomeGamePick() {
  renderGamePick($('#game-pick'), savedGame(), (id) => {
    store('local', 'romme.game', id);
    renderHomeGamePick();
  });
}

// ---------------------------------------------------------------- cutting the deck

const CUT_BACKS = 28;

function renderCut() {
  const v = ui.view;
  const panel = $('#cut-panel');
  panel.hidden = v.phase !== 'cut';
  $('#melds').hidden = v.phase === 'cut';
  if (v.phase === 'cut') {
    const mine = v.cutter === v.you;
    const cutter = v.players.find(p => p.id === v.cutter);
    $('#cut-title').textContent = mine ? t('cut.title') : t('cut.other', { name: cutter?.name || '…' });
    $('#cut-hint').hidden = !mine;
    const deck = $('#cut-deck');
    deck.classList.toggle('mine', mine);
    deck.classList.toggle('waiting', !mine);
    if (deck.children.length !== CUT_BACKS) {
      deck.innerHTML = '';
      for (let i = 0; i < CUT_BACKS; i++) {
        const c = document.createElement('div');
        c.className = 'card back';
        deck.append(c);
      }
    }
    if (mine && ui.lastCutPrompt !== v.round) {
      ui.lastCutPrompt = v.round;
      buzz(25);
    }
  }
  // Show the cutter what was at the cut, once per round.
  if (v.cut && ui.shownCutRound !== v.round && v.phase !== 'cut') {
    ui.shownCutRound = v.round;
    const kept = new Set(v.cut.kept);
    const peek = $('#cut-peek');
    peek.innerHTML = '';
    for (const c of v.cut.peek) {
      const el = cardEl(c);
      el.classList.add(kept.has(c.id) ? 'kept' : 'back-to-deck');
      peek.append(el);
    }
    const n = kept.size;
    $('#cut-result-title').textContent = n ? t('cut.kept', { n }) : t('cut.none');
    $('#cut-result-text').textContent = n ? t('cut.keptText') : t('cut.noneText');
    if (n) buzz([30, 50, 30]);
    openDialog('dlg-cut');
  }
}

function cutFraction(ev) {
  const r = $('#cut-deck').getBoundingClientRect();
  return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
}

function onCutMove(ev) {
  const v = ui.view;
  if (!v || v.phase !== 'cut' || v.cutter !== v.you) return;
  const deck = $('#cut-deck');
  const r = deck.getBoundingClientRect();
  const x = ev.clientX - r.left;
  deck.style.setProperty('--cut-x', `${x}px`);
  const cards = [...deck.children];
  for (const c of cards) {
    const cr = c.getBoundingClientRect();
    c.classList.toggle('lift', cr.left + cr.width / 2 > ev.clientX);
  }
}

function onCutUp(ev) {
  const v = ui.view;
  if (!v || v.phase !== 'cut' || v.cutter !== v.you) return;
  act({ type: 'cut', at: cutFraction(ev) });
}

function connChip(p) {
  const c = p.conn || {};
  if (c.state === 'host') return `<span class="chip ok">${t('conn.host')}</span>`;
  if (c.state === 'bot') return `<span class="chip">${t('conn.bot')}</span>`;
  if (c.state === 'open') {
    const kind = c.route ? (c.route.relay ? t('conn.relay') : t('conn.direct')) : t('conn.connected');
    const rtt = c.route?.rtt != null ? ` · ${c.route.rtt} ms` : '';
    return `<span class="chip ${c.route?.relay ? 'warn' : 'ok'}">${kind}${rtt}</span>`;
  }
  if (c.state === 'connecting' || c.state === 'new') return `<span class="chip warn">${t('conn.checking')}</span>`;
  if (c.state === 'unstable') return `<span class="chip warn">${t('conn.unstable')}</span>`;
  return `<span class="chip bad">${t('conn.offline')}</span>`;
}

function dotClass(p) {
  const s = p.conn?.state;
  if (s === 'host' || s === 'bot' || s === 'open') return 'ok';
  if (s === 'connecting' || s === 'unstable' || s === 'new') return 'warn';
  return 'bad';
}

function renderLobby() {
  const v = ui.view;
  $('#room-code').textContent = v.room || '—';
  $('#btn-share').hidden = !v.room;
  $('#room-box').hidden = !v.room;
  const list = $('#lobby-players');
  list.innerHTML = '';
  for (const p of v.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="pname">${esc(p.name)}${p.id === v.you ? t('lobby.you') : ''}${p.id === ui.speaking ? ' 🔊' : ''}</span>${connChip(p)}`;
    if (p.id === ui.speaking) li.classList.add('speaking');
    if (ui.session.isHost && p.id !== v.you) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = t('lobby.remove');
      b.onclick = () => ui.session.act({ type: 'removePlayer', playerId: p.id });
      li.append(b);
    }
    list.append(li);
  }
  const info = gameInfo(v.game);
  $('#lobby-game').innerHTML = `<span class="game-icon">${info.icon}</span> ${esc(t('game.' + info.id))}`;
  if (ui.session.isHost) {
    renderGamePick($('#lobby-game-pick'), info.id, (id) => {
      store('local', 'romme.game', id);
      ui.session.act({ type: 'setGame', game: id });
    });
  }
  $('#btn-start').disabled = v.players.length < info.min;
  $('#btn-add-bot').disabled = v.players.length >= info.max;
  $('#btn-manual-invite').disabled = v.players.length >= info.max;
  renderLink();
}

function renderLink() {
  const dot = $('#lobby-link');
  if (ui.session?.isHost) { dot.className = 'link-dot ok'; dot.title = t('lobby.youHost'); return; }
  const s = ui.link?.state;
  dot.className = 'link-dot ' + (s === 'open' ? 'ok' : s === 'offline' || s === 'failed' || s === 'closed' ? 'bad' : 'warn');
  dot.title = s || 'connecting';
  if (ui.view && ui.view.phase !== 'lobby') renderOpponents();
}

function renderOpponents() {
  const v = ui.view;
  const box = $('#opponents');
  box.innerHTML = '';
  for (const p of v.players) {
    const el = document.createElement('div');
    el.className = 'opp' + (p.id === v.turn ? ' turn' : '') + (p.id === v.you ? ' me' : '');
    if (p.id === ui.speaking) el.classList.add('speaking');
    const name = p.id === v.you ? t('game.you') : p.name;
    el.innerHTML = `
      <span class="mini-back">${p.count}</span>
      <span class="meta">
        <span class="oname">${esc(name)}</span>
        <span class="osub">${t('game.pts', { n: p.score })}${p.cameOut ? ' · ' + t('game.out') : ''}</span>
      </span>
      <span class="link-dot ${p.id === v.you && !ui.session.isHost ? linkDotClass() : dotClass(p)}"></span>`;
    box.append(el);
  }
  if (v.history?.length) {
    const b = document.createElement('button');
    b.className = 'btn icon sheet-btn';
    b.id = 'btn-sheet';
    b.textContent = '📊';
    b.title = t('sheet.open');
    b.setAttribute('aria-label', t('sheet.open'));
    box.append(b);
  }
  box.querySelector('.turn')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function linkDotClass() {
  const s = ui.link?.state;
  return s === 'open' ? 'ok' : (s === 'offline' || s === 'failed' || s === 'closed') ? 'bad' : 'warn';
}

function renderTable() {
  const box = $('#melds');
  box.innerHTML = '';
  box.dataset.empty = t('game.noMelds', { min: ui.view.minInitial });
  const sel = selectedCards();
  const canTarget = canPlay() && me()?.cameOut && sel.length > 0;
  for (const m of ui.view.melds) {
    const el = meldEl(m);
    if (!ui.knownMelds.has(m.id) && ui.knownMelds.size) el.classList.add('fresh');
    if (canTarget && (layOff(m, sel) || (sel.length === 1 && jokerSwapFor(m, sel[0])))) el.classList.add('target');
    box.append(el);
  }
  ui.knownMelds = new Set(ui.view.melds.map(m => m.id));
}

function jokerSwapFor(meld, card) {
  for (const s of meld.slots) {
    if (s.card.joker && swapJoker(meld, s.card.id, card)) return s.card.id;
  }
  return null;
}

function renderPiles() {
  const v = ui.view;
  const drawing = myTurn() && v.phase === 'draw';
  const stock = $('#stock');
  stock.classList.toggle('active', drawing);
  $('#stock-count').textContent = v.stockCount;

  const discard = $('#discard');
  discard.innerHTML = '';
  discard.classList.toggle('empty-pile', !v.discardTop);
  if (v.discardTop) {
    discard.append(cardEl(v.discardTop));
    const cnt = document.createElement('span');
    cnt.className = 'pile-count';
    cnt.textContent = v.discardCount;
    discard.append(cnt);
  }
  discard.classList.toggle('active', (drawing && !!v.discardTop && !!me()?.cameOut) || (canPlay() && ui.selected.size === 1));

  const status = $('#status');
  const cur = v.players.find(p => p.id === v.turn);
  let main;
  if (v.phase === 'cut') main = v.cutter === v.you ? t('game.statusCut') : t('game.statusCutting');
  else if (v.phase === 'roundOver') main = t('game.statusRoundOver');
  else if (v.phase === 'gameOver') main = t('game.statusGameOver');
  else if (myTurn()) main = v.phase === 'draw' ? t('game.statusDraw') : t('game.statusPlay');
  else main = t('game.statusOther', { name: cur?.name || '…' });
  status.className = 'status' + (myTurn() ? ' your-turn' : '');
  status.innerHTML = `<div class="main">${esc(main)}</div><div class="sub">${esc(msg(v.log[v.log.length - 1]))}</div>`;
}

function renderStaging() {
  const box = $('#staging');
  const byId = handById();
  box.hidden = !ui.staged.length;
  const groups = $('#staged-groups');
  groups.innerHTML = '';
  let total = 0;
  for (const g of ui.staged) {
    const m = analyzeMeld(g.map(id => byId.get(id)));
    if (!m) continue;
    total += m.points;
    groups.append(meldEl(m, { staged: true }));
  }
  const need = ui.view.minInitial;
  const pts = $('#staged-points');
  pts.textContent = me()?.cameOut ? t('game.stagedOut', { total }) : t('game.staged', { total, min: need });
  pts.classList.toggle('ok', total >= need || !!me()?.cameOut);
  const ready = canPlay() && (total >= need || me()?.cameOut);
  $('#btn-laydown').disabled = !ready;
  $('#btn-laydown').classList.toggle('pulse', ready);
}

function sortedHand() {
  const byId = handById();
  const hidden = stagedIds();
  return ui.handOrder.filter(id => !hidden.has(id)).map(id => byId.get(id)).filter(Boolean);
}

function renderHand() {
  const hand = $('#hand');
  hand.innerHTML = '';
  const cards = sortedHand();
  for (const c of cards) {
    const el = cardEl(c);
    if (ui.selected.has(c.id)) el.classList.add('selected');
    if (ui.freshIds.has(c.id)) el.classList.add('new');
    hand.append(el);
  }
  layoutHand();
}

function layoutHand() {
  const hand = $('#hand');
  const first = hand.firstElementChild;
  if (!first) return;
  const n = hand.children.length;
  const cw = first.offsetWidth;
  const width = hand.clientWidth;
  // While dragging, the placeholder and the card after it are shown in full
  // (not overlapped), so the gap is easy to see.
  const ph = [...hand.children].findIndex(el => el.classList.contains('placeholder'));
  const full = ph < 0 ? 0 : (ph > 0 ? 1 : 0) + (ph < n - 1 ? 1 : 0);
  const rest = n - 1 - full;
  const step = n > 1 ? Math.min(cw + 6, rest > 0 ? (width - cw - full * (cw + 4)) / rest : cw) : cw;
  hand.style.setProperty('--step', `${Math.max(step, 12)}px`);
}

function renderActions() {
  const sel = selectedCards();
  const play = canPlay();
  $('#btn-meld').disabled = !play || sel.length < 3;
  $('#btn-meld').textContent = me()?.cameOut ? t('game.meld') : t('game.group');
  $('#btn-discard').disabled = !play || sel.length !== 1;
}

function updateSelection() {
  for (const el of $$('#hand .card')) el.classList.toggle('selected', ui.selected.has(el.dataset.id));
  renderTable();
  renderPiles();
  renderActions();
}

function renderScoresTable(table, { withHands }) {
  const v = ui.view;
  const r = v.result;
  const rows = [...v.players].sort((a, b) => a.score - b.score);
  table.innerHTML = `<tr><th>${t('scores.player')}</th>${r && withHands ? `<th class="num">${t('scores.round')}</th>` : ''}<th class="num">${t('scores.total')}</th></tr>`;
  for (const p of rows) {
    const tr = document.createElement('tr');
    if (r && withHands && p.id === r.winner) tr.className = 'winner';
    const name = document.createElement('td');
    name.textContent = (p.id === v.you ? t('game.you') : p.name) + (r && withHands && p.id === r.winner ? ' 🏆' : '');
    if (r && withHands && r.hands[p.id]?.length) {
      const left = document.createElement('div');
      left.className = 'left-cards';
      for (const c of r.hands[p.id]) left.append(cardEl(c));
      name.append(left);
    }
    tr.append(name);
    if (r && withHands) {
      const pen = document.createElement('td');
      pen.className = 'num';
      pen.textContent = r.penalties[p.id] ? `+${r.penalties[p.id]}` : '0';
      tr.append(pen);
    }
    const total = document.createElement('td');
    total.className = 'num';
    total.textContent = p.score;
    tr.append(total);
    table.append(tr);
  }
}

// Every finished round as a table: one row per round, one column per player.
function renderSheet(table) {
  const v = ui.view;
  const players = v.players;
  const head = players.map(p => `<th class="num">${esc(p.id === v.you ? t('game.you') : p.name)}</th>`).join('');
  let html = `<tr><th>${t('sheet.round')}</th>${head}</tr>`;
  const uno = v.game === 'uno'; // UNO: the winner scores, highest total wins
  for (const h of v.history) {
    const cells = players.map(p => {
      const won = p.id === h.winner;
      const pts = uno ? (won ? `🏆 +${h.gained[p.id]}` : '–') : (won ? '🏆 0' : h.penalties[p.id] ?? 0);
      return `<td class="num${won ? ' won' : ''}">${pts}</td>`;
    }).join('');
    html += `<tr><td>${h.round}${h.handRomme ? ` <span class="chip warn">${t('sheet.hand')}</span>` : ''}</td>${cells}</tr>`;
  }
  const best = (uno ? Math.max : Math.min)(...players.map(p => p.score));
  const totals = players.map(p => `<td class="num${p.score === best ? ' best' : ''}">${p.score}</td>`).join('');
  html += `<tr class="total"><td>${t('sheet.total')}</td>${totals}</tr>`;
  table.innerHTML = html;
}

function openSheet() {
  if (!ui.view) return;
  renderSheet($('#sheet-table'));
  openDialog('dlg-sheet');
}

function renderVotes() {
  const v = ui.view;
  const list = $('#vote-list');
  list.innerHTML = '';
  for (const p of v.players) {
    const li = document.createElement('li');
    const vote = v.votes?.[p.id];
    const chip = vote === true ? `<span class="chip ok">✓ ${t('vote.again')}</span>`
      : vote === false ? `<span class="chip bad">✗ ${t('vote.stop')}</span>`
        : `<span class="chip">${t('vote.pending')}</span>`;
    li.innerHTML = `<span>${esc(p.id === v.you ? t('game.you') : p.name)}</span>${chip}`;
    list.append(li);
  }
  const mine = v.votes?.[v.you];
  $('#btn-vote-yes').classList.toggle('chosen', mine === true);
  $('#btn-vote-no').classList.toggle('chosen', mine === false);
}

function renderRoundOver() {
  const v = ui.view;
  ui.resultFor = 'romme';
  const over = v.phase === 'gameOver';
  const open = $('#btn-round-open');
  open.hidden = v.phase !== 'roundOver' && !over;
  open.textContent = over ? t('over.open') : t('round.open');
  if (v.phase !== 'roundOver' && !over) {
    closeDialog('dlg-round');
    return;
  }
  const sub = $('#round-sub');
  if (over) {
    const best = Math.min(...v.players.map(p => p.score));
    const names = v.players.filter(p => p.score === best).map(p => (p.id === v.you ? t('game.you') : p.name)).join(', ');
    $('#round-title').textContent = t('over.title');
    sub.textContent = '🏆 ' + t('over.winner', { names, points: best });
    sub.hidden = false;
    renderSheet($('#round-scores'));
  } else {
    const winner = v.players.find(p => p.id === v.result.winner);
    const who = winner.id === v.you ? t('round.youWin', { round: v.round }) : t('round.otherWins', { name: winner.name, round: v.round });
    $('#round-title').textContent = who + (v.result.handRomme ? t('round.hand') : '!');
    sub.hidden = true;
    renderScoresTable($('#round-scores'), { withHands: true });
    renderVotes();
  }
  $('#vote-box').hidden = over;
  $('#over-box').hidden = !over;

  // Open the dialog once per finished round and once when the game ends.
  const key = `${v.gameNo}:${v.round}:${v.phase}`;
  if (ui.shownResultKey === key) return;
  ui.shownResultKey = key;
  if (!over && v.result.winner === v.you) buzz([40, 60, 40]);
  setTimeout(() => openDialog('dlg-round'), 500);
}

// ---------------------------------------------------------------- actions

function act(action) {
  if (!ui.session) return { ok: false };
  const res = ui.session.act(action);
  if (res.ok) buzz();
  return res;
}

function onCardTap(id) {
  if (ui.selected.has(id)) ui.selected.delete(id);
  else ui.selected.add(id);
  buzz(6);
  updateSelection();
}

function drawFrom(from) {
  if (!myTurn()) return toast(t('toast.waitTurn'));
  if (ui.view.phase !== 'draw') return false;
  act({ type: 'draw', from });
  return true;
}

function discardCard(id) {
  if (!canPlay()) return toast(myTurn() ? t('err.drawFirst') : t('toast.waitTurn'));
  if (ui.staged.length) {
    toast(t('toast.stagedFirst'), { error: true });
    return;
  }
  ui.selected.delete(id);
  act({ type: 'discard', cardId: id });
}

function playOnMeld(meldId, ids) {
  if (!canPlay()) return toast(myTurn() ? t('err.drawFirst') : t('toast.waitTurn'));
  const meld = ui.view.melds.find(m => m.id === meldId);
  const byId = handById();
  const cards = ids.map(id => byId.get(id)).filter(Boolean);
  if (!meld || !cards.length) return;
  if (!me().cameOut) return toast(t('toast.layDownFirst', { min: ui.view.minInitial }), { error: true });
  if (cards.length === 1 && !cards[0].joker) {
    const jokerId = jokerSwapFor(meld, cards[0]);
    if (jokerId && !layOff(meld, cards)) {
      act({ type: 'swap', meldId, jokerId, cardId: cards[0].id });
      return;
    }
  }
  act({ type: 'layoff', meldId, cardIds: cards.map(c => c.id) });
}

function stageOrMeld(ids) {
  if (!canPlay()) return toast(myTurn() ? t('err.drawFirst') : t('toast.waitTurn'));
  const byId = handById();
  const cards = ids.map(id => byId.get(id)).filter(Boolean);
  const m = analyzeMeld(cards);
  if (!m) return toast(t('toast.invalidMeld'), { error: true });
  if (me().cameOut) {
    act({ type: 'meld', groups: [ids] });
    return;
  }
  ui.staged.push(ids);
  for (const id of ids) ui.selected.delete(id);
  buzz();
  render();
  const total = ui.staged.reduce((s, g) => s + analyzeMeld(g.map(id => byId.get(id))).points, 0);
  if (total < ui.view.minInitial) toast(t('toast.morePoints', { total, min: ui.view.minInitial }));
}

// ---------------------------------------------------------------- drag & drop
//
// Dragging a card (or all selected cards, if it is selected) lifts it out of
// the hand; a gold placeholder shows where it will land and the other cards
// slide aside to make room. Dropping on a meld, the discard pile or the
// staging area plays the cards there instead.

const HAND_ZONE_ABOVE = 80; // px above the hand that still counts as "hand"

const drag = {
  pointerId: null, start: null, id: null, el: null, active: false,
  ids: [], els: [], ghost: null, placeholder: null, target: null, offset: null,
};

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const meld = el?.closest('[data-meld]');
  if (meld) return { kind: 'meld', el: meld, meldId: Number(meld.dataset.meld) };
  const drop = el?.closest('[data-drop]');
  if (drop) return { kind: drop.dataset.drop, el: drop };
  const wrap = $('.hand-wrap').getBoundingClientRect();
  if (y >= wrap.top - HAND_ZONE_ABOVE && y <= wrap.bottom) return { kind: 'hand', el: $('#hand') };
  return null;
}

function setDropHover(target) {
  for (const el of $$('.drop-hover')) el.classList.remove('drop-hover');
  if (target && target.kind !== 'hand') target.el.classList.add('drop-hover');
  $('#hand').classList.toggle('drag-over', target?.kind === 'hand');
}

// The card the placeholder should sit in front of (null = at the end).
// Cards overlap, so each card's "slot" is the visible part left of the next one.
function slotBefore(x) {
  const cards = $$('#hand .card:not(.placeholder)');
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const next = cards[i + 1]?.getBoundingClientRect();
    const visible = next ? Math.max(8, next.left - r.left) : r.width;
    if (x < r.left + visible / 2) return cards[i];
  }
  return null;
}

// Moves the placeholder and animates the cards that shift (FLIP).
function movePlaceholder(before) {
  const hand = $('#hand');
  const ph = drag.placeholder;
  if ((before && ph.nextElementSibling === before) || (!before && hand.lastElementChild === ph)) return;
  const cards = [...hand.children];
  const from = new Map(cards.map(el => [el, el.getBoundingClientRect().left]));
  hand.insertBefore(ph, before);
  layoutHand();
  for (const el of cards) {
    const dx = from.get(el) - el.getBoundingClientRect().left;
    if (dx && el.animate) el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 140, easing: 'ease-out' });
  }
  buzz(4);
}

function makeGhost(els) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const r = els[0].getBoundingClientRect();
  els.forEach((el, i) => {
    const c = el.cloneNode(true);
    c.classList.remove('selected', 'new', 'pressed');
    c.style.cssText = `position:absolute;left:${i * 18}px;top:${i * 2}px;margin:0;width:${r.width}px;height:${r.height}px;`;
    ghost.append(c);
  });
  ghost.style.width = `${r.width + (els.length - 1) * 18}px`;
  ghost.style.height = `${r.height}px`;
  if (els.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'ghost-count';
    badge.textContent = els.length;
    ghost.append(badge);
  }
  document.body.append(ghost);
  return ghost;
}

function startDrag() {
  const hand = $('#hand');
  const order = sortedHand().map(c => c.id);
  drag.ids = ui.selected.has(drag.id) ? order.filter(id => ui.selected.has(id)) : [drag.id];
  drag.els = drag.ids.map(id => hand.querySelector(`.card[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
  const rect = drag.el.getBoundingClientRect();
  drag.offset = { x: drag.start.x - rect.left, y: drag.start.y - rect.top };
  drag.ghost = makeGhost(drag.el === drag.els[0] ? drag.els : [drag.el, ...drag.els.filter(e => e !== drag.el)]);

  const ph = document.createElement('div');
  ph.className = 'card placeholder';
  if (drag.ids.length > 1) ph.dataset.count = drag.ids.length;
  drag.placeholder = ph;
  hand.insertBefore(ph, drag.els[0]);
  for (const el of drag.els) el.remove();
  layoutHand();
  document.body.classList.add('dragging-cards');
  buzz(10);
}

function onPointerDown(ev) {
  const card = ev.target.closest('#hand .card');
  if (!card || drag.pointerId != null) return;
  Object.assign(drag, { pointerId: ev.pointerId, start: { x: ev.clientX, y: ev.clientY }, id: card.dataset.id, el: card, active: false });
  card.classList.add('pressed');
  // Capture on the hand: the card element itself leaves the DOM while dragging.
  capture($('#hand'), ev.pointerId);
}

function onPointerMove(ev) {
  if (ev.pointerId !== drag.pointerId) return;
  const dx = ev.clientX - drag.start.x;
  const dy = ev.clientY - drag.start.y;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < 8) return;
    drag.active = true;
    drag.el.classList.remove('pressed');
    startDrag();
  }
  const tilt = Math.max(-10, Math.min(10, dx / 14));
  drag.ghost.style.transform =
    `translate(${ev.clientX - drag.offset.x}px, ${ev.clientY - drag.offset.y - 24}px) rotate(${tilt}deg) scale(1.15)`;
  drag.target = dropTargetAt(ev.clientX, ev.clientY);
  setDropHover(drag.target);
  if (drag.target?.kind === 'hand') movePlaceholder(slotBefore(ev.clientX));
}

function onPointerUp(ev) {
  if (ev.pointerId !== drag.pointerId) return;
  const { id, active, target, ids, placeholder } = drag;
  drag.el?.classList.remove('pressed');
  let insertAt = -1;
  if (active && target?.kind === 'hand' && placeholder) {
    // Index among the remaining cards where the dragged ones go.
    insertAt = $$('#hand .card').indexOf(placeholder);
  }
  drag.ghost?.remove();
  setDropHover(null);
  document.body.classList.remove('dragging-cards');
  Object.assign(drag, { pointerId: null, start: null, id: null, el: null, active: false, ids: [], els: [], ghost: null, placeholder: null, target: null });

  if (!active) {
    if (ev.type === 'pointerup') onCardTap(id);
  } else {
    switch (target?.kind) {
      case 'hand': {
        const hidden = stagedIds();
        const moving = new Set(ids);
        const visible = ui.handOrder.filter(x => !hidden.has(x) && !moving.has(x));
        const anchor = visible[insertAt];
        const rest = ui.handOrder.filter(x => !moving.has(x));
        const idx = anchor ? rest.indexOf(anchor) : rest.length;
        rest.splice(idx, 0, ...ids);
        ui.handOrder = rest;
        buzz(6);
        break;
      }
      case 'discard': discardCard(id); break;
      case 'meld': playOnMeld(target.meldId, ids); break;
      case 'stage': if (ids.length >= 3) stageOrMeld(ids); else toast(t('toast.groupMin')); break;
      case 'stock': drawFrom('stock'); break;
      default: break;
    }
  }
  if (ui.pendingView) {
    const v = ui.pendingView;
    ui.pendingView = null;
    applyView(v);
  } else if (ui.view && ui.view.phase !== 'lobby') {
    renderHand();
    renderActions();
  }
}

// Invite link for this page; carries the signaling server if it isn't the default.
function roomUrl(room) {
  const q = new URLSearchParams({ room });
  const sig = signalingUrl();
  if (sig && sig !== defaultSignalingUrl()) q.set('signal', sig);
  return `${location.origin}${location.pathname}?${q}`;
}

// ---------------------------------------------------------------- push to talk

const ptt = new PushToTalk();
const voicePlayer = new VoicePlayer();

function speakerName(id) {
  const p = ui.view?.players.find(x => x.id === id);
  return p ? p.name : t('ptt.someone');
}

function setSpeaking(id) {
  ui.speaking = id;
  if (!ui.view) return;
  if (ui.view.phase === 'lobby') renderLobby();
  else renderOpponents();
}

voicePlayer.addEventListener('start', (ev) => {
  setSpeaking(ev.detail.from);
  toast(t('ptt.speaking', { name: speakerName(ev.detail.from) }), { ms: 1500 });
});
voicePlayer.addEventListener('end', (ev) => {
  setSpeaking(null);
  if (!ev.detail.ok) toast(t('ptt.playFailed', { name: speakerName(ev.detail.from) }), { error: true });
});

// The 🎤 button fills from left to right while recording (time used of the
// 15 s maximum) with a live waveform of the microphone level.
const WAVE_BARS = 60;
let waveLevels = [];
let waveFrame = 0;

function drawWave() {
  const prog = ptt.progress();
  const level = ptt.level();
  const bucket = Math.min(WAVE_BARS - 1, Math.floor(prog * WAVE_BARS));
  waveLevels[bucket] = Math.max(waveLevels[bucket] || 0, level);
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of $$('.btn.ptt .ptt-wave')) {
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) continue;
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const filled = prog * w;
    g.fillStyle = 'rgba(255, 255, 255, .22)';
    g.fillRect(0, 0, filled, h);
    const barW = w / WAVE_BARS;
    g.fillStyle = 'rgba(255, 255, 255, .9)';
    for (let i = 0; i <= bucket; i++) {
      const bh = Math.max(2 * dpr, (waveLevels[i] || 0) * h * 0.8);
      g.fillRect(i * barW + barW * 0.2, (h - bh) / 2, Math.max(1, barW * 0.6), bh);
    }
    g.fillStyle = '#fff';
    g.fillRect(Math.min(filled, w - 2 * dpr), 0, 2 * dpr, h);
  }
  const left = Math.max(0, Math.ceil((1 - prog) * VOICE_MAX_MS / 1000));
  $('#ptt-time').textContent = `${t('ptt.left', { s: left })} · ${t('ptt.release')}`;
  waveFrame = requestAnimationFrame(drawWave);
}

function clearWave() {
  cancelAnimationFrame(waveFrame);
  waveLevels = [];
  for (const canvas of $$('.btn.ptt .ptt-wave')) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

ptt.addEventListener('state', (ev) => {
  const recording = ev.detail === 'recording';
  for (const b of $$('.btn.ptt')) b.classList.toggle('recording', ev.detail !== 'idle');
  $('#ptt-indicator').hidden = !recording;
  clearWave();
  if (ev.detail === 'idle') voicePlayer.resume();
  else voicePlayer.hold(); // don't play others' messages into your microphone
  if (recording) {
    buzz(15);
    drawWave();
  }
});

ptt.addEventListener('clip', async (ev) => {
  const s = ui.session;
  if (!s?.canTalk) return toast(t('ptt.nobody'), { error: true });
  try {
    await s.sendVoice(ev.detail.blob);
    buzz(8);
    toast(t('ptt.sent', { s: (ev.detail.ms / 1000).toFixed(1) }), { ms: 1200 });
  } catch {
    toast(t('ptt.sendFailed'), { error: true });
  }
});

// setPointerCapture throws if the browser no longer tracks the pointer.
function capture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
}

function bindPushToTalk(btn) {
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    voicePlayer.unlock();
    if (!ui.session?.canTalk) return toast(t('ptt.nobodyYet'), { error: true });
    capture(btn, e.pointerId);
    ptt.start().catch((err) => {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      toast(denied ? t('ptt.denied') : t('ptt.noMic'), { error: true });
    });
  });
  const release = () => { ptt.stop(); };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', release);
}

// ---------------------------------------------------------------- connection flows

async function startPractice() {
  ui.mode = 'practice';
  ui.room = null;
  const s = new HostSession({ name: playerName(), clientId, gameType: savedGame() });
  attach(s);
  const bots = Number($('#bot-count').value) || 2;
  for (let i = 0; i < bots; i++) s.act({ type: 'addBot' });
  s.act({ type: 'start' });
}

async function hostOnline() {
  const btn = $('#btn-host');
  btn.disabled = true;
  try {
    const config = await getNetConfig();
    ui.mode = 'online';
    let room = randomRoomCode();
    const net = new HostNet({ room, config });
    if (config.signaling) {
      try { await net.listen(); } catch (e) {
        if (e.message === 'room-taken') { room = randomRoomCode(); net.room = room; await net.listen(); } else throw e;
      }
    } else {
      room = null;
      toast(t('toast.noSignalHost'));
    }
    ui.room = room;
    const s = new HostSession({ name: playerName(), clientId, net, room, gameType: savedGame() });
    attach(s);
    net.addEventListener('signalclosed', (ev) => {
      if (ui.session !== s) return;
      s.room = null;
      ui.room = null;
      history.replaceState(null, '', location.pathname + location.search.replace(/([?&])room=[^&]*&?/, '$1').replace(/[?&]$/, ''));
      toast(ev.detail.code === 'room-expired' ? t('toast.codeExpired') : t('toast.codeClosed'), { error: true, ms: 6000 });
      s.broadcast();
    });
    s.broadcast();
    if (room) history.replaceState(null, '', roomUrl(room));
  } catch (e) {
    toast(t('toast.createFailed', { error: e.message }), { error: true });
  } finally {
    btn.disabled = false;
  }
}

const JOIN_ERRORS = {
  'no-host': 'toast.noHost',
  'room-full': 'toast.roomFull',
  'signaling-unavailable': 'toast.sigUnreachable',
};

async function joinOnline(room, { quiet = false } = {}) {
  room = String(room || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) return toast(t('toast.enterCode'), { error: true });
  $('#btn-join').classList.remove('hint');
  const config = await getNetConfig();
  if (!config.signaling) return toast(t('toast.noSignalJoin'), { error: true });
  ui.mode = 'online';
  ui.room = room;
  const net = new GuestNet({ config });
  const s = new GuestSession({ name: playerName(), clientId, net });
  attach(s);
  show('lobby');
  renderLobbyConnecting(room);
  try {
    await net.join(room);
    history.replaceState(null, '', roomUrl(room));
    store('session', 'romme.activeRoom', room);
  } catch (e) {
    if (quiet) throw e;
    toast(JOIN_ERRORS[e.message] ? t(JOIN_ERRORS[e.message]) : t('toast.joinFailed', { error: e.message }), { error: true });
    leave();
  }
}

function renderLobbyConnecting(room) {
  $('#lobby-game').textContent = '';
  $('#lobby-game-pick').innerHTML = '';
  $('#room-code').textContent = room || '—';
  $('#btn-share').hidden = !room;
  $('#room-box').hidden = false;
  $('#lobby-players').innerHTML = `<li><span class="pname">${t('lobby.connecting')}</span><span class="chip warn">${t('conn.checking')}</span></li>`;
  renderLink();
}

async function onGuestLost() {
  if (ui.mode === 'online' && ui.room && ui.reconnects < 5) {
    ui.reconnects++;
    toast(t('toast.reconnecting'), { error: true });
    await new Promise(r => setTimeout(r, 1500 * ui.reconnects));
    if (!ui.session || ui.session.isHost) return;
    const room = ui.room;
    try {
      await joinOnline(room, { quiet: true });
    } catch {
      onGuestLost();
    }
    return;
  }
  toast(t('toast.disconnected'), { error: true });
  leave();
}

function leave() {
  const s = ui.session;
  ui.session = null;
  ui.view = null;
  ui.room = null;
  ui.reconnects = 0;
  store('session', 'romme.activeRoom', '');
  s?.close();
  for (const d of $$('dialog')) if (d.open) d.close();
  const keep = new URLSearchParams(location.search).get('signal');
  history.replaceState(null, '', location.pathname + (keep ? `?signal=${encodeURIComponent(keep)}` : ''));
  show('home');
}

// Host: manual invite (copy/paste SDP, no server needed).
async function openManualInvite() {
  const s = ui.session;
  if (!s?.isHost || !s.net) return;
  ui.invite?.cancel();
  $('#invite-code').value = '';
  $('#invite-answer').value = '';
  openDialog('dlg-invite');
  try {
    ui.invite = await s.net.createManualInvite();
    $('#invite-code').value = ui.invite.code;
  } catch (e) {
    toast(t('toast.inviteFailed', { error: e.message }), { error: true });
  }
}

async function connectManualInvite() {
  const answer = $('#invite-answer').value.trim();
  if (!ui.invite || !answer) return toast(t('toast.pasteReply'), { error: true });
  try {
    await ui.invite.accept(answer);
    ui.invite = null;
    closeDialog('dlg-invite');
    toast(t('toast.connecting'));
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// Guest: manual join.
async function makeManualAnswer() {
  const code = $('#join-offer').value.trim();
  if (!code) return toast(t('toast.pasteInvite'), { error: true });
  const btn = $('#btn-make-answer');
  btn.disabled = true;
  try {
    const config = await getNetConfig();
    ui.mode = 'manual';
    ui.room = null;
    const net = new GuestNet({ config });
    const s = new GuestSession({ name: playerName(), clientId, net });
    attach(s);
    const answer = await net.answerManual(code);
    $('#join-answer').value = answer;
    $('#join-answer-box').hidden = false;
    s.addEventListener('state', () => closeDialog('dlg-manual-join'), { once: true });
  } catch (e) {
    toast(e.message || t('toast.invalidInvite'), { error: true });
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- menu & settings

function openMenu() {
  if (!ui.view) return;
  if (ui.view.game && ui.view.game !== 'romme' && ui.play) {
    const rows = ui.play.api.standings(ui.view);
    $('#menu-scores').innerHTML = `<tr><th>${t('scores.player')}</th><th class="num">${t('scores.total')}</th></tr>` +
      rows.map(r => `<tr><td>${esc(r.id === ui.view.you ? t('game.you') : r.name)}</td><td class="num">${esc(r.value)}</td></tr>`).join('');
  } else {
    renderScoresTable($('#menu-scores'), { withHands: false });
  }
  $('#btn-menu-sheet').hidden = !ui.view.history?.length;
  const info = $('#menu-conn');
  if (ui.mode === 'practice') info.textContent = t('menu.practice');
  else if (ui.session?.isHost) {
    const peers = ui.view.players.filter(p => !p.bot && p.id !== ui.view.you);
    info.innerHTML = (ui.room ? t('menu.hostingRoom', { room: esc(ui.room) }) : t('menu.hosting')) + ' ' +
      peers.map(p => `${esc(p.name)}: ${connChip(p)}`).join(' ');
  } else {
    const r = ui.link?.route;
    info.textContent = t('menu.linkHost', { state: ui.link?.state || t('menu.unknown') }) +
      (r ? ` · ${r.relay ? t('menu.relayed') : t('menu.direct', { local: r.local, remote: r.remote })}${r.rtt != null ? ` · ${r.rtt} ms` : ''}` : '');
  }
  openDialog('dlg-menu');
}

function openSettings() {
  $('#lang-select').value = savedLang();
  $('#signal-url').value = savedSignalingUrl();
  $('#signal-url').placeholder = defaultSignalingUrl() || 'https://signal.example.com';
  const s = loadTurnSettings();
  $('#turn-urls').value = s.urls || '';
  $('#turn-user').value = s.username || '';
  $('#turn-pass').value = s.credential || '';
  $('#turn-relay').checked = !!s.relayOnly;
}

function saveSettings() {
  const urls = $('#turn-urls').value.trim();
  const relayOnly = $('#turn-relay').checked;
  if (relayOnly && !urls) return toast(t('toast.relayNeedsTurn'), { error: true });
  if (urls && !urls.split(',').every(u => /^turns?:/.test(u.trim()))) {
    return toast(t('toast.turnUrl'), { error: true });
  }
  saveTurnSettings({ urls, username: $('#turn-user').value.trim(), credential: $('#turn-pass').value, relayOnly });
  saveSignalingUrl($('#signal-url').value.trim());
  setLang($('#lang-select').value);
  closeDialog('dlg-settings');
  translatePage();
  toast(t('toast.saved'));
}

// Language buttons (start screen and menu). The choice is saved on this
// device and wins over the browser language from then on.
function chooseLang(code) {
  setLang(code);
  const q = new URLSearchParams(location.search);
  if (q.has('lang')) {
    q.delete('lang'); // a ?lang= link would otherwise override the saved choice
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : ''));
    setLang(code);
  }
  translatePage();
}

function renderLangSwitches() {
  for (const box of $$('[data-lang-switch]')) {
    box.innerHTML = '';
    for (const [code, name] of Object.entries(LANGS)) {
      const b = document.createElement('button');
      b.className = 'lang-opt' + (code === currentLang ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', code === currentLang);
      b.textContent = code.toUpperCase();
      b.title = name;
      b.onclick = () => chooseLang(code);
      box.append(b);
    }
  }
}

// Applies the current language to all static and rendered text.
function translatePage() {
  renderLangSwitches();
  applyI18n();
  renderHomeGamePick();
  for (const o of $('#bot-count').options) o.textContent = t('home.bots', { n: Number(o.value) });
  const sel = $('#lang-select');
  sel.options[0].textContent = t('settings.langAuto');
  for (const o of [...sel.options].slice(1)) o.textContent = LANGS[o.value];
  updateServerNote();
  if (ui.view) render();
}

// ---------------------------------------------------------------- init

function bind() {
  const langSel = $('#lang-select');
  for (const code of Object.keys(LANGS)) langSel.append(new Option(LANGS[code], code));
  translatePage();
  $('#name').value = store('local', 'romme.name') || '';
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) {
    $('#room-input').value = room.toUpperCase();
    // A guest who reloads the page rejoins their seat automatically.
    if (store('session', 'romme.activeRoom') === room.toUpperCase()) setTimeout(() => joinOnline(room), 0);
    else {
      setTimeout(() => ($('#name').value ? $('#btn-join') : $('#name')).focus(), 50);
      // Invited by link: show where to tap.
      $('#btn-join').classList.add('hint');
    }
  }

  $('#btn-host').onclick = hostOnline;
  $('#btn-join').onclick = () => joinOnline($('#room-input').value);
  $('#room-input').addEventListener('input', () => {
    if (!$('#room-input').value.trim()) $('#btn-join').classList.remove('hint');
  });
  $('#room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinOnline($('#room-input').value); });
  $('#btn-practice').onclick = startPractice;
  $('#btn-manual-join').onclick = () => {
    $('#join-offer').value = '';
    $('#join-answer').value = '';
    $('#join-answer-box').hidden = true;
    openDialog('dlg-manual-join');
  };
  $('#btn-make-answer').onclick = makeManualAnswer;
  $('#btn-copy-answer').onclick = () => copyText($('#join-answer').value);
  $('#btn-manual-cancel').onclick = () => {
    closeDialog('dlg-manual-join');
    if (ui.mode === 'manual' && !ui.view) leave();
  };

  // Lobby
  $('#btn-leave-lobby').onclick = leave;
  $('#btn-add-bot').onclick = () => ui.session?.act({ type: 'addBot' });
  $('#btn-start').onclick = () => ui.session?.act({ type: 'start' });
  $('#btn-manual-invite').onclick = openManualInvite;
  $('#btn-copy-invite').onclick = () => copyText($('#invite-code').value);
  $('#btn-invite-connect').onclick = connectManualInvite;
  $('#btn-invite-cancel').onclick = () => {
    ui.invite?.cancel();
    ui.invite = null;
    closeDialog('dlg-invite');
  };
  $('#btn-share').onclick = async () => {
    const url = roomUrl(ui.room);
    if (navigator.share) {
      try { await navigator.share({ title: 'Games with Friends', text: t('lobby.shareText', { room: ui.room }), url }); return; } catch { /* cancelled */ }
    }
    copyText(url);
  };

  // Game
  $('#stock').onclick = () => drawFrom('stock');
  $('#discard').onclick = () => {
    if (drawFrom('discard')) return;
    if (canPlay() && ui.selected.size === 1) discardCard([...ui.selected][0]);
    else if (canPlay()) toast(t('toast.selectOne'));
  };
  $('#melds').addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-meld]');
    if (!m) return;
    if (!ui.selected.size) return toast(t('toast.selectFirst'));
    playOnMeld(Number(m.dataset.meld), [...ui.selected]);
  });
  $('#btn-meld').onclick = () => stageOrMeld([...ui.selected]);
  $('#btn-discard').onclick = () => { if (ui.selected.size === 1) discardCard([...ui.selected][0]); };
  $('#btn-unstage').onclick = () => { ui.staged.pop(); render(); };
  $('#btn-laydown').onclick = () => {
    if (ui.staged.length) act({ type: 'meld', groups: ui.staged });
  };
  $('#btn-menu').onclick = openMenu;
  $('#btn-quit').onclick = () => { if (confirm(t('menu.leaveConfirm'))) leave(); };
  $('#btn-vote-yes').onclick = () => act({ type: 'vote', yes: true });
  $('#btn-vote-no').onclick = () => act({ type: 'vote', yes: false });
  $('#btn-new-game').onclick = () => { closeDialog('dlg-round'); act({ type: 'newGame' }); };
  $('#btn-over-leave').onclick = leave;
  $('#btn-round-open').onclick = () => openDialog('dlg-round');
  $('#btn-menu-sheet').onclick = () => { closeDialog('dlg-menu'); openSheet(); };
  $('#opponents').addEventListener('click', (e) => { if (e.target.closest('#btn-sheet')) openSheet(); });

  const cutDeck = $('#cut-deck');
  cutDeck.addEventListener('pointerdown', (e) => { capture(cutDeck, e.pointerId); onCutMove(e); });
  cutDeck.addEventListener('pointermove', onCutMove);
  cutDeck.addEventListener('pointerup', onCutUp);

  bindPushToTalk($('#btn-ptt'));
  bindPushToTalk($('#btn-ptt2'));
  $('#btn-menu2').onclick = openMenu;
  $('#btn-result-open').onclick = () => openDialog('dlg-round');
  bindPushToTalk($('#btn-ptt-lobby'));
  // Mobile browsers only play audio after a gesture: unlock on the first tap.
  document.addEventListener('pointerdown', () => voicePlayer.unlock(), { capture: true, once: true });

  const hand = $('#hand');
  hand.addEventListener('pointerdown', onPointerDown);
  hand.addEventListener('pointermove', onPointerMove);
  hand.addEventListener('pointerup', onPointerUp);
  hand.addEventListener('pointercancel', onPointerUp);
  hand.addEventListener('contextmenu', (e) => e.preventDefault());

  // Dialog helpers
  document.addEventListener('click', (ev) => {
    const open = ev.target.closest('[data-open]');
    if (open) {
      if (open.dataset.open === 'dlg-settings') openSettings();
      if (open.dataset.open === 'dlg-rules') {
        const game = ui.view && ui.view.phase !== 'lobby' ? ui.view.game : ui.view?.game || savedGame();
        $('#dlg-rules h2').textContent = `${t('rules.title')} · ${t('game.' + gameInfo(game).id)}`;
        $('#dlg-rules .rules').innerHTML = t(gameInfo(game).rules);
      }
      openDialog(open.dataset.open);
    }
    const close = ev.target.closest('[data-close]');
    if (close) close.closest('dialog').close();
  });
  $('#btn-save-settings').onclick = saveSettings;

  window.addEventListener('resize', () => layoutHand());
}

function updateServerNote() {
  const note = $('#server-note');
  note.textContent = t('home.sigChecking');
  getNetConfig().then(cfg => {
    note.textContent = cfg.signaling
      ? t('home.sigOk', { host: new URL(cfg.base).host })
      : cfg.base
        ? t('home.sigDown', { host: new URL(cfg.base).host })
        : t('home.sigNone');
  });
}

bind();
