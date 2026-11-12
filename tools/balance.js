'use strict';
// Bilanciamento dei mazzi: ogni mazzo contro ogni altro, con giocatori "avidi" (scelgono la mossa che massimizza subito la differenza di mostri controllati;
// nella preparazione, le scelte dopo un 6 sono casuali). Il primo giocatore lo decide il dado, i posti si alternano.
// Uso: node tools/balance.js [partite per coppia, predefinito 1000] [id di un mazzo: si valuta solo quel mazzo contro gli altri] [--variant=file.json]
// --variant: file JSON con "cards" e/o "decks" che si aggiungono ai dati in memoria prima della prova (per provare un mazzo modificato senza toccare cards.json e decks.json).
const E = require('../engine.js');
const {DECKS} = E;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const variant = (process.argv.find(a => a.startsWith('--variant=')) || '').slice('--variant='.length);
if(variant){ const v = JSON.parse(require('node:fs').readFileSync(variant, 'utf8')); Object.assign(E.CARDS, v.cards || {}); Object.assign(E.DECKS, v.decks || {}); }
const N = +args[0] || 1000;
const ONLY = args[1];
if(ONLY && !DECKS[ONLY]) throw new Error('mazzo sconosciuto: ' + ONLY + ' (mazzi: ' + Object.keys(DECKS).join(', ') + ')');

const {seeded, margin, choose} = require('./greedy.js');
function play(order, seed){
  const r = seeded(seed); E.setRng(r);
  const st = E.newGame(order);
  let guard = 0;
  while(st.status !== 'over' && guard++ < 400){ const mv = choose(st, r); if(!E.applyMove(st, E.actingSeat(st), mv)) throw new Error('mossa rifiutata'); }
  return {winner: st.result.winner, first: st.first, tie: st.result.tie, score: st.result.score};
}

const ids = Object.keys(DECKS);
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
const se = (p, n) => (100 * Math.sqrt(p * (1 - p) / n)).toFixed(1);   // errore standard in punti percentuali
const total = Object.fromEntries(ids.map(i => [i, {w: 0, n: 0}]));
let allFirst = 0, allN = 0, allTies = 0;
console.log(`${N} partite per coppia di mazzi, giocatori avidi, posti alternati (il primo lo decide il dado)\n`);
for(let a = 0; a < ids.length; a++) for(let b = a + 1; b < ids.length; b++){
  if(ONLY && ids[a] !== ONLY && ids[b] !== ONLY) continue;
  let wa = 0, firstWins = 0, ties = 0, scoreDiff = 0;
  for(let n = 0; n < N; n++){
    const swap = n % 2 === 1;
    const order = swap ? [ids[b], ids[a]] : [ids[a], ids[b]];
    const g = play(order, 100000 * (a * ids.length + b) + n);
    const aSeat = swap ? 1 : 0;
    if(g.winner === aSeat) wa++;
    if(g.winner === g.first) firstWins++;
    if(g.tie) ties++;
    scoreDiff += g.score[aSeat] - g.score[1 - aSeat];
  }
  total[ids[a]].w += wa; total[ids[a]].n += N; total[ids[b]].w += N - wa; total[ids[b]].n += N;
  allFirst += firstWins; allN += N; allTies += ties;
  const p = wa / N;
  console.log(`${DECKS[ids[a]].name.padEnd(12)} contro ${DECKS[ids[b]].name.padEnd(12)}: ${DECKS[ids[a]].name} vince ${pct(wa, N)} (±${se(p, N)}), ${DECKS[ids[b]].name} ${pct(N - wa, N)}; scarto medio ${(scoreDiff / N).toFixed(2)} mostri; pareggi ${pct(ties, N)}; chi gioca per primo vince ${pct(firstWins, N)}`);
}
console.log('\nPercentuale di vittorie di ogni mazzo contro tutti gli altri:');
for(const i of ids) if(total[i].n) console.log(`  ${DECKS[i].name.padEnd(12)} ${pct(total[i].w, total[i].n)}  (±${se(total[i].w / total[i].n, total[i].n)})`);
console.log(`\nIn tutte le partite: chi gioca per primo vince ${pct(allFirst, allN)}; pareggi (risolti a favore del primo) ${pct(allTies, allN)}`);
