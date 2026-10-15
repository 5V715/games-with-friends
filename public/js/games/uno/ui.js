// UNO screen: player strip, draw/discard piles, your hand and buttons.
import { COLORS, playable } from './engine.js';
import { esc, choose } from '../../ui-kit.js';

const SYMBOL = { skip: '⊘', rev: '⇄', draw2: '+2', wild: '★', wild4: '+4' };

export function unoCardEl(card, { small = false } = {}) {
  const el = document.createElement('div');
  const wild = card.kind === 'wild' || card.kind === 'wild4';
  el.className = `ucard ${wild ? 'c-W' : 'c-' + card.color}${small ? ' small' : ''}`;
  el.dataset.id = card.id;
  const sym = card.kind === 'num' ? String(card.value) : SYMBOL[card.kind];
  el.innerHTML = `<span class="u-corner">${sym}</span><span class="u-oval"><span class="u-sym">${sym}</span></span>`;
  return el;
}

export function createUnoUI(ctx) {
  const { els, t, msg, act, toast } = ctx;
  let view = null;

  const me = () => view.players.find(p => p.id === view.you);
  const myTurn = () => view.phase === 'play' && view.turn === view.you;
  const canPlay = (c) => myTurn() && (!view.drawn || c.id === view.drawn) && playable(c, view.top, view.color);

  async function playCard(card) {
    if (!myTurn()) return toast(t('toast.waitTurn'));
    if (!canPlay(card)) return toast(t(view.drawn ? 'uno.err.onlyDrawn' : 'uno.err.notPlayable'), { error: true });
    let color;
    if (card.kind === 'wild' || card.kind === 'wild4') {
      color = await choose({
        title: t('uno.pickColor'),
        options: COLORS.map(c => ({ value: c, html: `<span class="swatch c-${c}"></span>${esc(t('uno.color.' + c))}`, className: 'color-btn' })),
        cancel: t('deal.opt.cancel'),
      });
      if (!color) return;
    }
    act({ type: 'play', cardId: card.id, color });
  }

  function renderPlayers() {
    const box = els.players;
    box.innerHTML = '';
    const arrow = document.createElement('span');
    arrow.className = 'dir-arrow';
    arrow.textContent = view.dir === 1 ? '↻' : '↺';
    box.append(arrow);
    for (const p of view.players) {
      const el = document.createElement('div');
      el.className = 'opp' + (p.id === view.turn ? ' turn' : '') + (p.id === view.you ? ' me' : '') + (ctx.speaking() === p.id ? ' speaking' : '');
      el.innerHTML = `
        <span class="mini-back uno-back">${p.count}</span>
        <span class="meta">
          <span class="oname">${esc(p.id === view.you ? t('game.you') : p.name)}</span>
          <span class="osub">${esc(t('game.pts', { n: p.score }))}${p.uno ? ' · <b class="uno-tag">1!</b>' : ''}</span>
        </span>
        <span class="link-dot ${ctx.dotClass(p)}"></span>`;
      box.append(el);
    }
    ctx.addSheetButton(box);
  }

  function renderBoard() {
    const main = els.main;
    main.innerHTML = '';
    const board = document.createElement('div');
    board.className = `uno-board glow-${view.color || 'none'}`;
    const deck = document.createElement('button');
    deck.className = 'uno-deck' + (myTurn() && !view.drawn ? ' active' : '');
    deck.innerHTML = `<span class="ucard back"><span class="u-oval"><span class="u-sym">1!</span></span></span><span class="pile-count">${view.deckCount}</span>`;
    deck.onclick = () => {
      if (!myTurn()) return toast(t('toast.waitTurn'));
      act({ type: 'draw' });
    };
    const pile = document.createElement('div');
    pile.className = 'uno-pile';
    if (view.top) pile.append(unoCardEl(view.top));
    const color = document.createElement('div');
    color.className = 'uno-color';
    color.innerHTML = view.color ? `<span class="swatch c-${view.color}"></span>${esc(t('uno.color.' + view.color))}` : '';
    board.append(deck, pile, color);
    main.append(board);
    const target = document.createElement('p');
    target.className = 'hint center';
    target.textContent = t('uno.target', { n: view.target });
    main.append(target);
  }

  function renderStatus() {
    const cur = view.players.find(p => p.id === view.turn);
    let line;
    if (view.phase === 'roundOver') line = t('uno.status.roundOver');
    else if (view.phase === 'gameOver') line = t('uno.status.gameOver');
    else if (myTurn()) line = view.drawn ? t('uno.status.drawn') : t('uno.status.yourTurn');
    else line = t('uno.status.other', { name: cur?.name || '…' });
    els.status.className = 'status play-status' + (myTurn() ? ' your-turn' : '');
    els.status.innerHTML = `<div class="main">${esc(line)}</div><div class="sub">${esc(msg(view.log[view.log.length - 1]))}</div>`;
  }

  function renderHand() {
    const hand = els.hand;
    hand.innerHTML = '';
    hand.className = 'play-hand uno-hand';
    for (const c of view.hand) {
      const el = unoCardEl(c);
      if (canPlay(c)) el.classList.add('playable');
      if (c.id === view.drawn) el.classList.add('new');
      el.onclick = () => playCard(c);
      hand.append(el);
    }
    ctx.fitHand(hand);
  }

  function renderButtons() {
    const box = els.buttons;
    box.innerHTML = '';
    const mine = me();
    if (view.phase === 'play') {
      if (myTurn()) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = view.drawn ? t('uno.pass') : t('uno.draw');
        b.onclick = () => act({ type: view.drawn ? 'pass' : 'draw' });
        box.append(b);
      }
      if (mine && view.hand.length <= 2 && !mine.uno) {
        const u = document.createElement('button');
        u.className = 'btn primary uno-btn' + (view.hand.length <= 2 && myTurn() ? ' pulse' : '');
        u.textContent = t('uno.unoBtn');
        u.onclick = () => act({ type: 'uno' });
        box.append(u);
      }
      const caught = view.players.find(p => p.vulnerable && p.id !== view.you);
      if (caught) {
        const c = document.createElement('button');
        c.className = 'btn danger pulse';
        c.textContent = t('uno.catch', { name: caught.name });
        c.onclick = () => act({ type: 'catch' });
        box.append(c);
      }
    }
  }

  return {
    render(v) {
      view = v;
      renderPlayers();
      renderBoard();
      renderStatus();
      renderHand();
      renderButtons();
    },

    // Data for the shared result / vote dialog.
    result(v) {
      if (v.phase !== 'roundOver' && v.phase !== 'gameOver') return null;
      const over = v.phase === 'gameOver';
      const rows = [...v.players].sort((a, b) => b.score - a.score);
      const r = v.result;
      const name = (p) => (p.id === v.you ? t('game.you') : p.name);
      let html = `<tr><th>${t('scores.player')}</th><th class="num">${t('scores.round')}</th><th class="num">${t('scores.total')}</th></tr>`;
      for (const p of rows) {
        const left = r?.hands?.[p.id] || [];
        const cards = left.length ? `<div class="left-cards">${left.map(c => unoCardEl(c, { small: true }).outerHTML).join('')}</div>` : '';
        html += `<tr class="${p.id === r?.winner ? 'winner' : ''}"><td>${esc(name(p))}${p.id === r?.winner ? ' 🏆' : ''}${cards}</td>` +
          `<td class="num">${r?.gained?.[p.id] ? t('uno.gained', { n: r.gained[p.id] }) : ''}</td><td class="num">${p.score}</td></tr>`;
      }
      const winner = v.players.find(p => p.id === r?.winner);
      const best = rows[0];
      return {
        key: `${v.gameNo}:${v.round}:${v.phase}`,
        title: over ? t('over.title') : winner?.id === v.you ? t('uno.youWinRound', { round: v.round }) : t('uno.roundWin', { name: winner?.name || '', round: v.round }),
        sub: over ? '🏆 ' + t('over.winner', { names: name(best), points: best.score }) : '',
        html,
        vote: !over,
        over,
        won: winner?.id === v.you,
      };
    },

    standings(v) {
      return [...v.players].sort((a, b) => b.score - a.score).map(p => ({ id: p.id, name: p.name, value: p.score }));
    },
  };
}
