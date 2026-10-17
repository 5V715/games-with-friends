// Meld validation for Rommé.
//
// A meld is either a set (3–4 cards of equal rank, all suits different) or a
// run (3+ consecutive cards of one suit; the ace may be low A‑2‑3, high
// Q‑K‑A or in the middle, around the corner K‑A‑2). Jokers stand in for any
// missing card.
//
// analyzeMeld() returns { type, slots, points } or null. `slots` is the meld
// in display order; each slot records which rank/suit the card stands for, so
// jokers keep a fixed meaning once they lie on the table.

import { SUITS, positionValue, setValue } from './cards.js';

export const MIN_INITIAL_MELD = 40;

export function analyzeSet(cards) {
  if (cards.length < 3 || cards.length > 4) return null;
  const naturals = cards.filter(c => !c.joker);
  const jokers = cards.filter(c => c.joker);
  if (!naturals.length) return null;
  const rank = naturals[0].rank;
  if (naturals.some(c => c.rank !== rank)) return null;
  const suits = new Set(naturals.map(c => c.suit));
  if (suits.size !== naturals.length) return null;
  const missing = SUITS.filter(s => !suits.has(s));
  const slots = [
    ...naturals.map(card => ({ card, rank, suit: card.suit })),
    ...jokers.map((card, i) => ({ card, rank, suit: missing[i] })),
  ].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
  return { type: 'set', slots, points: setValue(rank) * cards.length };
}

// `pinned` maps joker id -> rank (1..14) for jokers already placed in a run.
// Runs may go around the corner (Q‑K‑A‑2): the 13 ranks form a circle. In a
// slot, an ace right after a king has rank 14 (worth 11), otherwise rank 1.
export function analyzeRun(cards, pinned = {}) {
  if (cards.length < 3 || cards.length > 13) return null;
  const fixed = [];
  const free = [];
  for (const card of cards) {
    if (card.joker) {
      if (pinned[card.id] != null) fixed.push({ card, rank: pinned[card.id] });
      else free.push(card);
    } else {
      fixed.push({ card, rank: card.rank });
    }
  }
  const naturals = fixed.filter(f => !f.card.joker);
  if (!naturals.length) return null;
  const suit = naturals[0].card.suit;
  if (naturals.some(f => f.card.suit !== suit)) return null;

  const n = cards.length;
  const circle = (r) => (r === 14 ? 1 : r);
  let best = null;
  for (let start = 1; start <= 13; start++) {
    // Ranks of the window start, start+1, … around the circle.
    const ranks = Array.from({ length: n }, (_, i) => ((start - 1 + i) % 13) + 1);
    const at = new Map(ranks.map((r, i) => [r, i]));
    const cardAt = new Array(n).fill(null);
    let ok = true;
    for (const f of fixed) {
      const i = at.get(circle(f.rank));
      if (i == null || cardAt[i]) { ok = false; break; }
      cardAt[i] = f.card;
    }
    if (!ok) continue;
    const jokers = free.slice();
    const slots = [];
    let points = 0;
    ranks.forEach((r, i) => {
      const rank = r === 1 && i > 0 ? 14 : r;
      slots.push({ card: cardAt[i] || jokers.shift(), rank, suit });
      points += positionValue(rank);
    });
    // Most points wins; on a tie keep spare jokers high (the earlier window).
    if (!best || points > best.points) best = { type: 'run', slots, points };
  }
  return best;
}

export function analyzeMeld(cards, { type, pinned } = {}) {
  if (type === 'set') return analyzeSet(cards);
  if (type === 'run') return analyzeRun(cards, pinned);
  const set = analyzeSet(cards);
  const run = analyzeRun(cards);
  if (set && run) return run.points > set.points ? run : set;
  return set || run;
}

export function pinnedJokers(meld) {
  const pinned = {};
  if (meld.type === 'run') {
    for (const s of meld.slots) if (s.card.joker) pinned[s.card.id] = s.rank;
  }
  return pinned;
}

// Adds cards from a hand to an existing table meld.
export function layOff(meld, cards) {
  const all = [...meld.slots.map(s => s.card), ...cards];
  return analyzeMeld(all, { type: meld.type, pinned: pinnedJokers(meld) });
}

// Replaces a joker on the table with the natural card it stands for.
export function swapJoker(meld, jokerId, card) {
  if (card.joker) return null;
  const slot = meld.slots.find(s => s.card.id === jokerId);
  if (!slot || !slot.card.joker) return null;
  if (meld.type === 'run') {
    const rankOk = card.rank === slot.rank || (card.rank === 1 && slot.rank === 14);
    if (!rankOk || card.suit !== slot.suit) return null;
  } else {
    const naturalSuits = meld.slots.filter(s => !s.card.joker).map(s => s.suit);
    if (card.rank !== slot.rank || naturalSuits.includes(card.suit)) return null;
  }
  const cards = meld.slots.map(s => (s.card.id === jokerId ? card : s.card));
  const pinned = pinnedJokers(meld);
  delete pinned[jokerId];
  return analyzeMeld(cards, { type: meld.type, pinned });
}
