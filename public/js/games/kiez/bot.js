// Knobel-Kiez computer player: tries every way of holding dice, estimates the
// best box after the next roll by sampling, and enters the box that is worth
// the most compared to what that box usually brings.
import { CATEGORIES, UPPER, ROLLS, scoreFor, jokerFor, totals } from './engine.js';

// What a box typically scores; entering less than this is a loss.
const PAR = {
  ones: 2, twos: 5, threes: 8, fours: 11, fives: 14, sixes: 17,
  three: 15, four: 9, full: 17, small: 22, large: 16, king: 12, chance: 21,
};
const SAMPLES = 48;

function boxValue(sheet, cat, dice) {
  const pts = scoreFor(cat, dice, { joker: jokerFor(sheet, dice) });
  let v = pts - PAR[cat];
  const face = UPPER.indexOf(cat) + 1;
  if (face) {
    // Three of a face keeps the upper bonus on track.
    const { upper } = totals(sheet);
    if (upper < 63) v += pts >= face * 3 ? 6 : -3;
  }
  if (cat === 'chance') v -= 4; // keep the chance for a bad last roll
  return v;
}

function bestBox(sheet, dice) {
  let best = null;
  for (const cat of CATEGORIES) {
    if (sheet[cat] != null) continue;
    const v = boxValue(sheet, cat, dice);
    if (!best || v > best.v) best = { cat, v };
  }
  return best;
}

const roll = () => Math.floor(Math.random() * 6) + 1;

// Expected best box value when keeping the dice in `mask` and rolling the rest.
function expected(sheet, dice, mask) {
  if (mask === 31) return bestBox(sheet, dice).v;
  let total = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const next = dice.map((d, i) => (mask & (1 << i) ? d : roll()));
    total += bestBox(sheet, next).v;
  }
  return total / SAMPLES;
}

export function botStep(view) {
  if (view.phase === 'roundOver') return { type: 'vote', yes: true };
  if (view.phase !== 'play' || view.turn !== view.you) return null;
  if (view.rollsLeft === ROLLS) return { type: 'roll' };
  const me = view.players.find(p => p.id === view.you);
  const sheet = me.sheet;
  if (view.rollsLeft > 0) {
    let best = { mask: 31, v: expected(sheet, view.dice, 31) };
    for (let mask = 0; mask < 31; mask++) {
      const v = expected(sheet, view.dice, mask);
      if (v > best.v + 0.5) best = { mask, v };
    }
    if (best.mask !== 31) {
      return { type: 'roll', held: view.dice.map((_, i) => !!(best.mask & (1 << i))) };
    }
  }
  return { type: 'score', cat: bestBox(sheet, view.dice).cat };
}
