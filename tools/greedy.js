'use strict';
// Il giocatore "avido" usato dagli strumenti di prova: sceglie la mossa che massimizza subito la differenza di mostri controllati
// (nella preparazione, le scelte dopo un 6 sono casuali). `r` è un generatore di numeri casuali in [0,1) (vedi seeded) usato per i pareggi tra mosse uguali.
const E = require('../engine.js');

function seeded(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const margin = (st, seat) => { const sc = E.score(st); return sc[seat] - sc[1 - seat]; };
function choose(st, r){
  if(st.status === 'setup'){ const ks = E.setupOptions(st).map((ok, i) => ok ? i + 1 : 0).filter(Boolean); return {t:'setup', k: ks[Math.floor(r() * ks.length)]}; }
  let best = null, bv = -1e9;
  if(st.pending){
    for(const i of st.pending.t){ const c = structuredClone(st); E.applyMove(c, st.turn, {t:'target', i}); const v = margin(c, st.turn) + r() * 0.1; if(v > bv){ bv = v; best = {t:'target', i}; } }
    return best;
  }
  const free = []; for(let i = 0; i < 25; i++) if(st.board[i] === null) free.push(i);
  for(let hi = 0; hi < st.hands[st.turn].length; hi++) for(const i of free){
    const c = structuredClone(st); E.applyMove(c, st.turn, {t:'place', hi, i});
    let v;
    if(c.pending){ v = -1e9; for(const t of c.pending.t){ const d = structuredClone(c); E.applyMove(d, st.turn, {t:'target', i: t}); v = Math.max(v, margin(d, st.turn)); } }
    else v = margin(c, st.turn);
    v += r() * 0.1;
    if(v > bv){ bv = v; best = {t:'place', hi, i}; }
  }
  return best;
}

module.exports = {seeded, margin, choose};
