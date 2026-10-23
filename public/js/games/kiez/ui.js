// Knobel-Kiez screen: player strip, the shared score sheet (one column per
// player), the five dice and the roll / enter buttons.
import { CATEGORIES, UPPER, BONUS_AT, KING_BONUS, scoreFor, jokerFor, totals } from './engine.js';
import { esc } from '../../ui-kit.js';

// Pip positions on a 3×3 grid for each face.
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const ROLL_MS = 520;

export function dieHtml(value) {
  const on = new Set(PIPS[value] || []);
  return Array.from({ length: 9 }, (_, i) => `<i${on.has(i) ? ' class="on"' : ''}></i>`).join('');
}

export function createKiezUI(ctx) {
  const { els, t, msg, act, toast } = ctx;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let view = null;
  let held = [false, false, false, false, false]; // my holds, sent along with the next roll
  let seen = { rollNo: -1, turn: null };
  let picked = null; // box chosen but not yet entered
  let rollingUntil = 0;

  const me = () => view.players.find(p => p.id === view.you);
  const myTurn = () => view.phase === 'play' && view.turn === view.you;
  const canHold = () => myTurn() && view.rolled && view.rollsLeft > 0;
  const name = (p) => (p.id === view.you ? t('game.you') : p.name);

  function preview(cat) {
    const sheet = me().sheet;
    return scoreFor(cat, view.dice, { joker: jokerFor(sheet, view.dice) });
  }

  function enter(cat) {
    if (!myTurn()) return toast(t('toast.waitTurn'));
    if (!view.rolled) return toast(t('kiez.err.rollFirst'));
    picked = null;
    act({ type: 'score', cat });
  }

  function pick(cat) {
    if (!myTurn() || !view.rolled || me().sheet[cat] != null) return;
    if (picked === cat) return enter(cat);
    picked = cat;
    ctx.buzz?.(6);
    renderSheet();
    renderButtons();
  }

  function renderPlayers() {
    const box = els.players;
    box.innerHTML = '';
    for (const p of view.players) {
      const el = document.createElement('div');
      el.className = 'opp' + (p.id === view.turn ? ' turn' : '') + (p.id === view.you ? ' me' : '') + (ctx.speaking() === p.id ? ' speaking' : '');
      el.innerHTML = `
        <span class="mini-back kz-mini">🎲</span>
        <span class="meta">
          <span class="oname">${esc(name(p))}</span>
          <span class="osub">${esc(t('game.pts', { n: p.total }))}${view.round > 1 ? ` · Σ ${p.score + (view.phase === 'play' ? p.total : 0)}` : ''}</span>
        </span>
        <span class="link-dot ${ctx.dotClass(p)}"></span>`;
      box.append(el);
    }
    ctx.addSheetButton(box);
  }

  function renderSheet() {
    const main = els.main;
    const players = view.players;
    const cols = players.map(p => `<th class="${p.id === view.turn ? 'turn' : ''}${p.id === view.you ? ' mine' : ''}">${esc(name(p))}</th>`).join('');
    let html = `<table class="kz-sheet"><thead><tr><th></th>${cols}</tr></thead><tbody>`;
    const row = (cat) => {
      const cells = players.map(p => {
        const v = p.sheet[cat];
        if (v != null) return `<td class="${p.id === view.you ? 'mine' : ''}${v === 0 ? ' zero' : ''}">${v}</td>`;
        if (p.id === view.you && myTurn() && view.rolled) {
          const n = preview(cat);
          return `<td class="mine open${picked === cat ? ' picked' : ''}${n ? '' : ' nil'}" data-cat="${cat}"><button type="button">${n}</button></td>`;
        }
        return `<td class="${p.id === view.you ? 'mine' : ''}"></td>`;
      }).join('');
      return `<tr><th>${esc(t('kiez.cat.' + cat))}</th>${cells}</tr>`;
    };
    for (const cat of UPPER) html += row(cat);
    const sums = players.map(p => totals(p.sheet, p.kings * KING_BONUS));
    const sumRow = (label, cells, cls = '') => `<tr class="kz-sum ${cls}"><th>${esc(label)}</th>${cells}</tr>`;
    html += sumRow(t('kiez.sum.upper'), sums.map((s, i) => {
      const left = BONUS_AT - s.upper;
      return `<td class="${players[i].id === view.you ? 'mine' : ''}">${s.upper}${left > 0 ? `<small>−${left}</small>` : ''}</td>`;
    }).join(''));
    html += sumRow(t('kiez.sum.bonus'), sums.map((s, i) => `<td class="${players[i].id === view.you ? 'mine' : ''}${s.bonus ? ' got' : ''}">${s.bonus || ''}</td>`).join(''));
    for (const cat of CATEGORIES.slice(UPPER.length)) html += row(cat);
    if (players.some(p => p.kings)) {
      html += sumRow(t('kiez.sum.kings'), players.map(p => `<td class="${p.id === view.you ? 'mine' : ''}${p.kings ? ' got' : ''}">${p.kings ? p.kings * KING_BONUS : ''}</td>`).join(''));
    }
    html += sumRow(t('kiez.sum.total'), sums.map((s, i) => `<td class="${players[i].id === view.you ? 'mine' : ''}">${s.total}</td>`).join(''), 'total');
    html += '</tbody></table>';
    main.innerHTML = html;
    for (const td of main.querySelectorAll('td.open')) td.onclick = () => pick(td.dataset.cat);
  }

  function renderStatus() {
    const cur = view.players.find(p => p.id === view.turn);
    let line;
    if (view.phase === 'roundOver') line = t('kiez.status.roundOver');
    else if (view.phase === 'gameOver') line = t('kiez.status.gameOver');
    else if (myTurn()) line = !view.rolled ? t('kiez.status.first') : view.rollsLeft ? t('kiez.status.yourTurn') : t('kiez.status.last');
    else line = t('kiez.status.other', { name: cur?.name || '…' });
    els.status.className = 'status play-status' + (myTurn() ? ' your-turn' : '');
    els.status.innerHTML = `<div class="main">${esc(line)}</div><div class="sub">${esc(msg(view.log[view.log.length - 1]))}</div>`;
  }

  function renderDice(animate) {
    const box = els.hand;
    box.className = 'play-hand kz-dice';
    box.innerHTML = '';
    const show = myTurn() ? held : view.held;
    view.dice.forEach((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kz-die' + (show[i] && view.rolled ? ' held' : '') + (view.rolled ? '' : ' idle');
      b.setAttribute('aria-pressed', String(!!show[i]));
      b.setAttribute('aria-label', String(d));
      b.innerHTML = `<span class="kz-face">${dieHtml(d)}</span><small>${esc(t('kiez.hold'))}</small>`;
      b.onclick = () => {
        if (!canHold()) return;
        held[i] = !held[i];
        ctx.buzz?.(5);
        renderDice(false);
      };
      if (animate && !show[i]) {
        b.classList.add('rolling');
        if (!reduce) {
          const face = b.querySelector('.kz-face');
          const spin = setInterval(() => { face.innerHTML = dieHtml(1 + Math.floor(Math.random() * 6)); }, 70);
          setTimeout(() => { clearInterval(spin); face.innerHTML = dieHtml(d); b.classList.remove('rolling'); }, ROLL_MS);
        }
      }
      box.append(b);
    });
  }

  function renderButtons() {
    const box = els.buttons;
    box.innerHTML = '';
    if (!myTurn()) return;
    if (view.rollsLeft > 0) {
      const r = document.createElement('button');
      r.className = 'btn' + (picked ? '' : ' primary');
      r.textContent = view.rolled ? t('kiez.rollLeft', { n: view.rollsLeft }) : t('kiez.roll');
      r.onclick = () => {
        if (Date.now() < rollingUntil) return;
        picked = null;
        act({ type: 'roll', held: held.slice() });
      };
      box.append(r);
    }
    if (picked) {
      const e = document.createElement('button');
      e.className = 'btn primary pulse';
      e.textContent = t('kiez.enter', { cat: t('kiez.cat.' + picked), n: preview(picked) });
      e.onclick = () => enter(picked);
      box.append(e);
    }
  }

  return {
    render(v) {
      const fresh = !view || v.rollNo !== seen.rollNo || v.turn !== seen.turn;
      const rolledNow = view && v.rollNo !== seen.rollNo && v.rolled;
      view = v;
      if (fresh) {
        held = v.rolled ? v.held.slice() : [false, false, false, false, false];
        if (v.turn !== seen.turn) picked = null;
        seen = { rollNo: v.rollNo, turn: v.turn };
      }
      if (picked && (!myTurn() || me().sheet[picked] != null)) picked = null;
      if (rolledNow) rollingUntil = Date.now() + ROLL_MS;
      renderPlayers();
      renderSheet();
      renderStatus();
      renderDice(rolledNow);
      renderButtons();
    },

    result(v) {
      if (v.phase !== 'roundOver' && v.phase !== 'gameOver') return null;
      const over = v.phase === 'gameOver';
      const r = v.result;
      const nm = (p) => (p.id === v.you ? t('game.you') : p.name);
      const rows = [...v.players].sort((a, b) => (r?.gained?.[b.id] ?? 0) - (r?.gained?.[a.id] ?? 0));
      let html = `<tr><th>${t('scores.player')}</th><th class="num">${t('scores.round')}</th><th class="num">${t('scores.total')}</th></tr>`;
      for (const p of rows) {
        html += `<tr class="${p.id === r?.winner ? 'winner' : ''}"><td>${esc(nm(p))}${p.id === r?.winner ? ' 🏆' : ''}</td>` +
          `<td class="num">${r?.gained?.[p.id] ?? ''}</td><td class="num">${p.score}</td></tr>`;
      }
      const winner = v.players.find(p => p.id === r?.winner);
      const best = [...v.players].sort((a, b) => b.score - a.score)[0];
      return {
        key: `${v.gameNo}:${v.round}:${v.phase}`,
        title: over ? t('over.title') : winner?.id === v.you ? t('kiez.youWinRound', { round: v.round }) : t('kiez.roundWin', { name: winner?.name || '', round: v.round }),
        sub: over ? '🏆 ' + t('over.winner', { names: nm(best), points: best.score }) : '',
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

