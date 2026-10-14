// The games you can play at a table. Each one brings an engine (rules,
// runs on the host), a bot and translated texts; the UI picks a screen by
// the view's `game` field.

import { Game as RommeGame, MIN_PLAYERS as ROMME_MIN, MAX_PLAYERS as ROMME_MAX } from '../engine.js';
import { botStep as rommeBot } from '../bot.js';
import { UnoGame, MIN_PLAYERS as UNO_MIN, MAX_PLAYERS as UNO_MAX } from './uno/engine.js';
import { botStep as unoBot } from './uno/bot.js';
import { DealGame, MIN_PLAYERS as DEAL_MIN, MAX_PLAYERS as DEAL_MAX } from './deal/engine.js';
import { botStep as dealBot } from './deal/bot.js';
import { BomberGame, MIN_PLAYERS as BOMBER_MIN, MAX_PLAYERS as BOMBER_MAX } from './bomber/engine.js';
import { botInput as bomberBot } from './bomber/bot.js';

export const GAMES = {
  romme: { id: 'romme', icon: '🂡', min: ROMME_MIN, max: ROMME_MAX, create: () => new RommeGame(), bot: rommeBot, rules: 'rules.html' },
  uno: { id: 'uno', icon: '🔄', min: UNO_MIN, max: UNO_MAX, create: () => new UnoGame(), bot: unoBot, rules: 'uno.rules.html' },
  deal: { id: 'deal', icon: '🏠', min: DEAL_MIN, max: DEAL_MAX, create: () => new DealGame(), bot: dealBot, rules: 'deal.rules.html' },
  // Real-time: the host runs a tick loop and asks the bot for input every tick.
  bomber: { id: 'bomber', icon: '💣', min: BOMBER_MIN, max: BOMBER_MAX, create: () => new BomberGame(), bot: bomberBot, rules: 'bomber.rules.html', realtime: true },
};

export const GAME_IDS = Object.keys(GAMES);
export const DEFAULT_GAME = 'romme';

export function gameInfo(id) {
  return GAMES[id] || GAMES[DEFAULT_GAME];
}
