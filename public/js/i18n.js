// Translations (English is the default and the fallback).
//
// The language comes from: ?lang= URL parameter > saved choice > the
// browser's languages (navigator.languages) > English.
//
// Game messages are created on the host but shown on every device, so the
// engine stores message keys + parameters and each device translates them
// into its own language.

export const LANGS = { en: 'English', de: 'Deutsch' };
const DEFAULT = 'en';
const KEY = 'romme.lang';

const plural = (n, one, many) => (n === 1 ? one : many);

// Rank letters on the cards: Jack/Queen/King = J/Q/K in English,
// Bube/Dame/König = B/D/K in German.
const RANKS = {
  en: { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' },
  de: { 1: 'A', 11: 'B', 12: 'D', 13: 'K', 14: 'A' },
};
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function rankName(rank, language = lang) {
  return (RANKS[language] || RANKS[DEFAULT])[rank] || String(rank);
}

// 'H11' -> 'J♥' / 'B♥', 'X' -> 'Joker'.
export function cardName(code, language = lang) {
  if (code === 'X') return 'Joker';
  return rankName(Number(code.slice(1)), language) + (SUIT_SYMBOLS[code[0]] || '');
}

const STRINGS = {
  en: {
    // ---- engine errors
    'err.gameStarted': 'Game already started',
    'err.tableFull': 'The table is full',
    'err.minPlayers': 'Need at least {n} players',
    'err.unknownPlayer': 'Unknown player',
    'err.roundRunning': 'Round is still running',
    'err.alreadyCut': 'The deck has already been cut',
    'err.waitCut': 'Waiting for {name} to cut the deck',
    'err.notCutter': 'Only the cutter can cut the deck',
    'err.noRound': 'No round in progress',
    'err.notYourTurn': "It's not your turn",
    'err.unknownAction': 'Unknown action',
    'err.drawFirst': 'Draw a card first',
    'err.selectCards': 'Select some cards',
    'err.duplicateCards': 'Duplicate cards',
    'err.notInHand': 'Card not in your hand',
    'err.alreadyDrew': 'You already drew a card',
    'err.discardNotOut': 'You may take from the discard pile once you are out ({min}+ points)',
    'err.discardEmpty': 'Discard pile is empty',
    'err.stockEmpty': 'No cards left to draw',
    'err.nothingToMeld': 'Nothing to meld',
    'err.invalidMeld': 'Not a valid set or run: {cards}',
    'err.firstMeldMin': 'First meld needs {min} points (you have {points})',
    'err.meldNotFound': 'Meld not found',
    'err.layoffNotOut': 'Make your first meld ({min}+ points) before adding to the table',
    'err.noFit': '{cards} does not fit there',
    'err.swapNotOut': 'Make your first meld before swapping jokers',
    'err.cannotSwap': '{card} cannot replace that joker',
    'err.throwBack': 'You cannot throw back the card you just picked up',
    // ---- session errors
    'err.badAction': 'Bad action',
    'err.hostOnly': 'Only the host can do that',
    'err.removeSelf': 'You cannot remove yourself',
    'err.gameStartedJoin': 'This game has already started',
    'err.seatTaken': 'Seat is taken',
    'err.removed': 'The host removed you from the table',
    'err.noVote': 'There is nothing to vote on right now',
    // ---- game log
    'log.roundCut': 'Round {round} — {name} cuts the deck',
    'log.cut': (p) => (p.kept ? `${p.name} cut and kept ${plural(p.kept, 'a joker', `${p.kept} jokers`)}!` : `${p.name} cut — no joker.`) + ` ${p.starter} starts`,
    'log.tookDiscard': '{name} took {card} from the discard pile',
    'log.drew': '{name} drew from the stock',
    'log.reshuffle': 'Discard pile reshuffled into the stock',
    'log.cameOut': '{name} came out with {points} points',
    'log.melded': (p) => `${p.name} melded ${p.n > 1 ? `${p.n} groups` : p.type === 'set' ? 'a set' : 'a run'}`,
    'log.added': '{name} added {cards}',
    'log.swapped': '{name} swapped {card} for a joker',
    'log.discarded': '{name} discarded {card}',
    'log.won': (p) => `${p.name} wins round ${p.round}${p.handRomme ? ' — Hand! Points ×2' : '!'}`,
    'log.gameOver': 'Game over — {names} wins with {points} points',

    // ---- home
    'game.romme': 'Rommé',
    'home.tagline': 'Play rummy with friends — browser to browser, no account needed.',
    'home.name': 'Your name',
    'home.namePh': 'Name',
    'home.create': 'Create table',
    'home.codePh': 'Table code',
    'home.join': 'Join',
    'home.manualJoin': 'Join with an invite code (no server)',
    'home.practice': 'Practice vs bots',
    'home.bots': (p) => plural(p.n, '1 bot', `${p.n} bots`),
    'home.botsAria': 'Number of bots',
    'home.howTo': 'How to play',
    'home.settings': 'Settings',
    'home.sigChecking': 'Checking signaling server…',
    'home.sigOk': 'Signaling: {host} · games run peer‑to‑peer over WebRTC',
    'home.sigDown': 'Signaling server {host} unreachable · use invite codes',
    'home.sigNone': 'No signaling server configured · use invite codes to connect',
    // ---- lobby
    'lobby.title': 'Table',
    'lobby.leave': 'Leave',
    'lobby.code': 'Table code',
    'lobby.share': 'Share invite link',
    'lobby.addBot': '+ Add bot',
    'lobby.invite': '+ Invite with code',
    'lobby.start': 'Start game',
    'lobby.waiting': 'Waiting for the host to start…',
    'lobby.you': ' (you)',
    'lobby.remove': 'Remove',
    'lobby.connecting': 'Connecting to host…',
    'lobby.youHost': 'You are the host',
    'lobby.shareText': 'Join my Rommé table {room}',
    // ---- connection chips
    'conn.host': 'host',
    'conn.bot': 'bot',
    'conn.relay': 'relay (TURN)',
    'conn.direct': 'direct P2P',
    'conn.connected': 'connected',
    'conn.checking': 'ICE checking…',
    'conn.unstable': 'unstable',
    'conn.offline': 'offline',
    // ---- game
    'game.you': 'You',
    'game.pts': '{n} pts',
    'game.out': 'out ✓',
    'game.drawStock': 'Draw from stock',
    'game.discardPile': 'Discard pile',
    'game.noMelds': 'No melds yet — first meld needs {min} points',
    'game.undo': 'Undo',
    'game.layDown': 'Lay down',
    'game.menu': 'Menu',
    'game.meld': 'Meld',
    'game.group': 'Group',
    'game.discard': 'Discard',
    'game.statusCut': 'Cut the deck',
    'game.statusCutting': 'Cutting the deck…',
    'game.statusRoundOver': 'Round over',
    'game.statusDraw': 'Your turn — draw a card',
    'game.statusPlay': 'Meld, then discard',
    'game.statusOther': '{name} is playing',
    'game.staged': '{total} / {min} pts',
    'game.stagedOut': '{total} pts',
    // ---- cut
    'cut.title': 'Cut the deck',
    'cut.other': '{name} is cutting the deck',
    'cut.hint': "Tap anywhere on the deck to cut it. You'll see the 3 cards at the cut — any joker among them is yours!",
    'cut.aria': 'Where to cut the deck',
    'cut.kept': (p) => (p.n === 1 ? 'You keep a joker! 🎉' : `You keep ${p.n} jokers! 🎉`),
    'cut.none': 'No joker this time',
    'cut.keptText': 'The joker is in your hand and counts towards your 12 cards. The other cards go back into the deck.',
    'cut.noneText': 'These cards go back into the deck.',
    'cut.play': 'Play',
    // ---- round over / scores
    'round.title': 'Round over',
    'round.youWin': 'You win round {round}',
    'round.otherWins': '{name} wins round {round}',
    'round.hand': ' — Hand! Points ×2',
    'round.showTable': 'Show table',
    'round.open': 'Result & vote',
    'vote.question': 'Play another round?',
    'vote.yes': 'Yes, play again',
    'vote.no': 'No, stop',
    'vote.again': 'again',
    'vote.stop': 'stop',
    'vote.pending': 'deciding…',
    'vote.rule': 'The majority decides; a tie means another round.',
    'over.title': 'Game over',
    'over.winner': '{names} wins with {points} points',
    'over.newGame': 'New game',
    'over.leave': 'Leave',
    'over.waitHost': 'The host can start a new game.',
    'over.open': 'Final score',
    'game.statusGameOver': 'Game over',
    'sheet.title': 'Score sheet',
    'sheet.open': 'Score sheet',
    'sheet.round': 'Round',
    'sheet.total': 'Total',
    'sheet.hand': 'Hand ×2',
    'scores.player': 'Player',
    'scores.round': 'Round',
    'scores.total': 'Total',
    // ---- menu
    'menu.title': 'Menu',
    'menu.leave': 'Leave game',
    'menu.back': 'Back to game',
    'menu.leaveConfirm': 'Leave this game?',
    'menu.practice': 'Practice game (offline).',
    'menu.hosting': 'You are hosting.',
    'menu.hostingRoom': 'You are hosting table <b>{room}</b>.',
    'menu.linkHost': 'Connection to host: {state}',
    'menu.relayed': 'relayed via TURN',
    'menu.direct': 'direct ({local}↔{remote})',
    'menu.unknown': 'unknown',
    // ---- invite dialogs
    'invite.title': 'Invite with a code',
    'invite.hint1': 'Works without the signaling server. Send this <b>invite code</b> to one friend (chat, mail…):',
    'invite.gathering': 'Gathering ICE candidates…',
    'invite.copy': 'Copy invite code',
    'invite.hint2': 'Then paste the <b>reply code</b> they send back:',
    'invite.answerPh': 'Paste reply code',
    'invite.cancel': 'Cancel',
    'invite.connect': 'Connect',
    'join.title': 'Join with an invite code',
    'join.hint1': 'Paste the <b>invite code</b> from the host:',
    'join.offerPh': 'Paste invite code',
    'join.makeAnswer': 'Create reply code',
    'join.hint2': "Send this <b>reply code</b> back to the host. You'll join as soon as they paste it.",
    'join.copy': 'Copy reply code',
    // ---- settings
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.langAuto': 'Automatic (browser)',
    'settings.sigHint': 'The <b>signaling server</b> only introduces players to each other (table codes). Leave empty to use the default; without one, connect with invite codes.',
    'settings.sigUrl': 'Signaling server URL',
    'settings.turnHint': 'Players connect directly using WebRTC. STUN finds a direct route; if a firewall blocks it, a <b>TURN</b> relay is needed. Add your own TURN server here (stored on this device only).',
    'settings.turnUrls': 'TURN URLs (comma separated)',
    'settings.user': 'Username',
    'settings.cred': 'Credential',
    'settings.relay': 'Always relay through TURN (hides your IP)',
    'settings.save': 'Save',
    'settings.cancel': 'Cancel',
    // ---- push to talk
    'ptt.hold': '🎤 Hold to talk',
    'ptt.aria': 'Hold to talk',
    'ptt.release': 'release to send',
    'ptt.left': '{s} s left',
    'ptt.speaking': '🔊 {name}',
    'ptt.someone': 'Someone',
    'ptt.playFailed': 'Could not play the message from {name}',
    'ptt.nobody': 'Nobody connected to hear you',
    'ptt.nobodyYet': 'Nobody connected yet',
    'ptt.sent': 'Sent ({s} s)',
    'ptt.sendFailed': 'Could not send the message',
    'ptt.denied': 'Microphone access was denied',
    'ptt.noMic': 'No microphone available',
    // ---- toasts
    'toast.copied': 'Copied',
    'toast.waitTurn': 'Wait for your turn',
    'toast.stagedFirst': 'Lay down or undo your staged groups first',
    'toast.layDownFirst': 'Lay down {min} points first',
    'toast.invalidMeld': 'That is not a valid set or run',
    'toast.morePoints': '{total} of {min} points — add more groups',
    'toast.groupMin': 'A group needs at least 3 cards',
    'toast.selectOne': 'Select one card to discard',
    'toast.selectFirst': 'Select cards from your hand first',
    'toast.noSignalHost': 'No signaling server — invite players with codes',
    'toast.codeExpired': 'Table code expired after inactivity. Players at the table stay connected; invite new players with a code.',
    'toast.codeClosed': 'Signaling server closed the table code. Players at the table stay connected.',
    'toast.createFailed': 'Could not create table: {error}',
    'toast.noHost': 'No table with that code (is the host still on the lobby page?)',
    'toast.roomFull': 'That table is full',
    'toast.sigUnreachable': 'Signaling server unreachable',
    'toast.joinFailed': 'Could not join: {error}',
    'toast.enterCode': 'Enter the table code',
    'toast.noSignalJoin': 'No signaling server configured or reachable — use an invite code',
    'toast.reconnecting': 'Connection lost — reconnecting…',
    'toast.disconnected': 'Disconnected from the host',
    'toast.inviteFailed': 'Could not create invite: {error}',
    'toast.pasteReply': 'Paste the reply code first',
    'toast.connecting': 'Connecting… (ICE checks running)',
    'toast.pasteInvite': 'Paste the invite code first',
    'toast.invalidInvite': 'Invalid invite code',
    'toast.relayNeedsTurn': 'Relay-only needs a TURN server',
    'toast.turnUrl': 'TURN URLs start with turn: or turns:',
    'toast.saved': 'Saved — applies to new connections',
    'code.notCode': 'Not a Rommé connection code',
    'code.isReply': "That is a reply code — paste the host's invite code",
    'code.isInvite': "That is an invite code — paste the guest's reply code",
    // ---- rules (HTML)
    'rules.title': 'How to play',
    'rules.ok': 'Got it',
    'rules.html': `
      <p>110 cards: two decks plus 6 jokers. Everyone gets 12 cards; the starting player gets 13 and begins by discarding (no draw on the first turn). Get rid of all your cards first.</p>
      <h3>Cutting the deck</h3>
      <p>Before each round the player to the dealer's right cuts the deck and looks at the 3 cards at the cut. Any jokers among them they keep (they count towards their 12 cards).</p>
      <h3>Your turn</h3>
      <ol>
        <li><b>Draw</b> – tap the stock. Once you are out, you may take the top card of the discard pile instead.</li>
        <li><b>Meld</b> (optional) – select cards and tap <i>Meld</i>.</li>
        <li><b>Discard</b> – select one card and tap the discard pile.</li>
      </ol>
      <h3>Melds</h3>
      <p><b>Set:</b> 3–4 cards of the same rank, all different suits (7♥ 7♠ 7♦).<br>
         <b>Run:</b> 3+ cards in a row, same suit (4♣ 5♣ 6♣). Ace is low (A‑2‑3) or high (Q‑K‑A).<br>
         <b>Jokers</b> replace any card.</p>
      <h3>Coming out</h3>
      <p>Your first meld must be worth at least <b>40 points</b> (2–9 face value, 10/J/Q/K = 10, ace = 11 or 1 in A‑2‑3). Stage several groups and tap <i>Lay down</i>. Once you are out — and only on your turn — you may take from the discard pile, add cards to any meld on the table (select cards, tap the meld) and swap a joker for the card it stands for if you hold that card.</p>
      <h3>Scoring</h3>
      <p>Whoever goes out scores 0. Everyone else scores the cards left in their hand: numbers their face value, pictures (J, Q, K) 10, ace 11, joker 20.
        If someone goes out in a single turn while nobody was out yet, that is a <b>Hand</b>: all points of that round count double.</p>
      <h3>Another round?</h3>
      <p>After each round everybody votes whether to play on. The majority decides; a tie means another round. The score sheet (📊) shows every round. When you stop, the lowest total wins.</p>
      <h3>Talking</h3>
      <p>Hold the 🎤 button and speak (up to 15 seconds); let go to send. Everyone at the table hears it right away.</p>
      <h3>Touch tips</h3>
      <p>Tap to select. Drag a card to rearrange your hand, or drag it onto a meld or the discard pile. Dragging a selected card moves all selected cards.</p>`,
  },

  de: {
    'err.gameStarted': 'Das Spiel hat schon begonnen',
    'err.tableFull': 'Der Tisch ist voll',
    'err.minPlayers': 'Es braucht mindestens {n} Spieler',
    'err.unknownPlayer': 'Unbekannter Spieler',
    'err.roundRunning': 'Die Runde läuft noch',
    'err.alreadyCut': 'Es wurde schon abgehoben',
    'err.waitCut': 'Warte, bis {name} abgehoben hat',
    'err.notCutter': 'Nur der Abhebende darf abheben',
    'err.noRound': 'Gerade läuft keine Runde',
    'err.notYourTurn': 'Du bist nicht dran',
    'err.unknownAction': 'Unbekannte Aktion',
    'err.drawFirst': 'Zieh zuerst eine Karte',
    'err.selectCards': 'Wähle Karten aus',
    'err.duplicateCards': 'Doppelte Karten',
    'err.notInHand': 'Diese Karte ist nicht auf deiner Hand',
    'err.alreadyDrew': 'Du hast schon eine Karte gezogen',
    'err.discardNotOut': 'Vom Ablagestapel darfst du erst ziehen, wenn du draußen bist ({min}+ Punkte)',
    'err.discardEmpty': 'Der Ablagestapel ist leer',
    'err.stockEmpty': 'Keine Karten mehr zum Ziehen',
    'err.nothingToMeld': 'Nichts zum Auslegen',
    'err.invalidMeld': 'Kein gültiger Satz und keine Reihe: {cards}',
    'err.firstMeldMin': 'Zum Rauskommen brauchst du {min} Punkte (du hast {points})',
    'err.meldNotFound': 'Auslage nicht gefunden',
    'err.layoffNotOut': 'Komm zuerst raus ({min}+ Punkte), bevor du anlegst',
    'err.noFit': '{cards} passt dort nicht',
    'err.swapNotOut': 'Komm zuerst raus, bevor du Joker tauschst',
    'err.cannotSwap': '{card} kann diesen Joker nicht ersetzen',
    'err.throwBack': 'Die gerade aufgenommene Karte darfst du nicht wieder ablegen',
    'err.badAction': 'Ungültige Aktion',
    'err.hostOnly': 'Das darf nur der Gastgeber',
    'err.removeSelf': 'Du kannst dich nicht selbst entfernen',
    'err.gameStartedJoin': 'Dieses Spiel hat schon begonnen',
    'err.seatTaken': 'Der Platz ist schon besetzt',
    'err.removed': 'Der Gastgeber hat dich vom Tisch entfernt',
    'err.noVote': 'Gerade gibt es nichts abzustimmen',
    'log.roundCut': 'Runde {round} — {name} hebt ab',
    'log.cut': (p) => (p.kept ? `${p.name} hat abgehoben und ${plural(p.kept, 'einen Joker', `${p.kept} Joker`)} behalten!` : `${p.name} hat abgehoben — kein Joker.`) + ` ${p.starter} beginnt`,
    'log.tookDiscard': '{name} hat {card} vom Ablagestapel genommen',
    'log.drew': '{name} hat vom Stapel gezogen',
    'log.reshuffle': 'Der Ablagestapel wurde neu gemischt',
    'log.cameOut': '{name} ist mit {points} Punkten rausgekommen',
    'log.melded': (p) => `${p.name} hat ${p.n > 1 ? `${p.n} Gruppen` : p.type === 'set' ? 'einen Satz' : 'eine Reihe'} ausgelegt`,
    'log.added': '{name} hat {cards} angelegt',
    'log.swapped': '{name} hat {card} gegen einen Joker getauscht',
    'log.discarded': '{name} hat {card} abgelegt',
    'log.won': (p) => `${p.name} gewinnt Runde ${p.round}${p.handRomme ? ' — Hand! Punkte ×2' : '!'}`,
    'log.gameOver': 'Spiel vorbei — {names} gewinnt mit {points} Punkten',

    'game.romme': 'Rommé',
    'home.tagline': 'Rommé mit Freunden — direkt von Browser zu Browser, ohne Konto.',
    'home.name': 'Dein Name',
    'home.namePh': 'Name',
    'home.create': 'Tisch erstellen',
    'home.codePh': 'Tisch-Code',
    'home.join': 'Beitreten',
    'home.manualJoin': 'Mit Einladungscode beitreten (ohne Server)',
    'home.practice': 'Üben gegen Bots',
    'home.bots': (p) => plural(p.n, '1 Bot', `${p.n} Bots`),
    'home.botsAria': 'Anzahl Bots',
    'home.howTo': 'Spielregeln',
    'home.settings': 'Einstellungen',
    'home.sigChecking': 'Prüfe Signaling-Server…',
    'home.sigOk': 'Signaling: {host} · Spiele laufen direkt per WebRTC',
    'home.sigDown': 'Signaling-Server {host} nicht erreichbar · nutze Einladungscodes',
    'home.sigNone': 'Kein Signaling-Server eingerichtet · verbinde dich per Einladungscode',
    'lobby.title': 'Tisch',
    'lobby.leave': 'Verlassen',
    'lobby.code': 'Tisch-Code',
    'lobby.share': 'Einladungslink teilen',
    'lobby.addBot': '+ Bot hinzufügen',
    'lobby.invite': '+ Per Code einladen',
    'lobby.start': 'Spiel starten',
    'lobby.waiting': 'Warte, bis der Gastgeber startet…',
    'lobby.you': ' (du)',
    'lobby.remove': 'Entfernen',
    'lobby.connecting': 'Verbinde mit dem Gastgeber…',
    'lobby.youHost': 'Du bist der Gastgeber',
    'lobby.shareText': 'Komm an meinen Rommé-Tisch {room}',
    'conn.host': 'Gastgeber',
    'conn.bot': 'Bot',
    'conn.relay': 'über TURN',
    'conn.direct': 'direkt P2P',
    'conn.connected': 'verbunden',
    'conn.checking': 'ICE prüft…',
    'conn.unstable': 'instabil',
    'conn.offline': 'offline',
    'game.you': 'Du',
    'game.pts': '{n} Pkt.',
    'game.out': 'draußen ✓',
    'game.drawStock': 'Vom Stapel ziehen',
    'game.discardPile': 'Ablagestapel',
    'game.noMelds': 'Noch nichts ausgelegt — zum Rauskommen braucht man {min} Punkte',
    'game.undo': 'Zurück',
    'game.layDown': 'Auslegen',
    'game.menu': 'Menü',
    'game.meld': 'Auslegen',
    'game.group': 'Gruppe',
    'game.discard': 'Ablegen',
    'game.statusCut': 'Heb ab',
    'game.statusCutting': 'Es wird abgehoben…',
    'game.statusRoundOver': 'Runde vorbei',
    'game.statusDraw': 'Du bist dran — zieh eine Karte',
    'game.statusPlay': 'Auslegen, dann ablegen',
    'game.statusOther': '{name} ist dran',
    'game.staged': '{total} / {min} Pkt.',
    'game.stagedOut': '{total} Pkt.',
    'cut.title': 'Heb ab',
    'cut.other': '{name} hebt ab',
    'cut.hint': 'Tippe irgendwo auf den Stapel, um abzuheben. Du siehst die 3 Karten an der Stelle — Joker darunter darfst du behalten!',
    'cut.aria': 'Wo abgehoben wird',
    'cut.kept': (p) => (p.n === 1 ? 'Du behältst einen Joker! 🎉' : `Du behältst ${p.n} Joker! 🎉`),
    'cut.none': 'Diesmal kein Joker',
    'cut.keptText': 'Der Joker ist auf deiner Hand und zählt zu deinen 12 Karten. Die anderen Karten kommen zurück in den Stapel.',
    'cut.noneText': 'Diese Karten kommen zurück in den Stapel.',
    'cut.play': 'Spielen',
    'round.title': 'Runde vorbei',
    'round.youWin': 'Du gewinnst Runde {round}',
    'round.otherWins': '{name} gewinnt Runde {round}',
    'round.hand': ' — Hand! Punkte ×2',
    'round.showTable': 'Tisch zeigen',
    'round.open': 'Ergebnis & Abstimmung',
    'vote.question': 'Noch eine Runde?',
    'vote.yes': 'Ja, nochmal',
    'vote.no': 'Nein, aufhören',
    'vote.again': 'nochmal',
    'vote.stop': 'aufhören',
    'vote.pending': 'überlegt…',
    'vote.rule': 'Die Mehrheit entscheidet, bei Gleichstand wird weitergespielt.',
    'over.title': 'Spiel vorbei',
    'over.winner': '{names} gewinnt mit {points} Punkten',
    'over.newGame': 'Neues Spiel',
    'over.leave': 'Verlassen',
    'over.waitHost': 'Der Gastgeber kann ein neues Spiel starten.',
    'over.open': 'Endstand',
    'game.statusGameOver': 'Spiel vorbei',
    'sheet.title': 'Punktestand',
    'sheet.open': 'Punktestand',
    'sheet.round': 'Runde',
    'sheet.total': 'Summe',
    'sheet.hand': 'Hand ×2',
    'scores.player': 'Spieler',
    'scores.round': 'Runde',
    'scores.total': 'Gesamt',
    'menu.title': 'Menü',
    'menu.leave': 'Spiel verlassen',
    'menu.back': 'Zurück zum Spiel',
    'menu.leaveConfirm': 'Dieses Spiel verlassen?',
    'menu.practice': 'Übungsspiel (offline).',
    'menu.hosting': 'Du bist Gastgeber.',
    'menu.hostingRoom': 'Du bist Gastgeber von Tisch <b>{room}</b>.',
    'menu.linkHost': 'Verbindung zum Gastgeber: {state}',
    'menu.relayed': 'über TURN weitergeleitet',
    'menu.direct': 'direkt ({local}↔{remote})',
    'menu.unknown': 'unbekannt',
    'invite.title': 'Per Code einladen',
    'invite.hint1': 'Funktioniert ohne Signaling-Server. Schick diesen <b>Einladungscode</b> an eine Person (Chat, Mail…):',
    'invite.gathering': 'Sammle ICE-Kandidaten…',
    'invite.copy': 'Einladungscode kopieren',
    'invite.hint2': 'Füge dann den <b>Antwortcode</b> ein, den du zurückbekommst:',
    'invite.answerPh': 'Antwortcode einfügen',
    'invite.cancel': 'Abbrechen',
    'invite.connect': 'Verbinden',
    'join.title': 'Mit Einladungscode beitreten',
    'join.hint1': 'Füge den <b>Einladungscode</b> vom Gastgeber ein:',
    'join.offerPh': 'Einladungscode einfügen',
    'join.makeAnswer': 'Antwortcode erstellen',
    'join.hint2': 'Schick diesen <b>Antwortcode</b> an den Gastgeber zurück. Sobald er ihn einfügt, bist du dabei.',
    'join.copy': 'Antwortcode kopieren',
    'settings.title': 'Einstellungen',
    'settings.language': 'Sprache',
    'settings.langAuto': 'Automatisch (Browser)',
    'settings.sigHint': 'Der <b>Signaling-Server</b> bringt die Spieler nur zusammen (Tisch-Codes). Leer lassen für den Standard; ohne Server verbindet ihr euch per Einladungscode.',
    'settings.sigUrl': 'Signaling-Server-URL',
    'settings.turnHint': 'Die Spieler verbinden sich direkt per WebRTC. STUN findet einen direkten Weg; blockiert eine Firewall ihn, braucht es ein <b>TURN</b>-Relay. Hier kannst du einen eigenen TURN-Server eintragen (nur auf diesem Gerät gespeichert).',
    'settings.turnUrls': 'TURN-URLs (mit Komma getrennt)',
    'settings.user': 'Benutzername',
    'settings.cred': 'Passwort',
    'settings.relay': 'Immer über TURN verbinden (verbirgt deine IP)',
    'settings.save': 'Speichern',
    'settings.cancel': 'Abbrechen',
    'ptt.hold': '🎤 Gedrückt halten zum Sprechen',
    'ptt.aria': 'Gedrückt halten zum Sprechen',
    'ptt.release': 'loslassen zum Senden',
    'ptt.left': 'noch {s} s',
    'ptt.speaking': '🔊 {name}',
    'ptt.someone': 'Jemand',
    'ptt.playFailed': 'Die Nachricht von {name} konnte nicht abgespielt werden',
    'ptt.nobody': 'Niemand ist verbunden, der dich hören könnte',
    'ptt.nobodyYet': 'Noch niemand verbunden',
    'ptt.sent': 'Gesendet ({s} s)',
    'ptt.sendFailed': 'Die Nachricht konnte nicht gesendet werden',
    'ptt.denied': 'Zugriff aufs Mikrofon wurde verweigert',
    'ptt.noMic': 'Kein Mikrofon gefunden',
    'toast.copied': 'Kopiert',
    'toast.waitTurn': 'Warte, bis du dran bist',
    'toast.stagedFirst': 'Lege zuerst deine Gruppen aus oder nimm sie zurück',
    'toast.layDownFirst': 'Komm zuerst mit {min} Punkten raus',
    'toast.invalidMeld': 'Das ist kein gültiger Satz und keine Reihe',
    'toast.morePoints': '{total} von {min} Punkten — lege weitere Gruppen dazu',
    'toast.groupMin': 'Eine Gruppe braucht mindestens 3 Karten',
    'toast.selectOne': 'Wähle eine Karte zum Ablegen',
    'toast.selectFirst': 'Wähle zuerst Karten auf deiner Hand',
    'toast.noSignalHost': 'Kein Signaling-Server — lade Spieler per Code ein',
    'toast.codeExpired': 'Der Tisch-Code ist wegen Inaktivität abgelaufen. Wer schon am Tisch sitzt, bleibt verbunden; neue Spieler lädst du per Code ein.',
    'toast.codeClosed': 'Der Signaling-Server hat den Tisch-Code geschlossen. Wer am Tisch sitzt, bleibt verbunden.',
    'toast.createFailed': 'Tisch konnte nicht erstellt werden: {error}',
    'toast.noHost': 'Kein Tisch mit diesem Code (ist der Gastgeber noch in der Lobby?)',
    'toast.roomFull': 'Dieser Tisch ist voll',
    'toast.sigUnreachable': 'Signaling-Server nicht erreichbar',
    'toast.joinFailed': 'Beitreten fehlgeschlagen: {error}',
    'toast.enterCode': 'Gib den Tisch-Code ein',
    'toast.noSignalJoin': 'Kein Signaling-Server eingerichtet oder erreichbar — nutze einen Einladungscode',
    'toast.reconnecting': 'Verbindung verloren — verbinde neu…',
    'toast.disconnected': 'Verbindung zum Gastgeber getrennt',
    'toast.inviteFailed': 'Einladung konnte nicht erstellt werden: {error}',
    'toast.pasteReply': 'Füge zuerst den Antwortcode ein',
    'toast.connecting': 'Verbinde… (ICE-Prüfung läuft)',
    'toast.pasteInvite': 'Füge zuerst den Einladungscode ein',
    'toast.invalidInvite': 'Ungültiger Einladungscode',
    'toast.relayNeedsTurn': 'Nur-Relay braucht einen TURN-Server',
    'toast.turnUrl': 'TURN-URLs beginnen mit turn: oder turns:',
    'toast.saved': 'Gespeichert — gilt für neue Verbindungen',
    'code.notCode': 'Das ist kein Rommé-Verbindungscode',
    'code.isReply': 'Das ist ein Antwortcode — füge den Einladungscode des Gastgebers ein',
    'code.isInvite': 'Das ist ein Einladungscode — füge den Antwortcode des Gastes ein',
    'rules.title': 'Spielregeln',
    'rules.ok': 'Verstanden',
    'rules.html': `
      <p>110 Karten: zwei Kartenspiele und 6 Joker. Jeder bekommt 12 Karten; wer beginnt, bekommt 13 und legt im ersten Zug nur ab (ohne zu ziehen). Ziel: als Erster alle Karten loswerden.</p>
      <h3>Abheben</h3>
      <p>Vor jeder Runde hebt der Spieler rechts vom Geber ab und sieht sich die 3 Karten an der Abhebestelle an. Joker darunter darf er behalten (sie zählen zu seinen 12 Karten).</p>
      <h3>Dein Zug</h3>
      <ol>
        <li><b>Ziehen</b> – tippe auf den Stapel. Bist du draußen, darfst du stattdessen die oberste Karte vom Ablagestapel nehmen.</li>
        <li><b>Auslegen</b> (optional) – Karten auswählen und <i>Auslegen</i> tippen.</li>
        <li><b>Ablegen</b> – eine Karte auswählen und auf den Ablagestapel tippen.</li>
      </ol>
      <h3>Auslagen</h3>
      <p><b>Satz:</b> 3–4 Karten gleichen Werts in verschiedenen Farben (7♥ 7♠ 7♦).<br>
         <b>Reihe:</b> 3+ aufeinanderfolgende Karten einer Farbe (4♣ 5♣ 6♣). Das Ass ist niedrig (A‑2‑3) oder hoch (D‑K‑A).<br>
         <b>Joker</b> ersetzen jede Karte.</p>
      <h3>Rauskommen</h3>
      <p>Deine erste Auslage muss mindestens <b>40 Punkte</b> wert sein (2–9 nach Augen, 10/B/D/K = 10, Ass = 11 bzw. 1 in A‑2‑3). Stelle mehrere Gruppen zusammen und tippe <i>Auslegen</i>. Bist du draußen — und nur wenn du dran bist —, darfst du vom Ablagestapel ziehen, Karten an jede Auslage anlegen (Karten wählen, Auslage antippen) und einen Joker gegen die Karte tauschen, für die er steht, wenn du sie hast.</p>
      <h3>Wertung</h3>
      <p>Wer rausgeht, bekommt 0 Punkte. Alle anderen zählen die Karten, die sie noch auf der Hand haben: Zahlen ihren Eigenwert, Bilder (B, D, K) 10, Ass 11, Joker 20.
        Beendet jemand die Runde in einem einzigen Zug, ohne dass schon jemand draußen war, ist das eine <b>Hand</b>: Alle Punkte dieser Runde zählen doppelt.</p>
      <h3>Noch eine Runde?</h3>
      <p>Nach jeder Runde stimmen alle ab, ob weitergespielt wird. Die Mehrheit entscheidet, bei Gleichstand geht es weiter. Der Punktestand (📊) zeigt alle Runden. Hört ihr auf, gewinnt die niedrigste Summe.</p>
      <h3>Sprechen</h3>
      <p>Halte den 🎤-Knopf gedrückt und sprich (bis zu 15 Sekunden); loslassen sendet. Alle am Tisch hören es sofort.</p>
      <h3>Tipps</h3>
      <p>Tippen wählt aus. Zieh eine Karte, um deine Hand zu sortieren, oder zieh sie auf eine Auslage oder den Ablagestapel. Ziehst du eine ausgewählte Karte, wandern alle ausgewählten mit.</p>`,
  },
};

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function savedLang() {
  return storage()?.getItem(KEY) || '';
}

export function detectLang() {
  const param = globalThis.location ? new URLSearchParams(globalThis.location.search).get('lang') : null;
  const candidates = [param, savedLang(), ...(globalThis.navigator?.languages || [globalThis.navigator?.language])];
  for (const c of candidates) {
    const base = String(c || '').toLowerCase().split('-')[0];
    if (LANGS[base]) return base;
  }
  return DEFAULT;
}

export let lang = detectLang();

// '' = follow the browser again.
export function setLang(l) {
  const s = storage();
  try {
    if (l && LANGS[l]) s?.setItem(KEY, l);
    else s?.removeItem(KEY);
  } catch { /* storage blocked */ }
  lang = detectLang();
  return lang;
}

// Translate into a given language (falls back to English, then the key).
export function tr(language, key, params = {}) {
  const s = STRINGS[language]?.[key] ?? STRINGS[DEFAULT][key];
  if (s == null) return key;
  // Arrays of card codes are labelled in the target language.
  const p = {};
  // A param { t: key, p: params } is itself translated (nested labels).
  for (const [k, v] of Object.entries(params)) {
    p[k] = Array.isArray(v) ? v.map(c => cardName(c, language)).join(' ')
      : v && typeof v === 'object' && v.t ? tr(language, v.t, v.p || {}) : v;
  }
  if (typeof s === 'function') return s(p);
  return s.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''));
}

export function t(key, params) {
  return tr(lang, key, params);
}

// Turns a { key, params } message (from the engine/host) into text.
export function msg(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  return t(m.key, m.params);
}

// Fills elements marked with data-i18n* attributes.
export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

// Games register their own texts: addStrings({ en: {...}, de: {...} }).
export function addStrings(dicts) {
  for (const [code, dict] of Object.entries(dicts)) Object.assign(STRINGS[code] ||= {}, dict);
}

// For tests: the raw dictionaries.
export const _strings = STRINGS;

export function hasKey(key) {
  return key in STRINGS[DEFAULT];
}
