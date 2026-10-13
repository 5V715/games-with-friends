import { addStrings } from '../../i18n.js';

const plural = (n, one, many) => (n === 1 ? one : many);

addStrings({
  en: {
    'game.uno': 'UNO',
    'uno.color.R': 'red',
    'uno.color.Y': 'yellow',
    'uno.color.G': 'green',
    'uno.color.B': 'blue',
    'uno.card': '{color} {sym}',
    'uno.sym.skip': 'Skip',
    'uno.sym.rev': 'Reverse',
    'uno.sym.draw2': '+2',
    'uno.sym.wild': 'Wild',
    'uno.sym.wild4': 'Wild +4',
    // errors
    'uno.err.notPlayable': 'That card does not match the color or symbol',
    'uno.err.chooseColor': 'Choose a color for the wild card',
    'uno.err.alreadyDrew': 'You already drew a card — play it or pass',
    'uno.err.onlyDrawn': 'You can only play the card you just drew',
    'uno.err.cannotPass': 'Draw a card first',
    'uno.err.noUno': 'You can only call UNO with one or two cards',
    'uno.err.cannotCatch': 'Nobody can be caught right now',
    // log
    'uno.log.start': 'Round {round} — {name} starts',
    'uno.log.played': '{name} played {card}',
    'uno.log.wild': (p) => `${p.name} played ${p.card} and chose ${p.color}`,
    'uno.log.drew': (p) => `${p.name} drew ${plural(p.n, 'a card', `${p.n} cards`)}`,
    'uno.log.passed': '{name} passed',
    'uno.log.uno': '{name} calls UNO!',
    'uno.log.caught': '{catcher} caught {name} without UNO — +2 cards',
    'uno.log.reshuffle': 'Discard pile reshuffled into the draw pile',
    'uno.log.won': '{name} wins round {round} and scores {points} points',
    'uno.log.gameOver': 'Game over — {name} wins with {points} points',
    // ui
    'uno.draw': 'Draw',
    'uno.pass': 'Keep',
    'uno.unoBtn': 'UNO!',
    'uno.catch': 'Catch {name}! (+2)',
    'uno.pickColor': 'Choose a color',
    'uno.status.yourTurn': 'Your turn — play a card or draw',
    'uno.status.drawn': 'Play the drawn card or keep it',
    'uno.status.other': '{name} is playing',
    'uno.status.roundOver': 'Round over',
    'uno.status.gameOver': 'Game over',
    'uno.cards': (p) => plural(p.n, '1 card', `${p.n} cards`),
    'uno.target': 'First to {n} points wins',
    'uno.roundWin': '{name} wins round {round}!',
    'uno.youWinRound': 'You win round {round}!',
    'uno.gained': '+{n}',
    'uno.rules.html': `
      <p>108 cards in four colors: numbers 0–9, <b>Skip</b>, <b>Reverse</b> and <b>+2</b>, plus <b>Wild</b> and <b>Wild +4</b>. Everyone gets 7 cards.</p>
      <h3>Your turn</h3>
      <p>Play a card that matches the top card's <b>color</b>, <b>number</b> or <b>symbol</b>, or a wild card (then pick the new color).
        If you can't or don't want to, <b>draw</b> one card — you may play it right away if it fits, otherwise keep it.</p>
      <h3>Action cards</h3>
      <p><b>Skip</b>: the next player misses a turn. <b>Reverse</b>: direction changes (with two players it works like Skip).
        <b>+2</b>: the next player draws 2 and misses a turn. <b>Wild +4</b>: pick a color; the next player draws 4 and misses a turn.</p>
      <h3>UNO!</h3>
      <p>Tap <b>UNO!</b> when you are down to your last card(s). If you end your turn with one card without calling it, the others can catch you before the next player moves — you draw 2.</p>
      <h3>Scoring</h3>
      <p>Whoever gets rid of all cards wins the round and scores the cards left in the others' hands: numbers face value, Skip/Reverse/+2 20 points, wild cards 50.
        First to <b>500</b> wins. After each round everyone votes on another round (majority decides).</p>`,
  },
  de: {
    'game.uno': 'UNO',
    'uno.color.R': 'Rot',
    'uno.color.Y': 'Gelb',
    'uno.color.G': 'Grün',
    'uno.color.B': 'Blau',
    'uno.card': '{color} {sym}',
    'uno.sym.skip': 'Aussetzen',
    'uno.sym.rev': 'Richtungswechsel',
    'uno.sym.draw2': '+2',
    'uno.sym.wild': 'Farbwahl',
    'uno.sym.wild4': 'Farbwahl +4',
    'uno.err.notPlayable': 'Die Karte passt weder in Farbe noch Symbol',
    'uno.err.chooseColor': 'Wähle eine Farbe für die Farbwahlkarte',
    'uno.err.alreadyDrew': 'Du hast schon gezogen — spiel die Karte oder behalte sie',
    'uno.err.onlyDrawn': 'Du darfst nur die gerade gezogene Karte spielen',
    'uno.err.cannotPass': 'Zieh zuerst eine Karte',
    'uno.err.noUno': 'UNO kannst du nur mit einer oder zwei Karten rufen',
    'uno.err.cannotCatch': 'Gerade kann niemand erwischt werden',
    'uno.log.start': 'Runde {round} — {name} beginnt',
    'uno.log.played': '{name} hat {card} gespielt',
    'uno.log.wild': (p) => `${p.name} hat ${p.card} gespielt und ${p.color} gewählt`,
    'uno.log.drew': (p) => `${p.name} hat ${plural(p.n, 'eine Karte', `${p.n} Karten`)} gezogen`,
    'uno.log.passed': '{name} behält die Karte',
    'uno.log.uno': '{name} ruft UNO!',
    'uno.log.caught': '{catcher} hat {name} ohne UNO erwischt — +2 Karten',
    'uno.log.reshuffle': 'Der Ablagestapel wurde neu gemischt',
    'uno.log.won': '{name} gewinnt Runde {round} und bekommt {points} Punkte',
    'uno.log.gameOver': 'Spiel vorbei — {name} gewinnt mit {points} Punkten',
    'uno.draw': 'Ziehen',
    'uno.pass': 'Behalten',
    'uno.unoBtn': 'UNO!',
    'uno.catch': '{name} erwischen! (+2)',
    'uno.pickColor': 'Wähle eine Farbe',
    'uno.status.yourTurn': 'Du bist dran — spiel eine Karte oder zieh',
    'uno.status.drawn': 'Gezogene Karte spielen oder behalten',
    'uno.status.other': '{name} ist dran',
    'uno.status.roundOver': 'Runde vorbei',
    'uno.status.gameOver': 'Spiel vorbei',
    'uno.cards': (p) => plural(p.n, '1 Karte', `${p.n} Karten`),
    'uno.target': 'Wer zuerst {n} Punkte hat, gewinnt',
    'uno.roundWin': '{name} gewinnt Runde {round}!',
    'uno.youWinRound': 'Du gewinnst Runde {round}!',
    'uno.gained': '+{n}',
    'uno.rules.html': `
      <p>108 Karten in vier Farben: Zahlen 0–9, <b>Aussetzen</b>, <b>Richtungswechsel</b> und <b>+2</b>, dazu <b>Farbwahl</b> und <b>Farbwahl +4</b>. Jeder bekommt 7 Karten.</p>
      <h3>Dein Zug</h3>
      <p>Lege eine Karte, die in <b>Farbe</b>, <b>Zahl</b> oder <b>Symbol</b> zur obersten Karte passt, oder eine Farbwahlkarte (dann wählst du die neue Farbe).
        Kannst oder willst du nicht, <b>ziehst</b> du eine Karte — passt sie, darfst du sie sofort spielen, sonst behältst du sie.</p>
      <h3>Aktionskarten</h3>
      <p><b>Aussetzen</b>: Der nächste Spieler setzt aus. <b>Richtungswechsel</b>: Die Richtung dreht sich (zu zweit wie Aussetzen).
        <b>+2</b>: Der nächste zieht 2 und setzt aus. <b>Farbwahl +4</b>: Farbe wählen; der nächste zieht 4 und setzt aus.</p>
      <h3>UNO!</h3>
      <p>Tippe <b>UNO!</b>, wenn du nur noch eine oder zwei Karten hast. Beendest du deinen Zug mit einer Karte, ohne UNO zu rufen, können dich die anderen erwischen, bevor der nächste zieht — dann ziehst du 2.</p>
      <h3>Wertung</h3>
      <p>Wer alle Karten los ist, gewinnt die Runde und bekommt die Punkte der Karten, die die anderen noch haben: Zahlen nach Wert, Aussetzen/Richtungswechsel/+2 je 20, Farbwahlkarten 50.
        Wer zuerst <b>500</b> Punkte hat, gewinnt. Nach jeder Runde stimmen alle ab, ob weitergespielt wird (Mehrheit entscheidet).</p>`,
  },
});
