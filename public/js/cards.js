// Card model for Rommé: two French decks (2 × 52) plus 6 jokers = 110 cards.

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RED_SUITS = new Set(['H', 'D']);
export const JOKERS_PER_GAME = 6;

const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(rank) {
  return RANK_LABEL[rank] || String(rank);
}

export function createDeck() {
  const cards = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: `${d}${suit}${rank}`, suit, rank, joker: false });
      }
    }
  }
  for (let j = 0; j < JOKERS_PER_GAME; j++) {
    cards.push({ id: `X${j}`, suit: null, rank: 0, joker: true });
  }
  return cards;
}

function randomInt(max) {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    // Rejection sampling avoids modulo bias.
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do c.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function shuffle(cards) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Penalty points for a card left in hand at the end of a round.
export function penalty(card) {
  if (card.joker) return 20;
  if (card.rank === 1) return 11;
  if (card.rank >= 10) return 10;
  return card.rank;
}

// Value of a card at a meld position (rank 1..14, 14 = high ace).
export function positionValue(rank) {
  if (rank === 1) return 1;
  if (rank === 14) return 11;
  if (rank >= 10) return 10;
  return rank;
}

export function setValue(rank) {
  return rank === 1 ? 11 : positionValue(rank);
}

export function describe(card) {
  if (card.joker) return 'Joker';
  return rankLabel(card.rank) + SUIT_SYMBOL[card.suit];
}
