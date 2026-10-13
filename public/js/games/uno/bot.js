// Simple UNO computer player.
import { COLORS, playable } from './engine.js';

function bestColor(hand) {
  const count = Object.fromEntries(COLORS.map(c => [c, 0]));
  for (const c of hand) if (c.color) count[c.color]++;
  return COLORS.reduce((a, b) => (count[b] > count[a] ? b : a));
}

const rank = (c) => ({ num: 0, skip: 1, rev: 1, draw2: 2, wild: 3, wild4: 4 })[c.kind];

export function botStep(view) {
  if (view.phase === 'roundOver') return { type: 'vote', yes: true };
  if (view.phase !== 'play' || view.turn !== view.you) return null;
  // Catch someone who forgot to call UNO.
  if (view.players.some(p => p.vulnerable && p.id !== view.you)) return { type: 'catch' };
  const hand = view.hand;
  const options = hand.filter(c => playable(c, view.top, view.color) && (!view.drawn || c.id === view.drawn));
  if (!options.length) return view.drawn ? { type: 'pass' } : { type: 'draw' };
  // Keep wilds for later; prefer actions when the next player is close to winning.
  const danger = view.players.some(p => p.id !== view.you && p.count <= 2);
  options.sort((a, b) => (danger ? rank(b) - rank(a) : rank(a) - rank(b)) || (b.value ?? 0) - (a.value ?? 0));
  const card = options[0];
  const rest = hand.filter(c => c !== card);
  return {
    type: 'play',
    cardId: card.id,
    color: card.color ? undefined : bestColor(rest.length ? rest : hand),
    uno: hand.length === 2,
  };
}
