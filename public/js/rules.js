// Meld validation for Rommé.
//
// A meld is either a set (3–4 cards of equal rank, all suits different) or a
// run (3+ consecutive cards of one suit; the ace may be low A‑2‑3 or high
// Q‑K‑A, never around the corner). Jokers stand in for any missing card.
//
// analyzeMeld() returns { type, slots, points } or null. `slots` is the meld
// in display order; each slot records which rank/suit the card stands for, so
// jokers keep a fixed meaning once they lie on the table.

import { SUITS, positionValue, setValue } from './cards.js';

export const MIN_INITIAL_MELD = 30;

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
export function analyzeRun(cards, pinned = {}) {
  if (cards.length < 3) return null;
  const fixed = [];
  const free = [];
  for (const card of cards) {
    if (card.joker) {
      if (pinned[card.id] != null) fixed.push({ card, rank: pinned[card.id], pinned: true });
      else free.push(card);
    } else {
      fixed.push({ card, rank: card.rank, pinned: false });
    }
  }
  const naturals = fixed.filter(f => !f.pinned);
  if (!naturals.length) return null;
  const suit = naturals[0].card.suit;
  if (naturals.some(f => f.card.suit !== suit)) return null;

  const hasAce = naturals.some(f => f.card.rank === 1);
  let best = null;
  for (const aceHigh of hasAce ? [false, true] : [false]) {
    const placed = fixed.map(f => ({
      card: f.card,
      rank: !f.pinned && f.rank === 1 && aceHigh ? 14 : f.rank,
    }));
    const ranks = placed.map(p => p.rank);
    if (new Set(ranks).size !== ranks.length) continue;
    const min = Math.min(...ranks);
    const max = Math.max(...ranks);
    const gaps = max - min + 1 - placed.length;
    if (gaps > free.length) continue;
    const extra = free.length - gaps;
    // Spare jokers extend the run upwards first (worth more), then downwards.
    const hi = Math.min(extra, 14 - max);
    const lo = extra - hi;
    if (min - lo < 1) continue;
    const byRank = new Map(placed.map(p => [p.rank, p.card]));
    const jokers = free.slice();
    const slots = [];
    let points = 0;
    for (let r = min - lo; r <= max + hi; r++) {
      const card = byRank.get(r) || jokers.shift();
      slots.push({ card, rank: r, suit });
      points += positionValue(r);
    }
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
