'use strict';
// Partite tra due livelli dell'IA (Alba contro Tramonto, posti e primo giocatore alternati dal dado): percentuale di vittorie di A e tempo medio per mossa di ognuno.
// Uso: node tools/ai-match.js <livello A> <livello B> [partite, predefinito 200]     (livelli: facile, normale, difficile)
const E = require('../engine.js');
const AI = require('../ai.js');
const {seeded} = require('./greedy.js');
const [A, B] = [process.argv[2], process.argv[3]];
const N = +process.argv[4] || 200;
if(!AI.AI_LEVELS[A] || !AI.AI_LEVELS[B]) throw new Error('uso: node tools/ai-match.js <livello A> <livello B> [partite]; livelli: ' + Object.keys(AI.AI_LEVELS).join(', '));

const time = {[A]: [0, 0], [B]: [0, 0]};   // [millisecondi, mosse]
let winsA = 0, ties = 0, firstWins = 0;
for(let n = 0; n < N; n++){
  const r = seeded(31000 + n); E.setRng(r);
  const aSeat = n % 2;   // A al posto 0 nelle partite pari, al 1 nelle dispari
  const st = E.newGame(['alba', 'tramonto']);
  let guard = 0;
  while(st.status !== 'over' && guard++ < 400){
    const seat = E.actingSeat(st), level = seat === aSeat ? A : B;
    const t0 = process.hrtime.bigint();
    const mv = AI.aiChoose(st, level, r);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    time[level][0] += ms; time[level][1]++;
    if(!E.applyMove(st, seat, mv)) throw new Error('mossa rifiutata: ' + JSON.stringify(mv));
  }
  if(st.result.winner === aSeat) winsA++;
  if(st.result.tie) ties++;
  if(st.result.winner === st.first) firstWins++;
}
const pct = x => (100 * x / N).toFixed(1) + '%';
console.log(`${AI.AI_LEVELS[A]} (A) contro ${AI.AI_LEVELS[B]} (B), ${N} partite: A vince ${pct(winsA)}, B ${pct(N - winsA)} (errore ±${(100 * Math.sqrt(.25 / N)).toFixed(1)}); pareggi ${pct(ties)}; chi gioca per primo vince ${pct(firstWins)}`);
for(const l of new Set([A, B])) console.log(`  tempo per mossa, ${AI.AI_LEVELS[l]}: ${(time[l][0] / time[l][1]).toFixed(1)} ms in media su ${time[l][1]} mosse`);
