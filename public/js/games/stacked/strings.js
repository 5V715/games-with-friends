import { addStrings } from '../../i18n.js';

addStrings({
  en: {
    'game.stacked': 'Stacked',
    'stacked.ready': 'Ready?',
    'stacked.go': 'GO!',
    'stacked.ko': 'Knocked out — watch the others',
    'stacked.roundWin': '{name} wins round {round}!',
    'stacked.youWinRound': 'You win round {round}!',
    'stacked.draw': 'Round over — nobody scores',
    'stacked.youWin': 'You win the match!',
    'stacked.matchWin': '{name} wins the match!',
    'stacked.practiceOver': 'Practice over',
    'stacked.round': 'Round {round}',
    'stacked.wins': 'Wins',
    'stacked.lines': 'Lines',
    'stacked.hold': 'Hold',
    'stacked.next': 'Next',
    'stacked.level': 'Speed {n}',
    'stacked.tspin': 'T-spin',
    'stacked.combo': 'Combo {n}',
    'stacked.b2b': 'Back-to-back',
    'stacked.perfect': 'Perfect clear!',
    'stacked.howto': 'Drag ↔ move · Tap rotate · Flick ↓ drop · Flick ↑ or tap Hold to hold',
    'stacked.rules.html': `
      <p>Up to 4 players, each with their own well. Clear lines to send grey <b>garbage rows</b> to the others — the last one whose stack hasn't reached the top wins the round. <b>Best of 3.</b></p>
      <h3>Touch (the whole screen)</h3>
      <p><b>Drag left/right</b> to move · <b>tap</b> to rotate (right half clockwise, left half counter-clockwise) ·
        <b>drag down slowly</b> to soft drop · <b>flick down</b> to drop · <b>flick up</b> or <b>tap the Hold box</b> to hold the piece.</p>
      <h3>Keyboard</h3>
      <p>← → move · ↓ soft drop · ↑ or X rotate clockwise · Z rotate counter-clockwise · Space drop · C or Shift hold · hold T to talk.</p>
      <h3>Garbage</h3>
      <p>2 lines send 1, 3 lines send 2, 4 lines send 4. A <b>T-spin</b> — twisting the T piece into a slot it could not fall into — sends 2/4/6 for 1/2/3 lines.
        Clears in a row (combo) and two hard clears in a row (back-to-back) add extra; clearing the whole well sends 10.
        <b>Hold:</b> parks the current piece in the Hold box; if one is already there, it comes out instead. Once per piece — the box is greyed out until your piece has landed.
        Garbage coming at you shows as a red bar next to your well: your own clears cancel it first, the rest rises in after your next piece that clears nothing.
        It goes to whoever attacked you lately, otherwise to a random opponent.</p>
      <p>The small wells at the top show the others. They flash red with the number of lines when someone clears, and a red streak shows where their garbage goes. Pieces fall faster every 20 seconds.</p>`,
  },
  de: {
    'game.stacked': 'Stacked',
    'stacked.ready': 'Bereit?',
    'stacked.go': 'LOS!',
    'stacked.ko': 'Raus – schau den anderen zu',
    'stacked.roundWin': '{name} gewinnt Runde {round}!',
    'stacked.youWinRound': 'Du gewinnst Runde {round}!',
    'stacked.draw': 'Runde vorbei – niemand punktet',
    'stacked.youWin': 'Du gewinnst das Match!',
    'stacked.matchWin': '{name} gewinnt das Match!',
    'stacked.practiceOver': 'Training beendet',
    'stacked.round': 'Runde {round}',
    'stacked.wins': 'Siege',
    'stacked.lines': 'Reihen',
    'stacked.hold': 'Halten',
    'stacked.next': 'Nächste',
    'stacked.level': 'Tempo {n}',
    'stacked.tspin': 'T-Spin',
    'stacked.combo': 'Combo {n}',
    'stacked.b2b': 'Back-to-back',
    'stacked.perfect': 'Alles abgeräumt!',
    'stacked.howto': 'Ziehen ↔ bewegen · Tippen drehen · Wischen ↓ fallen · Wischen ↑ oder „Halten“ antippen',
    'stacked.rules.html': `
      <p>Bis zu 4 Spieler, jeder mit eigenem Schacht. Räum Reihen ab, um den anderen graue <b>Müllreihen</b> zu schicken – wessen Stapel zuletzt noch nicht oben angekommen ist, gewinnt die Runde. <b>Best of 3.</b></p>
      <h3>Touch (der ganze Bildschirm)</h3>
      <p><b>Nach links/rechts ziehen</b> zum Bewegen · <b>Tippen</b> zum Drehen (rechte Hälfte im Uhrzeigersinn, linke dagegen) ·
        <b>langsam nach unten ziehen</b> zum schnelleren Fallen · <b>nach unten wischen</b> lässt den Stein fallen · <b>nach oben wischen</b> oder <b>auf „Halten“ tippen</b> legt ihn zur Seite.</p>
      <h3>Tastatur</h3>
      <p>← → bewegen · ↓ schneller fallen · ↑ oder X im Uhrzeigersinn drehen · Z gegen den Uhrzeigersinn · Leertaste fallen lassen · C oder Shift halten · T gedrückt halten zum Sprechen.</p>
      <h3>Müll</h3>
      <p>2 Reihen schicken 1, 3 Reihen 2, 4 Reihen 4. Ein <b>T-Spin</b> – den T-Stein in eine Lücke drehen, in die er nicht hineinfallen könnte – schickt 2/4/6 für 1/2/3 Reihen.
        Mehrere Abräumer hintereinander (Combo) und zwei schwere Abräumer nacheinander (Back-to-back) geben extra; wer den ganzen Schacht leert, schickt 10.
        <b>Halten:</b> legt den aktuellen Stein in die Halten-Box; liegt dort schon einer, kommt dieser stattdessen ins Spiel. Einmal pro Stein – die Box ist ausgegraut, bis dein Stein gelandet ist.
        Müll, der auf dich zukommt, zeigt ein roter Balken neben deinem Schacht: Deine eigenen Abräumer heben ihn zuerst auf, der Rest steigt nach deinem nächsten Stein ohne Abräumer von unten herein.
        Er geht an den, der dich zuletzt angegriffen hat, sonst an einen zufälligen Gegner.</p>
      <p>Oben siehst du die Schächte der anderen klein. Sie blinken rot mit der Zahl der Reihen, wenn jemand abräumt, und ein roter Strich zeigt, wohin der Müll fliegt. Alle 20 Sekunden fallen die Steine schneller.</p>`,
  },
});
