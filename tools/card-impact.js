'use strict';
// Quanto pesa ogni carta di un mazzo: il mazzo contro tutti gli altri (giocatori "avidi"), e per ogni carta si confronta la percentuale di vittorie delle partite in cui
// la carta è stata giocata con quelle in cui è rimasta nel mazzo (ogni giocatore ne gioca 10 su 15). È una misura approssimativa: serve per le differenze grandi.
// Uso: node tools/card-impact.js <id del mazzo> [partite per avversario, predefinito 2000]
const E = require('../engine.js');
const {DECKS, CARDS} = E;
const {seeded, choose} = require('./greedy.js');
const ID = process.argv[2], N = +process.argv[3] || 2000;
if(!DECKS[ID]) throw new Error('uso: node tools/card-impact.js <id mazzo> [partite]; mazzi: ' + Object.keys(DECKS).join(', '));

function play(order, seed){
  const r = seeded(seed); E.setRng(r);
  const st = E.newGame(order);
  let guard = 0;
  while(st.status !== 'over' && guard++ < 400){ const mv = choose(st, r); if(!E.applyMove(st, E.actingSeat(st), mv)) throw new Error('mossa rifiutata'); }
  return st;
}
const stat = Object.fromEntries(DECKS[ID].cards.map(k => [k, {pw: 0, p: 0, nw: 0, n: 0}]));
let games = 0, wins = 0;
const others = Object.keys(DECKS).filter(d => d !== ID);
for(const o of others) for(let n = 0; n < N; n++){
  const swap = n % 2 === 1, order = swap ? [o, ID] : [ID, o], seat = swap ? 1 : 0;
  const st = play(order, 7700000 + others.indexOf(o) * 100000 + n);
  const left = new Set([...st.piles[seat], ...st.hands[seat]]);   // le carte non giocate (restate nel mazzo o in mano)
  const won = st.result.winner === seat ? 1 : 0;
  games++; wins += won;
  for(const k of DECKS[ID].cards){ const s = stat[k]; if(left.has(k)){ s.n++; s.nw += won; } else { s.p++; s.pw += won; } }
}
console.log(`${DECKS[ID].name} contro tutti gli altri mazzi: ${(100 * wins / games).toFixed(1)}% di vittorie su ${games} partite\n`);
console.log('Effetto di ogni carta: % di vittorie quando è giocata meno quando non lo è (punti; errore tipico ≈ ±' + (100 * Math.sqrt(.25 / (games * 2 / 3) + .25 / (games / 3))).toFixed(1) + ')');
const rows = DECKS[ID].cards.map(k => { const s = stat[k]; return {k, d: 100 * (s.pw / s.p - s.nw / s.n), c: CARDS[k]}; }).sort((a, b) => b.d - a.d);
for(const {k, d, c} of rows) console.log(`  ${(d >= 0 ? '+' : '') + d.toFixed(1)}`.padStart(7) + `  L${c.l} ATK ${String(c.a).padEnd(4)} ${c.at.padEnd(8)} ${c.ar.join('/').padEnd(14)} ${c.n}`);
