// Simple Hegemony Deal computer player.
import { SETS, COLORS, NO_BUILDINGS, cardColors } from './cards.js';
import { stack, isFull, rentFor, payables } from './engine.js';

const me = (v) => v.players.find(p => p.id === v.you);
const others = (v) => v.players.filter(p => p.id !== v.you);
const richest = (v) => others(v).sort((a, b) => b.worth - a.worth)[0];

// Best color for a (wild) property: the one closest to completing a set.
function bestColor(p, card) {
  const colors = cardColors(card).filter(c => !isFull(p, c));
  const pool = colors.length ? colors : cardColors(card);
  return pool.reduce((a, b) => {
    const need = (c) => SETS[c].size - stack(p, c).length;
    return need(b) < need(a) || (need(b) === need(a) && stack(p, b).length > stack(p, a).length) ? b : a;
  });
}

// Pay with as little value as possible: money first, properties last.
function choosePayment(p, amount) {
  const all = payables(p);
  const money = all.filter(x => x.where !== 'prop').sort((a, b) => a.card.value - b.card.value);
  const props = all.filter(x => x.where === 'prop')
    .sort((a, b) => (isFull(p, a.color) - isFull(p, b.color)) || a.card.value - b.card.value);
  const chosen = [];
  let sum = 0;
  // Try to cover exactly with one bank card first.
  const single = money.filter(x => x.card.value >= amount).sort((a, b) => a.card.value - b.card.value)[0];
  if (single && money.filter(x => x.card.value < amount).reduce((s, x) => s + x.card.value, 0) < amount) {
    return [single.card.id];
  }
  for (const x of [...money, ...props]) {
    if (sum >= amount) break;
    chosen.push(x.card.id);
    sum += x.card.value;
  }
  return chosen;
}

function stealable(v) {
  const mine = me(v);
  const out = [];
  for (const o of others(v)) {
    for (const e of o.props) {
      if (isFull(o, e.color)) continue;
      const helps = stack(mine, e.color).length;
      out.push({ o, e, score: helps * 10 + e.card.value });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function botStep(view) {
  const p = me(view);
  const pd = view.pending;
  if (view.phase === 'gameOver') return null;

  if (pd && view.decider === view.you) {
    if (pd.stage === 'pay') return { type: 'pay', cardIds: choosePayment(p, pd.amount) };
    const hasJsn = view.hand.some(c => c.action === 'jsn');
    if (pd.stage === 'counter') return { type: 'respond', jsn: hasJsn };
    const serious = pd.kind === 'dealbreaker' || pd.kind === 'sly' || pd.kind === 'forced' || pd.amount >= 5;
    return { type: 'respond', jsn: hasJsn && serious };
  }
  if (view.turn !== view.you) return null;

  if (view.phase === 'discard') {
    const n = view.hand.length - view.handLimit;
    const order = [...view.hand].sort((a, b) => a.value - b.value);
    return { type: 'discard', cardIds: order.slice(0, n).map(c => c.id) };
  }
  if (view.playsLeft <= 0) return { type: 'end' };
  const hand = view.hand;
  const find = (pred) => hand.find(pred);

  // 1. Deal Breaker on any complete set.
  const db = find(c => c.action === 'dealbreaker');
  if (db) {
    for (const o of others(view)) {
      const color = COLORS.find(c => isFull(o, c));
      if (color) return { type: 'action', cardId: db.id, target: o.id, color };
    }
  }
  // 2. Lay down properties.
  const prop = find(c => c.type === 'prop' || (c.type === 'wild' && c.colors !== 'any')) ||
    (p.props.length ? find(c => c.type === 'wild') : null);
  if (prop) return { type: 'property', cardId: prop.id, color: bestColor(p, prop) };
  // 3. Build on complete sets.
  for (const kind of ['hotel', 'house']) {
    const card = find(c => c.action === kind);
    if (!card) continue;
    const color = COLORS.find(c => isFull(p, c) && !NO_BUILDINGS.has(c) &&
      (kind === 'house' ? !p.buildings[c]?.house : p.buildings[c]?.house && !p.buildings[c]?.hotel));
    if (color) return { type: 'action', cardId: card.id, color };
  }
  // 4. Rent for the most valuable color.
  for (const card of hand.filter(c => c.type === 'rent')) {
    const colors = (card.colors === 'any' ? COLORS : card.colors).filter(c => stack(p, c).length);
    if (!colors.length) continue;
    const color = colors.reduce((a, b) => (rentFor(p, b) > rentFor(p, a) ? b : a));
    if (rentFor(p, color) < 2 && view.playsLeft > 1 && hand.some(c => c.type === 'money')) continue;
    const dbl = find(c => c.action === 'double');
    const doubles = dbl && view.playsLeft >= 2 && rentFor(p, color) >= 3 ? [dbl.id] : [];
    return { type: 'action', cardId: card.id, color, doubles, target: card.colors === 'any' ? richest(view).id : undefined };
  }
  // 5. Steal a useful property.
  const sly = find(c => c.action === 'sly');
  const loot = stealable(view)[0];
  if (sly && loot) return { type: 'action', cardId: sly.id, target: loot.o.id, propId: loot.e.card.id };
  const forced = find(c => c.action === 'forced');
  if (forced && loot) {
    const give = p.props.filter(e => !isFull(p, e.color) && e.color !== loot.e.color)
      .sort((a, b) => stack(p, a.color).length - stack(p, b.color).length)[0];
    if (give) return { type: 'action', cardId: forced.id, target: loot.o.id, propId: loot.e.card.id, myPropId: give.card.id };
  }
  // 6. Collect money.
  const debt = find(c => c.action === 'debt');
  if (debt && richest(view).worth > 0) return { type: 'action', cardId: debt.id, target: richest(view).id };
  const bday = find(c => c.action === 'birthday');
  if (bday && others(view).some(o => o.worth > 0)) return { type: 'action', cardId: bday.id };
  const passgo = find(c => c.action === 'passgo');
  if (passgo) return { type: 'action', cardId: passgo.id };
  // 7. Bank money (keep Just Say No in hand).
  const money = find(c => c.type === 'money') ||
    find(c => (c.type === 'action' || c.type === 'rent') && c.action !== 'jsn' && c.value > 0);
  if (money) return { type: 'bank', cardId: money.id };
  return { type: 'end' };
}
