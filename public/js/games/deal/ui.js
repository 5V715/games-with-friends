// Monopoly Deal screen: everyone's bank and property sets, your hand, and
// sheets for every decision (where to play a card, targets, payments,
// Just Say No, discarding).
import { SETS, COLORS, NO_BUILDINGS, cardColors, cardLabel } from './cards.js';
import { stack, isFull, rentFor, payables } from './engine.js';
import { esc, choose, pick, closeChoice } from '../../ui-kit.js';

export function createDealUI(ctx) {
  const { els, t, msg, act, toast } = ctx;
  let view = null;
  let shownStep = -1;
  let busy = false;

  const L = (label) => msg({ key: label.t, params: label.p || {} });
  const colorName = (c) => t('deal.color.' + c);
  const me = () => view.players.find(p => p.id === view.you);
  const others = () => view.players.filter(p => p.id !== view.you);
  const pname = (id) => {
    const p = view.players.find(x => x.id === id);
    return p ? (p.id === view.you ? t('game.you') : p.name) : '';
  };
  const myTurn = () => view.turn === view.you && view.phase === 'play' && !view.pending;

  // ---- card faces -----------------------------------------------------------

  function cardHtml(card, { small = false, color = null } = {}) {
    const v = card.value ? `<span class="d-val">${card.value}M</span>` : '';
    const name = esc(L(cardLabel(card)));
    switch (card.type) {
      case 'money':
        return `<div class="dcard d-money${small ? ' small' : ''}">${v}<span class="d-big">${card.value}M</span></div>`;
      case 'prop':
        return `<div class="dcard d-prop${small ? ' small' : ''}"><span class="d-band col-${card.color}"><span class="d-street">${name}</span></span>${v}${small ? '' : miniLadder(card.color)}</div>`;
      case 'wild': {
        const cs = card.colors === 'any' ? null : card.colors;
        const band = cs ? `<span class="d-band split"><span class="col-${cs[0]}"></span><span class="col-${cs[1]}"></span></span>` : '<span class="d-band rainbow"></span>';
        const on = color ? `<span class="d-on">→ ${esc(colorName(color))}</span>` : '';
        return `<div class="dcard d-wild${small ? ' small' : ''}">${band}${v}<span class="d-name">${name}</span>${on}</div>`;
      }
      case 'rent': {
        const dots = card.colors === 'any' ? '<span class="dot rainbow"></span>' : card.colors.map(c => `<span class="dot col-${c}"></span>`).join('');
        return `<div class="dcard d-rent${small ? ' small' : ''}">${v}<span class="d-dots">${dots}</span><span class="d-name">${name}</span></div>`;
      }
      default:
        return `<div class="dcard d-action a-${card.action}${small ? ' small' : ''}">${v}<span class="d-name">${name}</span></div>`;
    }
  }

  // Rent ladder as printed on the property cards: ▮ 1M, ▮▮ 2M, … ★ complete.
  function miniLadder(color) {
    const set = SETS[color];
    return `<span class="d-ladder">${set.rent.map((r, i) =>
      `<span><i>${'▮'.repeat(i + 1)}</i><b>${r}M</b></span>`).join('')}</span>`;
  }

  function ladderHtml(color, have = null, buildings = {}) {
    const set = SETS[color];
    const rows = set.rent.map((r, i) => {
      const n = i + 1;
      const full = n === set.size;
      return `<tr class="${have != null && Math.min(have, set.size) === n ? 'now' : ''}"><td class="cnt">${'▮'.repeat(n)}</td>` +
        `<td>${n}${full ? ` · ${esc(t('deal.ladder.full'))} ★` : ''}</td><td class="num">${r}M</td></tr>`;
    }).join('');
    const extra = NO_BUILDINGS.has(color) ? '' :
      `<tr class="${buildings.house ? 'now' : ''}"><td>🏠</td><td>${esc(t('deal.ladder.house'))}</td><td class="num">+3M</td></tr>` +
      `<tr class="${buildings.hotel ? 'now' : ''}"><td>🏨</td><td>${esc(t('deal.ladder.hotel'))}</td><td class="num">+4M</td></tr>`;
    return `<table class="ladder col-${color}"><caption><span class="swatch-sq col-${color}"></span>${esc(colorName(color))} · ${esc(t('deal.ladder.title'))}</caption>${rows}${extra}</table>`;
  }

  // Big card plus everything printed on it (rent ladders, description).
  function cardDetailHtml(card) {
    let more = '';
    if (card.type === 'prop' || card.type === 'wild') more = cardColors(card).map(c => ladderHtml(c)).join('');
    const desc = card.type === 'action' ? t('deal.desc.' + card.action)
      : card.type === 'rent' ? t(card.colors === 'any' ? 'deal.desc.rentAny' : 'deal.desc.rent') : '';
    return `<div class="choice-card">${cardHtml(card)}</div>${desc ? `<p class="hint">${esc(desc)}</p>` : ''}<div class="ladders">${more}</div>`;
  }

  // ---- tables -----------------------------------------------------------------

  function stacksHtml(p, mine) {
    const colors = COLORS.filter(c => stack(p, c).length);
    if (!colors.length) return `<span class="hint">${esc(t('deal.empty'))}</span>`;
    return colors.map(c => {
      const n = stack(p, c).length;
      const b = p.buildings[c] || {};
      const blds = (b.house ? '🏠' : '') + (b.hotel ? '🏨' : '');
      const wild = stack(p, c).some(e => e.card.type === 'wild');
      return `<button class="stack col-${c}${isFull(p, c) ? ' full' : ''}" data-color="${c}" data-owner="${p.id}">
        <span class="stack-name">${esc(colorName(c))}${wild ? ' ✦' : ''}</span><span class="stack-n">${Math.min(n, 99)}/${SETS[c].size}${blds}</span></button>`;
    }).join('');
  }

  function tableHtml(p) {
    const mine = p.id === view.you;
    const bankTotal = p.bank.reduce((s, c) => s + c.value, 0);
    const turn = p.id === view.turn ? ' turn' : '';
    return `<section class="dtable${mine ? ' mine' : ''}${turn}">
      <header><b>${esc(pname(p.id))}</b>
        <span class="chip">${esc(t('deal.bank'))}: ${bankTotal}M</span>
        <span class="chip ${p.sets >= 2 ? 'warn' : ''}">★ ${esc(t('deal.sets', { n: p.sets }))}</span>
        ${mine ? '' : `<span class="chip">🂠 ${p.count}</span>`}</header>
      <div class="stacks">${stacksHtml(p, mine)}</div></section>`;
  }

  function renderPlayers() {
    const box = els.players;
    box.innerHTML = '';
    for (const p of view.players) {
      const el = document.createElement('div');
      el.className = 'opp' + (p.id === view.turn ? ' turn' : '') + (p.id === view.you ? ' me' : '') + (ctx.speaking() === p.id ? ' speaking' : '');
      el.innerHTML = `<span class="mini-back deal-back">${p.count}</span>
        <span class="meta"><span class="oname">${esc(pname(p.id))}</span>
        <span class="osub">★${p.sets} · ${p.worth}M</span></span>
        <span class="link-dot ${ctx.dotClass(p)}"></span>`;
      box.append(el);
    }
  }

  function renderMain() {
    const main = els.main;
    const scroll = main.scrollTop;
    const order = [...others(), me()].filter(Boolean);
    main.innerHTML = `<div class="deal-tables">${order.map(tableHtml).join('')}</div>`;
    main.scrollTop = scroll;
    for (const b of main.querySelectorAll('.stack')) b.onclick = () => stackMenu(b.dataset.owner, b.dataset.color);
  }

  function renderStatus() {
    let line;
    if (view.phase === 'gameOver') line = t('deal.status.gameOver');
    else if (view.pending) line = t('deal.status.waiting', { name: pname(view.decider) });
    else if (view.turn === view.you && view.phase === 'discard') line = t('deal.status.discard', { n: view.hand.length - view.handLimit });
    else if (view.turn === view.you) line = view.playsLeft ? t('deal.status.yourTurn') : t('deal.status.noPlays');
    else line = t('deal.status.other', { name: pname(view.turn) });
    const dots = view.turn === view.you && view.phase === 'play'
      ? `<span class="plays">${'●'.repeat(view.playsLeft)}${'○'.repeat(3 - view.playsLeft)}</span>` : '';
    els.status.className = 'status play-status' + (view.turn === view.you ? ' your-turn' : '');
    els.status.innerHTML = `<div class="main">${esc(line)} ${dots}</div><div class="sub">${esc(msg(view.log[view.log.length - 1]))}</div>`;
  }

  function renderHand() {
    const hand = els.hand;
    hand.className = 'play-hand deal-hand';
    hand.innerHTML = view.hand.map(c => cardHtml(c).replace('class="dcard', `data-id="${c.id}" class="dcard`)).join('');
    for (const el of hand.querySelectorAll('.dcard')) {
      el.onclick = () => cardMenu(view.hand.find(c => c.id === el.dataset.id));
    }
  }

  function renderButtons() {
    const box = els.buttons;
    box.innerHTML = '';
    if (view.turn === view.you && view.phase === 'play' && !view.pending) {
      const b = document.createElement('button');
      b.className = 'btn' + (view.playsLeft === 0 ? ' primary pulse' : '');
      b.textContent = t('deal.endTurn');
      b.onclick = () => act({ type: 'end' });
      box.append(b);
    }
  }

  // ---- playing cards ---------------------------------------------------------

  async function run(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } finally { busy = false; }
  }

  const cancel = () => t('deal.opt.cancel');

  async function pickPlayer(candidates = others()) {
    if (candidates.length === 1) return candidates[0].id;
    return choose({
      title: t('deal.pick.player'),
      options: candidates.map(p => ({ label: `${p.name} · ${p.worth}M · ★${p.sets}`, value: p.id })),
      cancel: cancel(),
    });
  }

  function cardMenu(card) {
    run(async () => {
      const options = [];
      const canAct = myTurn() && view.playsLeft > 0;
      if (canAct && (card.type === 'prop' || card.type === 'wild')) {
        for (const c of cardColors(card)) options.push({ label: t('deal.opt.property', { color: colorName(c) }), value: ['property', c], primary: true });
      }
      if (canAct && card.type === 'action' && !['jsn', 'double'].includes(card.action)) {
        options.push({ label: t('deal.opt.play', { card: L(cardLabel(card)) }), value: ['action'], primary: true });
      }
      if (canAct && card.type === 'rent') options.push({ label: t('deal.opt.play', { card: L(cardLabel(card)) }), value: ['action'], primary: true });
      if (canAct && card.type !== 'prop' && card.type !== 'wild' && card.value > 0) {
        options.push({ label: t('deal.opt.bank', { v: card.value }), value: ['bank'] });
      }
      const choice = await choose({
        title: L(cardLabel(card)),
        html: cardDetailHtml(card),
        options,
        cancel: options.length ? cancel() : t('deal.close'),
      });
      if (!choice) return;
      if (choice[0] === 'bank') return act({ type: 'bank', cardId: card.id });
      if (choice[0] === 'property') return act({ type: 'property', cardId: card.id, color: choice[1] });
      await playAction(card);
    });
  }

  async function playAction(card) {
    const mine = me();
    if (card.type === 'rent') {
      const colors = (card.colors === 'any' ? COLORS : card.colors).filter(c => stack(mine, c).length);
      if (!colors.length) return toast(t('deal.err.noRentColor'), { error: true });
      const color = colors.length === 1 ? colors[0] : await choose({
        title: t('deal.pick.color'),
        options: colors.map(c => ({ label: `${colorName(c)} · ${rentFor(mine, c)}M`, value: c })),
        cancel: cancel(),
      });
      if (!color) return;
      let target;
      if (card.colors === 'any') {
        target = await pickPlayer();
        if (!target) return;
      }
      const dbl = view.hand.find(c => c.action === 'double');
      let doubles = [];
      if (dbl && view.playsLeft >= 2) {
        const base = rentFor(mine, color);
        const yes = await choose({
          title: t('deal.pick.double'),
          options: [
            { label: t('deal.pick.doubleYes', { amount: base * 2 }), value: 'yes', primary: true },
            { label: t('deal.pick.doubleNo', { amount: base }), value: 'no' },
          ],
          cancel: cancel(),
        });
        if (!yes) return;
        if (yes === 'yes') doubles = [dbl.id];
      }
      return act({ type: 'action', cardId: card.id, color, target, doubles });
    }
    switch (card.action) {
      case 'passgo':
      case 'birthday':
        return act({ type: 'action', cardId: card.id });
      case 'debt': {
        const target = await pickPlayer();
        if (target) act({ type: 'action', cardId: card.id, target });
        return;
      }
      case 'sly':
      case 'forced': {
        const loot = [];
        for (const o of others()) for (const e of o.props) if (!isFull(o, e.color)) loot.push({ o, e });
        if (!loot.length) return toast(t('deal.err.noSuchProp'), { error: true });
        const choice = await choose({
          title: t('deal.pick.theirProp'),
          options: loot.map(({ o, e }, i) => ({ label: `${o.name}: ${L(cardLabel(e.card))} (${colorName(e.color)})`, value: String(i) })),
          cancel: cancel(),
        });
        if (choice == null) return;
        const { o, e } = loot[Number(choice)];
        if (card.action === 'sly') return act({ type: 'action', cardId: card.id, target: o.id, propId: e.card.id });
        const give = mine.props.filter(x => !isFull(mine, x.color));
        if (!give.length) return toast(t('deal.err.inFullSet'), { error: true });
        const g = await choose({
          title: t('deal.pick.myProp'),
          options: give.map((x, i) => ({ label: `${L(cardLabel(x.card))} (${colorName(x.color)})`, value: String(i) })),
          cancel: cancel(),
        });
        if (g == null) return;
        return act({ type: 'action', cardId: card.id, target: o.id, propId: e.card.id, myPropId: give[Number(g)].card.id });
      }
      case 'dealbreaker': {
        const sets = [];
        for (const o of others()) for (const c of COLORS) if (isFull(o, c)) sets.push({ o, c });
        if (!sets.length) return toast(t('deal.err.notFullSet'), { error: true });
        const choice = await choose({
          title: t('deal.pick.set'),
          options: sets.map(({ o, c }, i) => ({ label: `${o.name}: ${colorName(c)}`, value: String(i) })),
          cancel: cancel(),
        });
        if (choice == null) return;
        const { o, c } = sets[Number(choice)];
        return act({ type: 'action', cardId: card.id, target: o.id, color: c });
      }
      case 'house':
      case 'hotel': {
        const ok = COLORS.filter(c => isFull(mine, c) && !NO_BUILDINGS.has(c) &&
          (card.action === 'house' ? !mine.buildings[c]?.house : mine.buildings[c]?.house && !mine.buildings[c]?.hotel));
        if (!ok.length) return toast(t('deal.err.noBuilding'), { error: true });
        const color = ok.length === 1 ? ok[0] : await choose({
          title: t('deal.pick.set'),
          options: ok.map(c => ({ label: colorName(c), value: c })),
          cancel: cancel(),
        });
        if (color) act({ type: 'action', cardId: card.id, color });
        return;
      }
      default:
        return toast(t('deal.err.notAction'), { error: true });
    }
  }

  // Tap any set: its cards, the rent ladder (current step highlighted) and,
  // for your own sets on your turn, moving wild properties.
  function stackMenu(ownerId, color) {
    run(async () => {
      const owner = view.players.find(p => p.id === ownerId);
      if (!owner) return;
      const st = stack(owner, color);
      const options = [];
      if (ownerId === view.you && myTurn()) {
        for (const e of st.filter(x => x.card.type === 'wild')) {
          for (const c of cardColors(e.card)) {
            if (c !== color) options.push({ label: t('deal.opt.move', { color: colorName(c) }) + ` (${L(cardLabel(e.card))})`, value: [e.card.id, c] });
          }
        }
      }
      const html = `<p class="hint">${esc(t('deal.stack.cards'))}</p>` +
        `<div class="stack-cards">${st.map(e => cardHtml(e.card, { small: true, color: e.card.type === 'wild' ? e.color : null })).join('')}</div>` +
        `<p class="stack-now">${esc(t('deal.stack.now', { n: rentFor(owner, color) }))}</p>` +
        ladderHtml(color, st.length, owner.buildings[color] || {});
      const choice = await choose({ title: `${pname(ownerId)} · ${colorName(color)}`, html, options, cancel: t('deal.close') });
      if (choice) act({ type: 'move', cardId: choice[0], color: choice[1] });
    });
  }

  // ---- decisions: Just Say No, paying, discarding ----------------------------

  // The card played against you, with what it means for you.
  function playedHtml(pd) {
    if (!pd.card) return '';
    const rent = pd.rentColor ? `<p class="hint">${esc(t('deal.respond.rentFor', { color: colorName(pd.rentColor), doubled: pd.doubled > 0 }))}</p>` : '';
    return `<p class="hint">${esc(t('deal.respond.played'))}</p><div class="choice-card">${cardHtml(pd.card)}</div>${rent}`;
  }

  function pendingText(pd) {
    if (pd.kind === 'pay') return t('deal.respond.pay', { amount: pd.amount });
    const find = (id) => view.players.flatMap(p => p.props).find(e => e.card.id === id);
    if (pd.kind === 'sly') return t('deal.respond.take', { what: L(cardLabel(find(pd.propId)?.card || { type: 'money', value: 0 })) });
    if (pd.kind === 'forced') {
      return t('deal.respond.swap', { theirs: L(cardLabel(find(pd.propId)?.card || {})), mine: L(cardLabel(find(pd.myPropId)?.card || {})) });
    }
    return t('deal.respond.set', { color: colorName(pd.color) });
  }

  async function decide() {
    const pd = view.pending;
    const step = view.step;
    if (view.phase === 'discard' && view.turn === view.you) {
      if (shownStep === step) return;
      shownStep = step;
      const n = view.hand.length - view.handLimit;
      const ids = await pick({
        title: t('deal.discard.title', { n }),
        text: t('deal.discard.hint'),
        items: view.hand.map(c => ({ id: c.id, html: cardHtml(c, { small: true }) })),
        check: (sel) => ({ ok: sel.length === n, label: `${sel.length} / ${n}` }),
        confirm: t('deal.discard.btn'),
      });
      if (ids) act({ type: 'discard', cardIds: ids });
      return;
    }
    if (!pd || view.decider !== view.you) return;
    if (shownStep === step) return;
    shownStep = step;
    const hasJsn = view.hand.some(c => c.action === 'jsn');
    if (pd.stage === 'respond') {
      const answer = await choose({
        title: t('deal.respond.title', { name: pname(pd.source), card: L(pd.label) }),
        html: playedHtml(pd) + `<p class="hint"><b>${esc(pendingText(pd))}</b></p>`,
        options: [
          { label: t('deal.respond.jsn'), value: 'jsn', primary: true, disabled: !hasJsn },
          { label: t('deal.respond.accept'), value: 'accept' },
        ],
      });
      if (answer) act({ type: 'respond', jsn: answer === 'jsn' });
    } else if (pd.stage === 'counter') {
      const answer = await choose({
        title: t('deal.counter.title', { name: pname(pd.target) }),
        text: t('deal.counter.text'),
        options: [
          { label: t('deal.respond.jsn'), value: 'jsn', primary: true, disabled: !hasJsn },
          { label: t('deal.counter.give'), value: 'give' },
        ],
      });
      if (answer) act({ type: 'respond', jsn: answer === 'jsn' });
    } else if (pd.stage === 'pay') {
      const mine = me();
      const all = payables(mine);
      const value = (ids) => ids.reduce((s, id) => s + (all.find(x => x.card.id === id)?.card.value || 0), 0);
      const ids = await pick({
        title: t('deal.pay.title', { amount: pd.amount, name: pname(pd.source) }),
        html: playedHtml(pd),
        text: t('deal.pay.hint'),
        items: all.map(x => ({
          id: x.card.id,
          html: cardHtml(x.card, { small: true, color: x.where === 'prop' ? x.color : null }) +
            (x.where === 'prop' ? `<span class="pick-note col-${x.color}">${esc(colorName(x.color))}</span>` : ''),
        })),
        check: (sel) => ({
          ok: value(sel) >= pd.amount || (sel.length === all.length && sel.length > 0),
          label: t('deal.pay.selected', { sum: value(sel), amount: pd.amount }),
        }),
        confirm: t('deal.pay.btn'),
      });
      if (ids) act({ type: 'pay', cardIds: ids });
    }
  }

  return {
    render(v) {
      view = v;
      renderPlayers();
      renderMain();
      renderStatus();
      renderHand();
      renderButtons();
      ctx.addSheetButton?.(els.players, false);
      if (v.phase === 'gameOver') closeChoice();
      else decide();
    },

    result(v) {
      if (v.phase !== 'gameOver') return null;
      const rows = [...v.players].sort((a, b) => b.sets - a.sets || b.worth - a.worth);
      const winner = v.players.find(p => p.id === v.winner);
      let html = `<tr><th>${t('scores.player')}</th><th class="num">★</th><th class="num">M</th></tr>`;
      for (const p of rows) {
        html += `<tr class="${p.id === v.winner ? 'winner' : ''}"><td>${esc(p.id === v.you ? t('game.you') : p.name)}${p.id === v.winner ? ' 🏆' : ''}</td><td class="num">${p.sets}</td><td class="num">${p.worth}</td></tr>`;
      }
      return {
        key: `${v.gameNo}:over`,
        title: winner?.id === v.you ? t('deal.youWin') : t('deal.win', { name: winner?.name || '' }),
        sub: '',
        html,
        vote: false,
        over: true,
        won: winner?.id === v.you,
      };
    },

    standings(v) {
      return [...v.players].sort((a, b) => b.sets - a.sets || b.worth - a.worth)
        .map(p => ({ id: p.id, name: p.name, value: `★${p.sets} · ${p.worth}M` }));
    },
  };
}
