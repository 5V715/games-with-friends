import { addStrings } from '../../i18n.js';

addStrings({
  en: {
    'game.bomber': 'Bomber Buben',
    'bomber.rotate': 'Turn your phone sideways to play',
    'bomber.ready': 'Ready?',
    'bomber.go': 'GO!',
    'bomber.hurry': 'HURRY UP!',
    'bomber.roundWin': '{name} wins round {round}!',
    'bomber.youWinRound': 'You win round {round}!',
    'bomber.draw': 'Draw — nobody scores',
    'bomber.youWin': 'You win the match!',
    'bomber.matchWin': '{name} wins the match!',
    'bomber.practiceOver': 'Practice over',
    'bomber.wins': 'Wins',
    'bomber.round': 'Round {round}',
    'bomber.dead': 'You are out — watch the others',
    'bomber.a': 'Bomb',
    'bomber.b': 'Special',
    'bomber.disease.slow': 'Slow!',
    'bomber.disease.fast': 'Too fast!',
    'bomber.disease.short': 'Tiny flames!',
    'bomber.disease.noBomb': 'No bombs!',
    'bomber.disease.diarrhea': 'Bomb dropping!',
    'bomber.disease.reverse': 'Reversed controls!',
    'bomber.rules.html': `
      <p>Up to 4 players in a walled arena. Blow up the others with bombs — the last one standing wins the round. <b>Best of 3</b>: whoever wins 2 rounds wins the match.</p>
      <h3>Controls</h3>
      <p>Hold the phone sideways. Left: the <b>D-pad</b>. Right: <b>A</b> drops a bomb, <b>B</b> is the special button: set off remote bombs, stop a kicked bomb, punch or pick up and throw (with the gloves).
        On a keyboard: arrow keys or WASD, Space/K for A, Shift/J for B, hold T to talk.</p>
      <h3>Bombs</h3>
      <p>A bomb explodes after 2.5 seconds in a cross. Flames stop at walls, destroy soft blocks and set off other bombs. You can walk off your own bomb, but not back onto it.</p>
      <h3>Items</h3>
      <p>Hidden under soft blocks:
        <b>Bomb up</b> (one more bomb at a time), <b>Fire up</b> (longer flames), <b>Skate</b> (faster),
        <b>Kick</b> (walk into a bomb to kick it), <b>Remote</b> (bombs wait for B), <b>Full fire</b> (maximum flames),
        <b>Boxing glove</b> (B punches the bomb in front of you 3 cells, over walls), <b>Throw glove</b> (B on your bomb picks it up, B again throws it 3 cells; a bomb landing on someone dazes them)
        and the <b>Skull</b>: a random curse for 10 seconds that jumps to whoever you touch.
        Flames destroy items lying around.</p>
      <h3>Hurry up</h3>
      <p>After two minutes, blocks fall from the outside in. Don't get squashed. If the last players go down together, the round is a draw.</p>`,
  },
  de: {
    'game.bomber': 'Bomber Buben',
    'bomber.rotate': 'Halte dein Handy quer, um zu spielen',
    'bomber.ready': 'Bereit?',
    'bomber.go': 'LOS!',
    'bomber.hurry': 'BEEIL DICH!',
    'bomber.roundWin': '{name} gewinnt Runde {round}!',
    'bomber.youWinRound': 'Du gewinnst Runde {round}!',
    'bomber.draw': 'Unentschieden – niemand punktet',
    'bomber.youWin': 'Du gewinnst das Match!',
    'bomber.matchWin': '{name} gewinnt das Match!',
    'bomber.practiceOver': 'Training beendet',
    'bomber.wins': 'Siege',
    'bomber.round': 'Runde {round}',
    'bomber.dead': 'Du bist raus – schau den anderen zu',
    'bomber.a': 'Bombe',
    'bomber.b': 'Spezial',
    'bomber.disease.slow': 'Langsam!',
    'bomber.disease.fast': 'Zu schnell!',
    'bomber.disease.short': 'Mini-Flammen!',
    'bomber.disease.noBomb': 'Keine Bomben!',
    'bomber.disease.diarrhea': 'Bomben-Durchfall!',
    'bomber.disease.reverse': 'Steuerung vertauscht!',
    'bomber.rules.html': `
      <p>Bis zu 4 Spieler in einer ummauerten Arena. Spreng die anderen mit Bomben weg – wer als Letzter steht, gewinnt die Runde. <b>Best of 3</b>: Wer 2 Runden gewinnt, gewinnt das Match.</p>
      <h3>Steuerung</h3>
      <p>Halte das Handy quer. Links das <b>Steuerkreuz</b>, rechts <b>A</b> zum Bombe-Legen und <b>B</b> als Spezialknopf: Fernzünder zünden, gekickte Bombe stoppen, boxen oder aufheben und werfen (mit den Handschuhen).
        Mit Tastatur: Pfeiltasten oder WASD, Leertaste/K für A, Shift/J für B, T gedrückt halten zum Sprechen.</p>
      <h3>Bomben</h3>
      <p>Eine Bombe explodiert nach 2,5 Sekunden in Kreuzform. Flammen stoppen an Mauern, zerstören weiche Blöcke und zünden andere Bomben. Von deiner eigenen Bombe kannst du heruntergehen, aber nicht wieder darauf.</p>
      <h3>Items</h3>
      <p>Versteckt unter weichen Blöcken:
        <b>Bombe+</b> (eine Bombe mehr gleichzeitig), <b>Feuer+</b> (längere Flammen), <b>Rollschuh</b> (schneller),
        <b>Kick</b> (Bomben wegkicken, indem du hineinläufst), <b>Fernzünder</b> (Bomben warten auf B), <b>Volles Feuer</b> (maximale Flammen),
        <b>Box-Handschuh</b> (B boxt die Bombe vor dir 3 Felder weit, auch über Mauern), <b>Wurf-Handschuh</b> (B auf deiner Bombe hebt sie hoch, nochmal B wirft sie 3 Felder weit; wer getroffen wird, ist kurz benommen)
        und der <b>Totenkopf</b>: ein zufälliger Fluch für 10 Sekunden, der auf jeden überspringt, den du berührst.
        Flammen zerstören herumliegende Items.</p>
      <h3>Beeil dich</h3>
      <p>Nach zwei Minuten fallen von außen nach innen Blöcke herab. Lass dich nicht zerquetschen. Gehen die letzten Spieler gemeinsam drauf, ist die Runde unentschieden.</p>`,
  },
});
