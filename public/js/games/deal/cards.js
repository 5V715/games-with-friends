// Monopoly Deal card set: 106 playable cards.

export const SETS = {
  brown: { size: 2, rent: [1, 2], value: 1 },
  lblue: { size: 3, rent: [1, 2, 3], value: 1 },
  pink: { size: 3, rent: [1, 2, 4], value: 2 },
  orange: { size: 3, rent: [1, 3, 5], value: 2 },
  red: { size: 3, rent: [2, 3, 6], value: 3 },
  yellow: { size: 3, rent: [2, 4, 6], value: 3 },
  green: { size: 3, rent: [2, 4, 7], value: 4 },
  dblue: { size: 2, rent: [3, 8], value: 4 },
  rail: { size: 4, rent: [1, 2, 3, 4], value: 2 },
  util: { size: 2, rent: [1, 2], value: 2 },
};
export const COLORS = Object.keys(SETS);
export const NO_BUILDINGS = new Set(['rail', 'util']);

const ACTIONS = [
  ['dealbreaker', 2, 5], ['jsn', 3, 4], ['passgo', 10, 1], ['forced', 3, 3], ['sly', 3, 3],
  ['debt', 3, 3], ['birthday', 3, 2], ['double', 2, 1], ['house', 3, 3], ['hotel', 2, 4],
];
const WILDS = [
  ['any', 2, 0], [['dblue', 'green'], 1, 4], [['green', 'rail'], 1, 4], [['lblue', 'rail'], 1, 4],
  [['lblue', 'brown'], 1, 1], [['util', 'rail'], 1, 2], [['pink', 'orange'], 2, 2], [['red', 'yellow'], 2, 3],
];
const RENTS = [
  [['brown', 'lblue'], 2, 1], [['pink', 'orange'], 2, 1], [['red', 'yellow'], 2, 1],
  [['dblue', 'green'], 2, 1], [['rail', 'util'], 2, 1], ['any', 3, 3],
];
const MONEY = [[1, 6], [2, 5], [3, 3], [4, 3], [5, 2], [10, 1]];

export function createDealDeck() {
  const cards = [];
  let n = 0;
  const add = (c) => cards.push({ id: `m${n++}`, ...c });
  for (const [value, count] of MONEY) for (let i = 0; i < count; i++) add({ type: 'money', value });
  for (const [action, count, value] of ACTIONS) for (let i = 0; i < count; i++) add({ type: 'action', action, value });
  for (const [colors, count, value] of RENTS) for (let i = 0; i < count; i++) add({ type: 'rent', colors, value });
  // Each property is a named street (see deal.street.<color>.<n> in strings.js).
  for (const color of COLORS) for (let i = 0; i < SETS[color].size; i++) add({ type: 'prop', color, street: i, value: SETS[color].value });
  for (const [colors, count, value] of WILDS) for (let i = 0; i < count; i++) add({ type: 'wild', colors, value });
  return cards;
}

// Colors a property card may be placed on.
export function cardColors(card) {
  if (card.type === 'prop') return [card.color];
  if (card.type === 'wild') return card.colors === 'any' ? COLORS : card.colors;
  return [];
}

const colorT = (c) => ({ t: `deal.color.${c}` });
const pairT = (cs) => (cs === 'any' ? null : { t: 'deal.two', p: { a: colorT(cs[0]), b: colorT(cs[1]) } });

// Translatable card name for log messages and the UI.
export function cardLabel(card) {
  switch (card.type) {
    case 'money': return { t: 'deal.card.money', p: { v: card.value } };
    case 'prop': return card.street != null ? { t: `deal.street.${card.color}.${card.street}` } : { t: 'deal.card.prop', p: { color: colorT(card.color) } };
    case 'wild': return card.colors === 'any' ? { t: 'deal.card.wildAny' } : { t: 'deal.card.wild', p: { colors: pairT(card.colors) } };
    case 'rent': return card.colors === 'any' ? { t: 'deal.card.rentAny' } : { t: 'deal.card.rent', p: { colors: pairT(card.colors) } };
    default: return { t: `deal.card.${card.action}` };
  }
}
export { colorT };
