// Link Grid — intelligenza artificiale: sceglie la mossa del giocatore che deve agire, lavorando sullo stato del motore (engine.js) senza modificarlo.
// Pura, come il motore: niente DOM né rete. Nel browser è uno script classico (carica dopo engine.js, le sue funzioni diventano globali); in Node si carica con require().
// Livelli: "facile" gioca a caso (mosse valide); "normale" sceglie la mossa che massimizza subito la differenza di mostri controllati (nel setup, a caso);
// "difficile" guarda anche una mossa avanti: tra le migliori mosse sceglie quella dopo la quale la risposta migliore dell'avversario gli lascia più mostri.
const AI_ENGINE = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : globalThis;
const AI_LEVELS = {facile:'Facile', normale:'Normale', difficile:'Difficile'};
const AI_DEFAULT_LEVEL = 'normale';

// differenza di mostri controllati tra seat e l'avversario
function aiMargin(st, seat){ const sc = AI_ENGINE.score(st); return sc[seat] - sc[1 - seat]; }
function aiFreeCells(st){ const out = []; for(let i = 0; i < 25; i++) if(st.board[i] === null) out.push(i); return out; }
// r è un generatore di numeri in [0,1): Math.random nel gioco, uno ripetibile nei test
function aiPick(list, r){ return list[Math.floor(r() * list.length)]; }

function aiSetupMove(st, r){	// scelta dopo un 6 nella preparazione: una delle opzioni libere, a caso
  const ks = AI_ENGINE.setupOptions(st).map((ok, i) => ok ? i + 1 : 0).filter(Boolean);
  return ks.length ? {t:'setup', k: aiPick(ks, r)} : null;
}
function aiRandomMove(st, r){
  if(st.pending) return {t:'target', i: aiPick(st.pending.t, r)};
  const free = aiFreeCells(st), hand = st.hands[st.turn];
  return free.length && hand.length ? {t:'place', hi: Math.floor(r() * hand.length), i: aiPick(free, r)} : null;
}
function aiGreedyMove(st, r){
  const seat = st.turn;
  let best = null, bv = -1e9;
  const consider = (mv, v) => { v += r() * 0.1; if(v > bv){ bv = v; best = mv; } };	// (a parità di valore, a caso)
  if(st.pending){
    for(const i of st.pending.t){ const c = structuredClone(st); AI_ENGINE.applyMove(c, seat, {t:'target', i}); consider({t:'target', i}, aiMargin(c, seat)); }
    return best;
  }
  const free = aiFreeCells(st);
  for(let hi = 0; hi < st.hands[seat].length; hi++) for(const i of free){
    const c = structuredClone(st); AI_ENGINE.applyMove(c, seat, {t:'place', hi, i});
    let v;
    if(c.pending){	// la carta ha più bersagli: si valuta il migliore (lo sceglierà poi l'IA stessa)
      v = -1e9;
      for(const t of c.pending.t){ const d = structuredClone(c); AI_ENGINE.applyMove(d, seat, {t:'target', i: t}); v = Math.max(v, aiMargin(d, seat)); }
    } else v = aiMargin(c, seat);
    consider({t:'place', hi, i}, v);
  }
  return best;
}
// Livello difficile: valore di uno stato dopo la mossa di `seat`, cioè la differenza di mostri (per seat) dopo la MIGLIORE risposta dell'avversario
// (che sceglie, tra tutte le sue mosse, quella che la peggiora di più; se ha più bersagli sceglie il migliore per lui)
function aiAfterReply(st, seat){
  if(st.status !== 'play' || st.turn === seat) return aiMargin(st, seat);
  const opp = st.turn, hand = st.hands[opp], free = aiFreeCells(st);
  if(!hand.length || !free.length) return aiMargin(st, seat);
  let worst = 1e9;
  for(let hi = 0; hi < hand.length; hi++) for(const i of free){
    const c = structuredClone(st); AI_ENGINE.applyMove(c, opp, {t:'place', hi, i});
    let v;
    if(c.pending){ v = 1e9; for(const t of c.pending.t){ const d = structuredClone(c); AI_ENGINE.applyMove(d, opp, {t:'target', i: t}); v = Math.min(v, aiMargin(d, seat)); } }
    else v = aiMargin(c, seat);
    if(v < worst) worst = v;
  }
  return worst;
}
const AI_BEAM = 14;	// quante mosse (le migliori a una mossa di distanza) si valutano a fondo: tiene la risposta sotto qualche decina di millisecondi
function aiHardMove(st, r){
  const seat = st.turn;
  if(st.pending){	// scelta del bersaglio: si valuta ogni bersaglio con la risposta dell'avversario
    let best = null, bv = -1e9;
    for(const i of st.pending.t){ const c = structuredClone(st); AI_ENGINE.applyMove(c, seat, {t:'target', i}); const v = aiAfterReply(c, seat) + aiMargin(c, seat) * 0.01 + r() * 0.001; if(v > bv){ bv = v; best = {t:'target', i}; } }
    return best;
  }
  const free = aiFreeCells(st), cands = [];
  for(let hi = 0; hi < st.hands[seat].length; hi++) for(const i of free){
    const c = structuredClone(st); AI_ENGINE.applyMove(c, seat, {t:'place', hi, i});
    let v1 = c.pending ? -1e9 : aiMargin(c, seat);
    if(c.pending) for(const t of c.pending.t){ const d = structuredClone(c); AI_ENGINE.applyMove(d, seat, {t:'target', i: t}); v1 = Math.max(v1, aiMargin(d, seat)); }
    cands.push({mv:{t:'place', hi, i}, c, v1: v1 + r() * 0.1});
  }
  cands.sort((a, b) => b.v1 - a.v1);
  let best = null, bv = -1e9;
  for(const k of cands.slice(0, AI_BEAM)){
    let v;
    if(k.c.pending){ v = -1e9; for(const t of k.c.pending.t){ const d = structuredClone(k.c); AI_ENGINE.applyMove(d, seat, {t:'target', i: t}); v = Math.max(v, aiAfterReply(d, seat)); } }
    else v = aiAfterReply(k.c, seat);
    v += aiMargin(k.c, seat) * 0.01 + r() * 0.001;	// (a parità, meglio chi ha più mostri subito)
    if(v > bv){ bv = v; best = k.mv; }
  }
  return best;
}
// La mossa del giocatore che deve agire (AI_ENGINE.actingSeat(st)), o null se non c'è nulla da fare
function aiChoose(st, level = AI_DEFAULT_LEVEL, r = Math.random){
  if(!st || (st.status !== 'play' && st.status !== 'setup')) return null;
  if(st.status === 'setup') return st.setup && st.setup.pending ? aiSetupMove(st, r) : null;
  if(level === 'facile') return aiRandomMove(st, r);
  return level === 'difficile' ? aiHardMove(st, r) : aiGreedyMove(st, r);
}

if(typeof module !== 'undefined' && module.exports){
	module.exports = {AI_LEVELS, AI_DEFAULT_LEVEL, aiMargin, aiChoose};
}
