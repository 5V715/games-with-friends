import { addStrings } from '../../i18n.js';

addStrings({
  en: {
    'game.kiez': 'Knobel-Kiez',
    'kiez.cat.ones': 'Ones',
    'kiez.cat.twos': 'Twos',
    'kiez.cat.threes': 'Threes',
    'kiez.cat.fours': 'Fours',
    'kiez.cat.fives': 'Fives',
    'kiez.cat.sixes': 'Sixes',
    'kiez.cat.three': 'Three of a kind',
    'kiez.cat.four': 'Four of a kind',
    'kiez.cat.full': 'Full house',
    'kiez.cat.small': 'Small straight',
    'kiez.cat.large': 'Large straight',
    'kiez.cat.king': 'Kiez King',
    'kiez.cat.chance': 'Chance',
    'kiez.sum.upper': 'Upper total',
    'kiez.sum.bonus': 'Bonus (63+)',
    'kiez.sum.kings': 'Kiez King bonus',
    'kiez.sum.total': 'Total',
    'kiez.err.rollFirst': 'Roll the dice first',
    'kiez.err.noRolls': 'No rolls left — enter your result',
    'kiez.err.taken': 'That box is already filled',
    'kiez.log.start': 'Game {round} — {name} starts',
    'kiez.log.scored': '{name}: {cat} {n}',
    'kiez.log.king': '{name} rolled a Kiez King!',
    'kiez.log.kingBonus': '{name} gets +{n} for another Kiez King',
    'kiez.log.won': '{name} wins game {round} with {points} points',
    'kiez.log.gameOver': 'Game over — {name} wins with {points} points in total',
    'kiez.roll': 'Roll',
    'kiez.rollLeft': 'Roll ({n} left)',
    'kiez.enter': 'Enter · {n}',
    'kiez.hold': 'HOLD',
    'kiez.status.first': 'Your turn — roll the dice',
    'kiez.status.yourTurn': 'Tap dice to hold them, roll again or pick a box',
    'kiez.status.last': 'Pick a box for your result',
    'kiez.status.other': '{name} is rolling',
    'kiez.status.roundOver': 'Game over — vote for another one',
    'kiez.status.gameOver': 'Game over',
    'kiez.roundWin': '{name} wins game {round}!',
    'kiez.youWinRound': 'You win game {round}!',
    'kiez.rules.html': `
      <p>Five dice, 13 boxes on your sheet. Whoever has the most points once every box is filled wins.</p>
      <h3>Your turn</h3>
      <p>Roll up to <b>three times</b>. After each roll tap dice to <b>hold</b> them and roll the rest again. Then enter the result in <b>one free box</b>; if nothing fits, you have to put a 0 somewhere.</p>
      <h3>Upper section</h3>
      <p>Ones to sixes: the sum of the dice showing that number. <b>63 or more</b> in the upper section earns a <b>35 point bonus</b> (that is three of each number).</p>
      <h3>Lower section</h3>
      <p><b>Three / four of a kind</b>: sum of all dice. <b>Full house</b> (three plus two): 25. <b>Small straight</b> (four in a row): 30. <b>Large straight</b> (five in a row): 40. <b>Kiez King</b> (five of a kind): 50. <b>Chance</b>: sum of all dice.</p>
      <h3>More Kiez Kings</h3>
      <p>Roll another five of a kind after the Kiez King box holds 50 and you get <b>+50 bonus</b>. Any further five of a kind also counts as a joker: full house and both straights score in full. Enter it in any free box.</p>
      <p>After a game everyone votes on another one; totals add up across games.</p>`,
  },
  de: {
    'game.kiez': 'Knobel-Kiez',
    'kiez.cat.ones': 'Einser',
    'kiez.cat.twos': 'Zweier',
    'kiez.cat.threes': 'Dreier',
    'kiez.cat.fours': 'Vierer',
    'kiez.cat.fives': 'Fünfer',
    'kiez.cat.sixes': 'Sechser',
    'kiez.cat.three': 'Dreierpasch',
    'kiez.cat.four': 'Viererpasch',
    'kiez.cat.full': 'Full House',
    'kiez.cat.small': 'Kleine Straße',
    'kiez.cat.large': 'Große Straße',
    'kiez.cat.king': 'Kiez-König',
    'kiez.cat.chance': 'Chance',
    'kiez.sum.upper': 'Summe oben',
    'kiez.sum.bonus': 'Bonus (ab 63)',
    'kiez.sum.kings': 'Kiez-König-Bonus',
    'kiez.sum.total': 'Gesamt',
    'kiez.err.rollFirst': 'Erst würfeln',
    'kiez.err.noRolls': 'Keine Würfe mehr — trag dein Ergebnis ein',
    'kiez.err.taken': 'Das Feld ist schon belegt',
    'kiez.log.start': 'Spiel {round} — {name} beginnt',
    'kiez.log.scored': '{name}: {cat} {n}',
    'kiez.log.king': '{name} hat einen Kiez-König gewürfelt!',
    'kiez.log.kingBonus': '{name} bekommt +{n} für einen weiteren Kiez-König',
    'kiez.log.won': '{name} gewinnt Spiel {round} mit {points} Punkten',
    'kiez.log.gameOver': 'Spiel vorbei — {name} gewinnt mit insgesamt {points} Punkten',
    'kiez.roll': 'Würfeln',
    'kiez.rollLeft': 'Würfeln ({n} übrig)',
    'kiez.enter': 'Eintragen · {n}',
    'kiez.hold': 'HALTEN',
    'kiez.status.first': 'Du bist dran — würfle',
    'kiez.status.yourTurn': 'Würfel antippen zum Halten, nochmal würfeln oder ein Feld wählen',
    'kiez.status.last': 'Wähle ein Feld für dein Ergebnis',
    'kiez.status.other': '{name} würfelt',
    'kiez.status.roundOver': 'Spiel vorbei — stimmt über ein weiteres ab',
    'kiez.status.gameOver': 'Spiel vorbei',
    'kiez.roundWin': '{name} gewinnt Spiel {round}!',
    'kiez.youWinRound': 'Du gewinnst Spiel {round}!',
    'kiez.rules.html': `
      <p>Fünf Würfel, 13 Felder auf deinem Zettel. Wer die meisten Punkte hat, wenn alle Felder voll sind, gewinnt.</p>
      <h3>Dein Zug</h3>
      <p>Du würfelst bis zu <b>dreimal</b>. Nach jedem Wurf tippst du Würfel an, um sie zu <b>halten</b>, und würfelst den Rest neu. Dann trägst du das Ergebnis in <b>ein freies Feld</b> ein; passt nichts, musst du irgendwo eine 0 eintragen.</p>
      <h3>Oberer Teil</h3>
      <p>Einser bis Sechser: die Summe der Würfel mit dieser Zahl. Ab <b>63 Punkten</b> oben gibt es <b>35 Bonuspunkte</b> (das sind dreimal jede Zahl).</p>
      <h3>Unterer Teil</h3>
      <p><b>Dreier- / Viererpasch</b>: Summe aller Würfel. <b>Full House</b> (drei plus zwei Gleiche): 25. <b>Kleine Straße</b> (vier in Folge): 30. <b>Große Straße</b> (fünf in Folge): 40. <b>Kiez-König</b> (fünf Gleiche): 50. <b>Chance</b>: Summe aller Würfel.</p>
      <h3>Weitere Kiez-Könige</h3>
      <p>Würfelst du nochmal fünf Gleiche, wenn im Kiez-König-Feld schon 50 stehen, gibt es <b>+50 Bonus</b>. Jeder weitere Kiez-König zählt außerdem als Joker: Full House und beide Straßen gibt es dann mit voller Punktzahl. Du darfst ihn in jedes freie Feld eintragen.</p>
      <p>Nach einem Spiel stimmen alle ab, ob noch eins gespielt wird; die Punkte werden über alle Spiele addiert.</p>`,
  },
});
