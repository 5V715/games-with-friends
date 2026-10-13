// UI controller: screens, rendering, touch interaction and connection flows.

import { SUIT_SYMBOL, RED_SUITS, SUITS, rankLabel, penalty } from './cards.js';
import { analyzeMeld, layOff, swapJoker } from './rules.js';
import { HostSession, GuestSession } from './session.js';
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
  sortMode: 'suit',
  shownResultRound: 0,
  lastTurn: null,
  knownMelds: new Set(),
  link: null,
  reconnects: 0,
  invite: null,
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
  toast('Copied');
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
      as.textContent = rankLabel(slot.rank) + SUIT_SYMBOL[slot.suit];
      el.append(as);
    }
  } else {
    if (RED_SUITS.has(card.suit)) el.classList.add('red');
    const r = rankLabel(card.rank);
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
  ui.shownResultRound = 0;
  ui.knownMelds = new Set();
  ui.link = null;
  document.body.classList.toggle('is-host', session.isHost);

  session.addEventListener('state', (ev) => {
    if (session !== ui.session) return;
    if (drag.active) ui.pendingView = ev.detail.view;
    else applyView(ev.detail.view);
  });
  session.addEventListener('error', (ev) => {
    if (session !== ui.session) return;
    toast(ev.detail.message, { error: true });
    if (ev.detail.fatal) leave();
  });
  session.addEventListener('link', (ev) => {
    if (session !== ui.session) return;
    ui.link = ev.detail;
    if (ev.detail.state === 'open') ui.reconnects = 0;
    renderLink();
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
  if (!prev || prev.round !== view.round) {
    ui.handOrder = ids;
    ui.staged = [];
    ui.selected.clear();
    sortHand(ui.sortMode);
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
  if (v.phase === 'lobby') {
    show('lobby');
    renderLobby();
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
  renderRoundOver();
}

function connChip(p) {
  const c = p.conn || {};
  if (c.state === 'host') return '<span class="chip ok">host</span>';
  if (c.state === 'bot') return '<span class="chip">bot</span>';
  if (c.state === 'open') {
    const kind = c.route ? (c.route.relay ? 'relay (TURN)' : 'direct P2P') : 'connected';
    const rtt = c.route?.rtt != null ? ` · ${c.route.rtt} ms` : '';
    return `<span class="chip ${c.route?.relay ? 'warn' : 'ok'}">${kind}${rtt}</span>`;
  }
  if (c.state === 'connecting' || c.state === 'new') return '<span class="chip warn">ICE checking…</span>';
  if (c.state === 'unstable') return '<span class="chip warn">unstable</span>';
  return '<span class="chip bad">offline</span>';
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
  $('#room-box').hidden = !v.room && !ui.session.isHost;
  const list = $('#lobby-players');
  list.innerHTML = '';
  for (const p of v.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="pname">${esc(p.name)}${p.id === v.you ? ' (you)' : ''}</span>${connChip(p)}`;
    if (ui.session.isHost && p.id !== v.you) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = 'Remove';
      b.onclick = () => ui.session.act({ type: 'removePlayer', playerId: p.id });
      li.append(b);
    }
    list.append(li);
  }
  $('#btn-start').disabled = v.players.length < 2;
  $('#btn-add-bot').disabled = v.players.length >= 6;
  $('#btn-manual-invite').disabled = v.players.length >= 6;
  renderLink();
}

function renderLink() {
  const dot = $('#lobby-link');
  if (ui.session?.isHost) { dot.className = 'link-dot ok'; dot.title = 'You are the host'; return; }
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
    const name = p.id === v.you ? 'You' : p.name;
    el.innerHTML = `
      <span class="mini-back">${p.count}</span>
      <span class="meta">
        <span class="oname">${esc(name)}</span>
        <span class="osub">${p.score} pts${p.cameOut ? ' · out ✓' : ''}</span>
      </span>
      <span class="link-dot ${p.id === v.you && !ui.session.isHost ? linkDotClass() : dotClass(p)}"></span>`;
    box.append(el);
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
  if (v.phase === 'roundOver') main = 'Round over';
  else if (myTurn()) main = v.phase === 'draw' ? 'Your turn — draw a card' : 'Meld, then discard';
  else main = `${cur?.name || '…'} is playing`;
  status.className = 'status' + (myTurn() ? ' your-turn' : '');
  status.innerHTML = `<div class="main">${esc(main)}</div><div class="sub">${esc(v.log[v.log.length - 1] || '')}</div>`;
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
  pts.textContent = me()?.cameOut ? `${total} pts` : `${total} / ${need} pts`;
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
  const step = n > 1 ? Math.min(cw + 6, (width - cw) / (n - 1)) : cw;
  hand.style.setProperty('--step', `${Math.max(step, 12)}px`);
}

function renderActions() {
  const sel = selectedCards();
  const play = canPlay();
  $('#btn-meld').disabled = !play || sel.length < 3;
  $('#btn-meld').textContent = me()?.cameOut ? 'Meld' : 'Group';
  $('#btn-discard').disabled = !play || sel.length !== 1;
  $('#btn-sort').textContent = ui.sortMode === 'suit' ? 'Sort ♠♥' : 'Sort 7‑7';
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
  table.innerHTML = `<tr><th>Player</th>${r && withHands ? '<th class="num">Round</th>' : ''}<th class="num">Total</th></tr>`;
  for (const p of rows) {
    const tr = document.createElement('tr');
    if (r && withHands && p.id === r.winner) tr.className = 'winner';
    const name = document.createElement('td');
    name.textContent = (p.id === v.you ? 'You' : p.name) + (r && withHands && p.id === r.winner ? ' 🏆' : '');
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

function renderRoundOver() {
  const v = ui.view;
  if (v.phase !== 'roundOver') {
    closeDialog('dlg-round');
    return;
  }
  if (ui.shownResultRound === v.round) return;
  ui.shownResultRound = v.round;
  const winner = v.players.find(p => p.id === v.result.winner);
  const who = winner.id === v.you ? 'You win' : `${winner.name} wins`;
  $('#round-title').textContent = `${who} round ${v.round}${v.result.handRomme ? ' — Hand‑Rommé! ×2' : '!'}`;
  renderScoresTable($('#round-scores'), { withHands: true });
  if (winner.id === v.you) buzz([40, 60, 40]);
  setTimeout(() => openDialog('dlg-round'), 500);
}

// ---------------------------------------------------------------- actions

function act(action) {
  if (!ui.session) return { ok: false };
  const res = ui.session.act(action);
  if (res.ok) buzz();
  return res;
}

function sortHand(mode) {
  const byId = handById();
  const key = (c) => {
    if (c.joker) return [9, 99];
    const r = c.rank === 1 ? 14 : c.rank;
    return mode === 'suit' ? [SUITS.indexOf(c.suit), r] : [r, SUITS.indexOf(c.suit)];
  };
  ui.handOrder.sort((a, b) => {
    const ka = key(byId.get(a));
    const kb = key(byId.get(b));
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
}

function onCardTap(id) {
  if (ui.selected.has(id)) ui.selected.delete(id);
  else ui.selected.add(id);
  buzz(6);
  updateSelection();
}

function drawFrom(from) {
  if (!myTurn()) return toast('Wait for your turn');
  if (ui.view.phase !== 'draw') return false;
  act({ type: 'draw', from });
  return true;
}

function discardCard(id) {
  if (!canPlay()) return toast(myTurn() ? 'Draw a card first' : 'Wait for your turn');
  if (ui.staged.length) {
    toast('Lay down or undo your staged groups first', { error: true });
    return;
  }
  ui.selected.delete(id);
  act({ type: 'discard', cardId: id });
}

function playOnMeld(meldId, ids) {
  if (!canPlay()) return toast(myTurn() ? 'Draw a card first' : 'Wait for your turn');
  const meld = ui.view.melds.find(m => m.id === meldId);
  const byId = handById();
  const cards = ids.map(id => byId.get(id)).filter(Boolean);
  if (!meld || !cards.length) return;
  if (!me().cameOut) return toast(`Lay down ${ui.view.minInitial} points first`, { error: true });
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
  if (!canPlay()) return toast(myTurn() ? 'Draw a card first' : 'Wait for your turn');
  const byId = handById();
  const cards = ids.map(id => byId.get(id)).filter(Boolean);
  const m = analyzeMeld(cards);
  if (!m) return toast('That is not a valid set or run', { error: true });
  if (me().cameOut) {
    act({ type: 'meld', groups: [ids] });
    return;
  }
  ui.staged.push(ids);
  for (const id of ids) ui.selected.delete(id);
  buzz();
  render();
  const total = ui.staged.reduce((s, g) => s + analyzeMeld(g.map(id => byId.get(id))).points, 0);
  if (total < ui.view.minInitial) toast(`${total} of ${ui.view.minInitial} points — add more groups`);
}

// ---------------------------------------------------------------- drag & drop

const drag = { active: false, start: null, id: null, el: null, ghost: null, target: null, pointerId: null };

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const meld = el.closest('[data-meld]');
  if (meld) return { kind: 'meld', el: meld, meldId: Number(meld.dataset.meld) };
  const drop = el.closest('[data-drop]');
  if (drop) return { kind: drop.dataset.drop, el: drop };
  if (el.closest('.hand-wrap')) return { kind: 'hand', el: $('#hand') };
  return null;
}

function setDropHover(target) {
  for (const el of $$('.drop-hover, .drop-before')) el.classList.remove('drop-hover', 'drop-before');
  if (!target) return;
  if (target.kind === 'hand') {
    const before = handInsertBefore(drag.lastX);
    before?.classList.add('drop-before');
  } else {
    target.el.classList.add('drop-hover');
  }
}

// Cards overlap, so only the first `--step` pixels of each card are visible.
function handInsertBefore(x) {
  const step = parseFloat(getComputedStyle($('#hand')).getPropertyValue('--step')) || 0;
  const cards = $$('#hand .card').filter(el => el !== drag.el);
  return cards.find((el, i) => {
    const r = el.getBoundingClientRect();
    const visible = i === cards.length - 1 ? r.width : Math.min(r.width, step || r.width);
    return x < r.left + visible / 2;
  }) || null;
}

// Invite link for this page; carries the signaling server if it isn't the default.
function roomUrl(room) {
  const q = new URLSearchParams({ room });
  const sig = signalingUrl();
  if (sig && sig !== defaultSignalingUrl()) q.set('signal', sig);
  return `${location.origin}${location.pathname}?${q}`;
}

function onPointerDown(ev) {
  const card = ev.target.closest('#hand .card');
  if (!card || drag.pointerId != null) return;
  drag.pointerId = ev.pointerId;
  drag.start = { x: ev.clientX, y: ev.clientY };
  drag.id = card.dataset.id;
  drag.el = card;
  drag.active = false;
  card.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev) {
  if (ev.pointerId !== drag.pointerId) return;
  const dx = ev.clientX - drag.start.x;
  const dy = ev.clientY - drag.start.y;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < 10) return;
    drag.active = true;
    const rect = drag.el.getBoundingClientRect();
    drag.offset = { x: drag.start.x - rect.left, y: drag.start.y - rect.top };
    const ghost = drag.el.cloneNode(true);
    ghost.classList.remove('selected', 'new');
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = '0';
    document.body.append(ghost);
    drag.ghost = ghost;
    drag.el.classList.add('dragging');
  }
  drag.lastX = ev.clientX;
  drag.ghost.style.transform =
    `translate(${ev.clientX - drag.offset.x}px, ${ev.clientY - drag.offset.y}px) rotate(${Math.max(-12, Math.min(12, dx / 12))}deg) scale(1.08)`;
  drag.target = dropTargetAt(ev.clientX, ev.clientY);
  setDropHover(drag.target);
}

function onPointerUp(ev) {
  if (ev.pointerId !== drag.pointerId) return;
  const { id, active, target } = drag;
  const before = active && target?.kind === 'hand' ? handInsertBefore(ev.clientX) : null;
  drag.ghost?.remove();
  drag.el?.classList.remove('dragging');
  setDropHover(null);
  Object.assign(drag, { active: false, start: null, id: null, el: null, ghost: null, target: null, pointerId: null });

  if (!active) {
    if (ev.type === 'pointerup') onCardTap(id);
  } else {
    const ids = ui.selected.has(id) ? [...ui.selected] : [id];
    switch (target?.kind) {
      case 'hand': {
        ui.handOrder = ui.handOrder.filter(x => x !== id);
        const idx = before ? ui.handOrder.indexOf(before.dataset.id) : ui.handOrder.length;
        ui.handOrder.splice(idx, 0, id);
        buzz(6);
        break;
      }
      case 'discard': discardCard(id); break;
      case 'meld': playOnMeld(target.meldId, ids); break;
      case 'stage': if (ids.length >= 3) stageOrMeld(ids); break;
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

// ---------------------------------------------------------------- connection flows

async function startPractice() {
  ui.mode = 'practice';
  ui.room = null;
  const s = new HostSession({ name: playerName(), clientId });
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
      toast('No signaling server — invite players with codes');
    }
    ui.room = room;
    const s = new HostSession({ name: playerName(), clientId, net, room });
    attach(s);
    s.broadcast();
    if (room) history.replaceState(null, '', roomUrl(room));
  } catch (e) {
    toast(`Could not create table: ${e.message}`, { error: true });
  } finally {
    btn.disabled = false;
  }
}

const JOIN_ERRORS = {
  'no-host': 'No table with that code (is the host still on the lobby page?)',
  'room-full': 'That table is full',
  'signaling-unavailable': 'Signaling server unreachable',
};

async function joinOnline(room, { quiet = false } = {}) {
  room = String(room || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) return toast('Enter the table code', { error: true });
  const config = await getNetConfig();
  if (!config.signaling) return toast('No signaling server configured or reachable — use an invite code', { error: true });
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
    toast(JOIN_ERRORS[e.message] || `Could not join: ${e.message}`, { error: true });
    leave();
  }
}

function renderLobbyConnecting(room) {
  $('#room-code').textContent = room || '—';
  $('#btn-share').hidden = !room;
  $('#room-box').hidden = false;
  $('#lobby-players').innerHTML = '<li><span class="pname">Connecting to host…</span><span class="chip warn">ICE checking…</span></li>';
  renderLink();
}

async function onGuestLost() {
  if (ui.mode === 'online' && ui.room && ui.reconnects < 5) {
    ui.reconnects++;
    toast('Connection lost — reconnecting…', { error: true });
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
  toast('Disconnected from the host', { error: true });
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
    toast(`Could not create invite: ${e.message}`, { error: true });
  }
}

async function connectManualInvite() {
  const answer = $('#invite-answer').value.trim();
  if (!ui.invite || !answer) return toast('Paste the reply code first', { error: true });
  try {
    await ui.invite.accept(answer);
    ui.invite = null;
    closeDialog('dlg-invite');
    toast('Connecting… (ICE checks running)');
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// Guest: manual join.
async function makeManualAnswer() {
  const code = $('#join-offer').value.trim();
  if (!code) return toast('Paste the invite code first', { error: true });
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
    toast(e.message || 'Invalid invite code', { error: true });
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- menu & settings

function openMenu() {
  if (!ui.view) return;
  renderScoresTable($('#menu-scores'), { withHands: false });
  const info = $('#menu-conn');
  if (ui.mode === 'practice') info.textContent = 'Practice game (offline).';
  else if (ui.session?.isHost) {
    const peers = ui.view.players.filter(p => !p.bot && p.id !== ui.view.you);
    info.innerHTML = `You are hosting${ui.room ? ` table <b>${esc(ui.room)}</b>` : ''}. ` +
      peers.map(p => `${esc(p.name)}: ${connChip(p)}`).join(' ');
  } else {
    const r = ui.link?.route;
    info.textContent = `Connection to host: ${ui.link?.state || 'unknown'}` +
      (r ? ` · ${r.relay ? 'relayed via TURN' : `direct (${r.local}↔${r.remote})`}${r.rtt != null ? ` · ${r.rtt} ms` : ''}` : '');
  }
  openDialog('dlg-menu');
}

function openSettings() {
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
  if (relayOnly && !urls) return toast('Relay-only needs a TURN server', { error: true });
  if (urls && !urls.split(',').every(u => /^turns?:/.test(u.trim()))) {
    return toast('TURN URLs start with turn: or turns:', { error: true });
  }
  saveTurnSettings({ urls, username: $('#turn-user').value.trim(), credential: $('#turn-pass').value, relayOnly });
  saveSignalingUrl($('#signal-url').value.trim());
  closeDialog('dlg-settings');
  toast('Saved — applies to new connections');
  updateServerNote();
}

// ---------------------------------------------------------------- init

function bind() {
  $('#name').value = store('local', 'romme.name') || '';
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) {
    $('#room-input').value = room.toUpperCase();
    // A guest who reloads the page rejoins their seat automatically.
    if (store('session', 'romme.activeRoom') === room.toUpperCase()) setTimeout(() => joinOnline(room), 0);
    else setTimeout(() => ($('#name').value ? $('#btn-join') : $('#name')).focus(), 50);
  }

  $('#btn-host').onclick = hostOnline;
  $('#btn-join').onclick = () => joinOnline($('#room-input').value);
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
      try { await navigator.share({ title: 'Rommé', text: `Join my Rommé table ${ui.room}`, url }); return; } catch { /* cancelled */ }
    }
    copyText(url);
  };

  // Game
  $('#stock').onclick = () => drawFrom('stock');
  $('#discard').onclick = () => {
    if (drawFrom('discard')) return;
    if (canPlay() && ui.selected.size === 1) discardCard([...ui.selected][0]);
    else if (canPlay()) toast('Select one card to discard');
  };
  $('#melds').addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-meld]');
    if (!m) return;
    if (!ui.selected.size) return toast('Select cards from your hand first');
    playOnMeld(Number(m.dataset.meld), [...ui.selected]);
  });
  $('#btn-meld').onclick = () => stageOrMeld([...ui.selected]);
  $('#btn-discard').onclick = () => { if (ui.selected.size === 1) discardCard([...ui.selected][0]); };
  $('#btn-sort').onclick = () => {
    ui.sortMode = ui.sortMode === 'suit' ? 'rank' : 'suit';
    sortHand(ui.sortMode);
    renderHand();
    renderActions();
  };
  $('#btn-unstage').onclick = () => { ui.staged.pop(); render(); };
  $('#btn-laydown').onclick = () => {
    if (ui.staged.length) act({ type: 'meld', groups: ui.staged });
  };
  $('#btn-menu').onclick = openMenu;
  $('#btn-quit').onclick = () => { if (confirm('Leave this game?')) leave(); };
  $('#btn-next-round').onclick = () => { closeDialog('dlg-round'); ui.session?.act({ type: 'nextRound' }); };

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
      openDialog(open.dataset.open);
    }
    const close = ev.target.closest('[data-close]');
    if (close) close.closest('dialog').close();
  });
  $('#btn-save-settings').onclick = saveSettings;

  window.addEventListener('resize', () => layoutHand());

  updateServerNote();
}

function updateServerNote() {
  const note = $('#server-note');
  note.textContent = 'Checking signaling server…';
  getNetConfig().then(cfg => {
    note.textContent = cfg.signaling
      ? `Signaling: ${new URL(cfg.base).host} · games run peer‑to‑peer over WebRTC`
      : cfg.base
        ? `Signaling server ${new URL(cfg.base).host} unreachable · use invite codes`
        : 'No signaling server configured · use invite codes to connect';
  });
}

bind();
