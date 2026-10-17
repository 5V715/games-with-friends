// A simple computer player. botStep() looks at a player view and returns the
// next action to perform, one at a time, so the host can animate bot turns.

import { penalty } from './cards.js';
import { analyzeMeld, layOff, swapJoker } from './rules.js';

function combinations(arr, k, start = 0, acc = [], out = []) {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i < arr.length; i++) {
    acc.push(arr[i]);
    combinations(arr, k, i + 1, acc, out);
    acc.pop();
  }
  return out;
}

function candidateGroups(hand) {
  const naturals = hand.filter(c => !c.joker);
  const jokers = hand.filter(c => c.joker);
  const out = [];

  // Sets: one card per suit of the same rank.
  const byRank = new Map();
  for (const c of naturals) {
    const list = byRank.get(c.rank) || [];
    if (!list.some(x => x.suit === c.suit)) list.push(c);
    byRank.set(c.rank, list);
  }
  for (const list of byRank.values()) {
    for (const k of [4, 3]) if (list.length >= k) out.push(...combinations(list, k));
    if (list.length >= 2 && jokers.length) {
      for (const pair of combinations(list, 2)) out.push([...pair, jokers[0]]);
    }
  }

  // Runs: consecutive cards in one suit, around the corner too (K‑A‑2).
  const next = (r, k) => ((r - 1 + k) % 13) + 1;
  for (const suit of ['S', 'H', 'D', 'C']) {
    const byRank = new Map();
    for (const c of naturals.filter(x => x.suit === suit)) if (!byRank.has(c.rank)) byRank.set(c.rank, c);
    for (let start = 1; start <= 13; start++) {
      const seq = [];
      for (let k = 0; k < 13 && byRank.has(next(start, k)); k++) {
        seq.push(byRank.get(next(start, k)));
        if (seq.length >= 3) out.push(seq.slice());
      }
      // Two cards one apart, gap filled by a joker.
      if (jokers.length && byRank.has(start) && byRank.has(next(start, 2)) && !byRank.has(next(start, 1))) {
        out.push([byRank.get(start), jokers[0], byRank.get(next(start, 2))]);
      }
      if (jokers.length && byRank.has(start) && byRank.has(next(start, 1))) {
        out.push([byRank.get(start), byRank.get(next(start, 1)), jokers[0]]);
      }
    }
  }

  return out
    .filter(g => new Set(g.map(c => c.id)).size === g.length)
    .map(g => ({ cards: g, meld: analyzeMeld(g) }))
    .filter(g => g.meld);
}

// Greedy choice of disjoint melds, preferring big and joker-free groups.
export function findMelds(hand) {
  const cands = candidateGroups(hand).sort((a, b) => {
    const ja = a.cards.filter(c => c.joker).length;
    const jb = b.cards.filter(c => c.joker).length;
    return ja - jb || b.cards.length - a.cards.length || b.meld.points - a.meld.points;
  });
  const used = new Set();
  const picked = [];
  for (const g of cands) {
    if (g.cards.some(c => used.has(c.id))) continue;
    g.cards.forEach(c => used.add(c.id));
    picked.push(g);
  }
  return picked;
}

function usefulness(card, hand) {
  if (card.joker) return 100;
  let score = 0;
  for (const o of hand) {
    if (o.id === card.id || o.joker) continue;
    if (o.rank === card.rank && o.suit !== card.suit) score += 3;
    if (o.suit === card.suit) {
      const d = Math.abs(o.rank - card.rank);
      if (d === 1) score += 3;
      else if (d === 2) score += 1;
    }
  }
  return score;
}

export function botStep(view) {
  const me = view.players.find(p => p.id === view.you);
  const hand = view.hand;

  if (view.phase === 'cut') return { type: 'cut', at: Math.random() };
  if (view.phase === 'roundOver') return { type: 'vote', yes: true };

  if (view.phase === 'draw') {
    const top = view.discardTop;
    if (top && me.cameOut) {
      const fitsTable = view.melds.some(m => layOff(m, [top]));
      const makesMeld = findMelds([...hand, top]).some(g => g.cards.some(c => c.id === top.id));
      if (fitsTable || makesMeld) return { type: 'draw', from: 'discard' };
    }
    return { type: 'draw', from: 'stock' };
  }

  if (view.phase !== 'play') return null;

  const groups = findMelds(hand);
  const total = groups.reduce((s, g) => s + g.meld.points, 0);
  if (groups.length && (me.cameOut || total >= view.minInitial)) {
    return { type: 'meld', groups: groups.map(g => g.cards.map(c => c.id)) };
  }

  if (me.cameOut) {
    for (const card of hand) {
      if (card.joker && hand.length > 2) continue;
      for (const m of view.melds) {
        if (layOff(m, [card])) return { type: 'layoff', meldId: m.id, cardIds: [card.id] };
      }
    }
    for (const card of hand) {
      if (card.joker) continue;
      for (const m of view.melds) {
        for (const s of m.slots) {
          if (s.card.joker && swapJoker(m, s.card.id, card)) {
            return { type: 'swap', meldId: m.id, jokerId: s.card.id, cardId: card.id };
          }
        }
      }
    }
  }

  const options = hand.filter(c => c.id !== view.drawnFromDiscard || hand.length === 1);
  options.sort((a, b) => usefulness(a, hand) - usefulness(b, hand) || penalty(b) - penalty(a));
  return { type: 'discard', cardId: options[0].id };
}
