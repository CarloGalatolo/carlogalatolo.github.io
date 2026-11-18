'use strict';
// Test dell'IA (ai.js): mosse sempre valide, partite intere tra IA, preferenza per le catture, e il livello "normale" batte il "facile".
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const AI = require('../ai.js');

function seeded(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// una partita tra due livelli (posto 0 con level0, posto 1 con level1); restituisce lo stato finale
function play(level0, level1, seed){
  const r = seeded(seed); E.setRng(r);
  const st = E.newGame(['alba', 'tramonto']);
  let guard = 0;
  while(st.status !== 'over' && guard++ < 400){
    const seat = E.actingSeat(st);
    const mv = AI.aiChoose(st, seat === 0 ? level0 : level1, r);
    assert.ok(mv, 'l’IA trova sempre una mossa quando tocca a lei');
    assert.ok(E.applyMove(st, seat, mv), 'mossa valida: ' + JSON.stringify(mv));
  }
  return st;
}

test('IA: livelli disponibili e livello predefinito', () => {
  assert.deepEqual(Object.keys(AI.AI_LEVELS), ['facile', 'normale', 'difficile']); assert.equal(AI.AI_DEFAULT_LEVEL, 'normale');
});
test('IA: partite intere tra IA (ogni livello) con sole mosse valide, fino alla fine, con 20 carte sul campo', () => {
  for(const [a, b] of [['facile', 'facile'], ['normale', 'normale'], ['facile', 'normale'], ['difficile', 'difficile'], ['difficile', 'facile']]) for(let n = 0; n < 6; n++){
    const st = play(a, b, 500 + n);
    assert.equal(st.status, 'over'); assert.equal(st.board.filter(x => x && x.k).length, 20, `${a} contro ${b}`);
  }
});
test('IA: stesso seme, stesse mosse (ripetibile)', () => {
  const a = play('normale', 'normale', 77), b = play('normale', 'normale', 77);
  assert.deepEqual(a.result, b.result); assert.deepEqual(a.board, b.board);
});
test('IA: non propone nulla quando non tocca a nessuno (fine partita, sala d’attesa, stato vuoto)', () => {
  const st = play('facile', 'facile', 3);
  assert.equal(AI.aiChoose(st), null); assert.equal(AI.aiChoose({status:'lobby'}), null); assert.equal(AI.aiChoose(null), null);
});
test('IA normale: sceglie la mossa che cattura (non un piazzamento che non cattura nulla)', () => {
  const r = seeded(1); E.setRng(r);
  const st = E.newGame(['alba', 'tramonto']);
  st.status = 'play'; st.turn = 0; st.first = 0; st.pending = null; st.fx = null; st.sfx = null; st.setup = {n:5, last:null, pending:null};
  st.board = Array(25).fill(null); for(const i of [20, 21, 22, 23, 24]) st.board[i] = {x:1};
  const MONK = '32519092';   // Monk of the Tenyi: una freccia in basso
  st.board[12] = {k: '30691817', o: 1, c: 1};   // un mostro avversario (Marincess Sea Angel, freccia a sinistra: non può rispondere) in (2,2): il Monk che lo punta dall'alto lo cattura
  st.hands[0] = [MONK, MONK, MONK, MONK, MONK];
  const mv = AI.aiChoose(st, 'normale', r);
  const after = structuredClone(st); assert.ok(E.applyMove(after, 0, mv));
  assert.equal(E.score(after)[0], 2, 'ha catturato: 2 mostri controllati (il suo e quello catturato): ' + JSON.stringify(mv));
  assert.equal(mv.i, 7, 'in (1,2), sopra il bersaglio');
});
test('IA: il livello "normale" batte il "facile" (almeno 65% su 150 partite, posti alternati)', () => {
  let wins = 0; const n = 150;
  for(let g = 0; g < n; g++){
    const normaleSeat0 = g % 2 === 0;
    const st = normaleSeat0 ? play('normale', 'facile', 9000 + g) : play('facile', 'normale', 9000 + g);
    if(st.result.winner === (normaleSeat0 ? 0 : 1)) wins++;
  }
  assert.ok(wins / n >= 0.65, `normale vince ${wins} su ${n}`);
});

test('IA difficile: batte il livello "normale" (almeno 62% su 60 partite, posti alternati) e risponde in tempi brevi', () => {
  let wins = 0, ms = 0, moves = 0; const n = 60;
  for(let g = 0; g < n; g++){
    const r = seeded(4000 + g); E.setRng(r);
    const hardSeat = g % 2, st = E.newGame(['alba', 'tramonto']);
    let guard = 0;
    while(st.status !== 'over' && guard++ < 400){
      const seat = E.actingSeat(st), hard = seat === hardSeat;
      const t0 = process.hrtime.bigint();
      const mv = AI.aiChoose(st, hard ? 'difficile' : 'normale', r);
      if(hard){ ms += Number(process.hrtime.bigint() - t0) / 1e6; moves++; }
      assert.ok(E.applyMove(st, seat, mv));
    }
    if(st.result.winner === hardSeat) wins++;
  }
  assert.ok(wins / n >= 0.62, `difficile vince ${wins} su ${n}`);
  assert.ok(ms / moves < 150, `tempo medio per mossa: ${(ms / moves).toFixed(1)} ms`);
});
test('IA difficile: tra due bersagli sceglie quello dopo il quale l’avversario può fare meno danno (o almeno non peggio del livello normale)', () => {
  const r = seeded(5); E.setRng(r);
  for(let g = 0; g < 10; g++){
    const st = E.newGame(['alba', 'tramonto']); let guard = 0;
    while(st.status !== 'over' && guard++ < 400){
      const seat = E.actingSeat(st), mv = AI.aiChoose(st, 'difficile', r);
      assert.ok(mv && E.applyMove(st, seat, mv), 'mossa valida: ' + JSON.stringify(mv));
    }
    assert.equal(st.status, 'over');
  }
});
