'use strict';
// Test del motore di gioco (engine.js): regole, preparazione del campo, validazione delle mosse, testi del registro.
// Le carte usate nei test sono inventate (prefisso "t_"): così non dipendono dai dati reali dei mazzi.
// ATTENZIONE alle frecce: sono scritte nell'orientamento del CONTROLLORE. Un mostro del Giocatore 2 le ha ruotate di 180°: per puntare a sinistra
// (verso un attaccante a sinistra) deve avere la freccia R, per puntare in basso la freccia T.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const {CARDS, DECKS, BEATS, BONUS} = E;

// ---------- utilità ----------
function seeded(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// "dadi" pilotati: ogni valore v (1-6) diventa il numero casuale che fa uscire v
function dice(...vals){ let i = 0; return () => { if(i >= vals.length) throw new Error('dadi finiti'); return (vals[i++] - 0.5) / 6; }; }
function addCards(defs){ for(const [k, c] of Object.entries(defs)) CARDS['t_' + k] = Object.assign({l:1}, c); }
addCards({
  // frecce: R = destra, L = sinistra, T = su, B = giù (nell'orientamento del controllore); at = Attributo
  a:  {n:'A',  a:1000, at:'TERRA',    ar:['R']},          // del Giocatore 1: punta a destra
  b:  {n:'B',  a:1000, at:'TERRA',    ar:['T']},          // del Giocatore 2: T = punta in giù, non verso A (non può rispondere ad A). Se passa al Giocatore 1 punta in su.
  bR: {n:'BR', a:1500, at:'TERRA',    ar:['R','T']},      // del Giocatore 2: R = punta a sinistra, verso A (può rispondere ad A)
  c:  {n:'C',  a:2000, at:'ACQUA',    ar:['T']},          // del Giocatore 2: T = punta in giù, verso B (può rispondere a B che la attacca dall'alto in basso... da sotto)
  cl: {n:'Cl', a:500,  at:'ACQUA',    ar:['T']},
  d:  {n:'D',  a:900,  at:'TERRA',    ar:[]},
  fire:{n:'Fuoco', a:1000, at:'FUOCO', ar:['R']},
  wind:{n:'Vento', a:1400, at:'VENTO', ar:['R']},         // risponde a sinistra; Fuoco batte Vento: 1000+500 > 1400
  wind2:{n:'Vento2', a:1600, at:'VENTO', ar:['R']},
  two:{n:'Due', a:1000, at:'TERRA',   ar:['R','B']},      // più bersagli
});
// stato di gioco "pulito" con le carte indicate. board: {indice: [chiave, controllore]}; hands: [[chiavi],[chiavi]]
function game({board = {}, hands = [[], []], turn = 0, first = 0, blocked = []} = {}){
  E.setRng(seeded(7));
  const st = E.newGame(['alba', 'tramonto']);
  st.status = 'play'; st.turn = turn; st.first = first; st.pending = null; st.fx = null; st.sfx = null; st.result = null;
  st.setup = {n:5, last:null, pending:null}; st.log = []; st.logCount = 0;
  st.board = Array(25).fill(null);
  for(const i of blocked) st.board[i] = {x:1};
  for(const [i, [k, c]] of Object.entries(board)) st.board[+i] = {k:'t_' + k, o:c, c};
  st.hands = hands.map(h => h.map(k => 't_' + k)); st.piles = [[], []];
  return st;
}
const at = (r, c) => r * 5 + c;

// ---------- dati dei mazzi (quelli veri) ----------
test('mazzi: 15 carte distinte e tutte esistenti, struttura identica nei due mazzi Alba e Tramonto', () => {
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const stats = Object.entries(DECKS).filter(([name]) => ['alba', 'tramonto'].includes(name)).map(([name, d]) => {
    assert.equal(d.cards.length, 15, name + ': 15 carte');
    assert.equal(new Set(d.cards).size, 15, name + ': nessun doppione');
    for(const k of d.cards) assert.ok(CARDS[k], name + ': la carta ' + k + ' esiste');
    const links = {1:0, 2:0, 3:0, 4:0};
    for(const k of d.cards) links[CARDS[k].l]++;
    const arrows = {};
    for(const k of d.cards) for(const a of CARDS[k].ar) arrows[a] = (arrows[a] || 0) + 1;
    return {name, links, arrows, linkTotal: sum(d.cards, k => CARDS[k].l), arrowTotal: sum(d.cards, k => CARDS[k].ar.length),
      atk: sum(d.cards, k => CARDS[k].a), attrs: new Set(d.cards.map(k => CARDS[k].at))};
  });
  const [x, y] = stats;
  assert.deepEqual(x.links, {1:4, 2:5, 3:4, 4:2}, 'Link: 4 da 1, 5 da 2, 4 da 3, 2 da 4');
  assert.deepEqual(y.links, x.links);
  assert.equal(x.linkTotal, 34); assert.equal(y.linkTotal, 34);
  assert.equal(x.arrowTotal, 34); assert.equal(y.arrowTotal, 34);
  assert.deepEqual(x.arrows, y.arrows, 'stessa distribuzione delle frecce nei due mazzi');
  assert.equal(x.attrs.size, 6, 'tutti e sei gli Attributi (Alba)'); assert.equal(y.attrs.size, 6, 'tutti e sei gli Attributi (Tramonto)');
  assert.equal(x.atk, 27000); assert.equal(y.atk, 27250);
});
test('mazzi: tutti i mazzi hanno 15 carte esistenti e distinte, e nessuna carta è in due mazzi', () => {
  const seen = new Map();
  for(const [name, d] of Object.entries(DECKS)){
    assert.equal(d.cards.length, 15, name + ': 15 carte'); assert.equal(new Set(d.cards).size, 15, name + ': nessun doppione');
    for(const k of d.cards){ assert.ok(CARDS[k], name + ': la carta ' + k + ' esiste'); assert.ok(!seen.has(k), `${k} è sia in ${seen.get(k)} sia in ${name}`); seen.set(k, name); }
  }
  assert.equal(Object.keys(DECKS).length, 4); assert.equal(seen.size, Object.keys(CARDS).filter(k => !k.startsWith('t_')).length, 'ogni carta dei dati è in un mazzo (le "t_" sono carte inventate dei test)');
});
test('mazzi: Mezzogiorno è tutto Link 2 e 3; Mezzanotte punta sui Link alti e tappa i buchi con i Link 1; stesso Link totale di Alba e Tramonto', () => {
  const links = d => { const l = {1:0, 2:0, 3:0, 4:0}; for(const k of DECKS[d].cards) l[CARDS[k].l]++; return l; };
  assert.deepEqual(links('mezzogiorno'), {1:0, 2:11, 3:4, 4:0});
  assert.deepEqual(links('mezzanotte'), {1:8, 2:0, 3:2, 4:5});
  for(const d of Object.keys(DECKS)) assert.equal(DECKS[d].cards.reduce((s, k) => s + CARDS[k].l, 0), 34, d + ': Link totale 34');
});
test('ogni mostro ha tante frecce quanto il suo Link Rating', () => {
  for(const [k, c] of Object.entries(CARDS)) if(!k.startsWith('t_')) assert.equal(c.ar.length, c.l, c.n);
});
test('tabella degli Attributi: Fuoco>Vento>Terra>Acqua>Fuoco, Luce<>Oscurità', () => {
  assert.equal(BEATS.FUOCO, 'VENTO'); assert.equal(BEATS.VENTO, 'TERRA'); assert.equal(BEATS.TERRA, 'ACQUA'); assert.equal(BEATS.ACQUA, 'FUOCO');
  assert.equal(BEATS.LUCE, 'OSCURITA'); assert.equal(BEATS.OSCURITA, 'LUCE');
});

// ---------- geometria ----------
test('numerazione di righe e colonne: dipende da chi gioca per primo, ed è invertibile', () => {
  for(const first of [0, 1]){
    const st = {first};
    for(let k = 1; k <= 5; k++){
      assert.equal(E.colNum(st, E.colToC(st, k)), k);
      assert.equal(E.rowNum(st, E.rowToR(st, k)), k);
    }
  }
  assert.equal(E.colToC({first:0}, 1), 0); assert.equal(E.colToC({first:1}, 1), 4);
});
test('le frecce si leggono nell\'orientamento del controllore: per il Giocatore 2 sono ruotate di 180°', () => {
  const plain = v => v.map(p => p.map(x => x + 0));   // (evita -0)
  assert.deepEqual(plain(E.vecs('t_a', 0)), [[0, 1]]);
  assert.deepEqual(plain(E.vecs('t_a', 1)), [[0, -1]]);
});

// ---------- fase di cattura ----------
test('cattura senza risposta: il difensore passa subito al giocatore di turno', () => {
  const st = game({board:{[at(2,1)]:['b',1]}, hands:[['a'],[]]});
  assert.equal(E.Place(st, 0, at(2,0)), true);
  assert.equal(st.board[at(2,1)].c, 0, 'B è catturata');
  assert.equal(st.fx.attacks.length, 1);
  assert.deepEqual({flip: st.fx.attacks[0].flip, to: st.fx.attacks[0].to, clash: st.fx.attacks[0].clash}, {flip: at(2,1), to: 0, clash: false});
  assert.equal(st.turn, 1, 'il turno passa');
});
test('battaglia: vince l\'ATK maggiore, chi perde viene catturato dal controllore del vincitore', () => {
  // A (1000) attacca BR (1500, con freccia opposta): l'attaccante perde e passa all'avversario
  let st = game({board:{[at(2,1)]:['bR',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,0)].c, 1, 'A perde e passa al Giocatore 2');
  assert.equal(st.board[at(2,1)].c, 1);
  assert.equal(st.fx.attacks[0].flip, at(2,0)); assert.equal(st.fx.attacks[0].to, 1);
  // B2 con ATK minore: viene catturata
  CARDS.t_bR2 = {n:'BR2', l:1, a:800, at:'TERRA', ar:['R']};
  st = game({board:{[at(2,1)]:['bR2',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,1)].c, 0, 'BR2 (800) perde contro A (1000)');
});
test('pareggio in battaglia: non succede nulla e il turno finisce', () => {
  CARDS.t_bR3 = {n:'BR3', l:1, a:1000, at:'TERRA', ar:['R']};
  const st = game({board:{[at(2,1)]:['bR3',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,0)].c, 0); assert.equal(st.board[at(2,1)].c, 1);
  assert.equal(st.fx.attacks[0].flip, null);
  assert.equal(st.turn, 1);
});
test('vantaggio di Attributo: +500 ATK solo all\'attaccante', () => {
  // Fuoco (1000+500) batte Vento (1400)
  let st = game({board:{[at(2,1)]:['wind',1]}, hands:[['fire'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,1)].c, 0, 'con il bonus Fuoco vince');
  assert.deepEqual({from: st.fx.attacks[0].boost.from, to: st.fx.attacks[0].boost.to}, {from:1000, to:1500});
  // il difensore Fuoco contro attaccante Vento: nessun bonus per il difensore (Vento 1400 batte Fuoco 1000)
  CARDS.t_windA = {n:'VentoA', l:1, a:1400, at:'VENTO', ar:['R']};
  CARDS.t_fireD = {n:'FuocoD', l:1, a:1000, at:'FUOCO', ar:['R']};
  st = game({board:{[at(2,1)]:['fireD',1]}, hands:[['windA'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,1)].c, 0, 'il bonus non vale per chi difende: Vento 1400 > Fuoco 1000');
  assert.equal(st.fx.attacks[0].boost, undefined, 'nessun potenziamento dove l\'attaccante non ha vantaggio');
  // senza vantaggio non c'è bonus
  st = game({board:{[at(2,1)]:['wind2',1]}, hands:[['fire'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,1)].c, 1, '1500 < 1600: Fuoco con bonus perde contro Vento2');
});
test('combo: la carta catturata attacca a sua volta, e solo il giocatore di turno fa combo', () => {
  // A cattura B; B (ora del Giocatore 1) punta in su e cattura C (senza risposta)
  CARDS.t_cTop = {n:'CTop', l:1, a:100, at:'TERRA', ar:[]};
  const st = game({board:{[at(2,1)]:['b',1], [at(1,1)]:['cTop',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.board[at(2,1)].c, 0); assert.equal(st.board[at(1,1)].c, 0, 'combo: anche C è catturata');
  assert.deepEqual(st.fx.attacks.map(x => x.flip), [at(2,1), at(1,1)]);
});
test('una carta può cambiare lato due volte nella stessa mossa (catturata, poi perde in battaglia)', () => {
  // A cattura B; B punta in su contro C, che ha la freccia opposta e ATK maggiore: B perde e torna al Giocatore 2
  const st = game({board:{[at(2,1)]:['b',1], [at(1,1)]:['c',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  const flipsB = st.fx.attacks.filter(x => x.flip === at(2,1));
  assert.equal(flipsB.length, 2, 'B cambia lato due volte');
  assert.deepEqual(flipsB.map(x => x.to), [0, 1], 'prima al Giocatore 1, poi di nuovo al 2');
  assert.equal(st.board[at(2,1)].c, 1);
  assert.equal(st.turn, 1, 'la combo finisce con la sconfitta');
});
test('più bersagli: si ferma e chiede di sceglierne uno solo', () => {
  CARDS.t_x1 = {n:'X1', l:1, a:100, at:'TERRA', ar:[]};
  CARDS.t_x2 = {n:'X2', l:1, a:100, at:'TERRA', ar:[]};
  const st = game({board:{[at(2,1)]:['x1',1], [at(3,0)]:['x2',1]}, hands:[['two'],[]]});
  E.Place(st, 0, at(2,0));
  assert.ok(st.pending, 'scelta in sospeso');
  assert.deepEqual([...st.pending.t].sort(), [at(2,1), at(3,0)].sort());
  assert.equal(st.turn, 0, 'il turno non è passato');
  assert.equal(E.chooseTarget(st, at(0,0)), false, 'una casella che non è un bersaglio viene rifiutata');
  assert.equal(E.chooseTarget(st, at(2,1)), true);
  assert.equal(st.board[at(2,1)].c, 0, 'solo il bersaglio scelto è attaccato');
  assert.equal(st.board[at(3,0)].c, 1, 'l\'altro non è più attaccabile da questa carta');
  assert.equal(st.pending, null);
});
test('Place rifiuta mosse non valide senza toccare lo stato', () => {
  const st = game({board:{[at(0,0)]:['d',1]}, hands:[['a'],[]], blocked:[at(4,4)]});
  const copy = JSON.stringify(st);
  assert.equal(E.Place(st, 0, at(0,0)), false, 'casella occupata');
  assert.equal(E.Place(st, 0, at(4,4)), false, 'casella bloccata');
  assert.equal(E.Place(st, 0, 99), false, 'casella fuori dalla griglia');
  assert.equal(E.Place(st, 0, -1), false);
  assert.equal(E.Place(st, 5, at(1,1)), false, 'carta che non è in mano');
  assert.equal(E.Place(st, -1, at(1,1)), false);
  assert.equal(JSON.stringify(st), copy, 'stato invariato');
});

// ---------- fine del turno e della partita ----------
test('a fine turno il turno passa, e chi ha finito la mano pesca 5 carte', () => {
  const st = game({board:{}, hands:[['a'],[]]});
  st.piles[1] = ['t_a','t_b','t_c','t_d','t_cl','t_fire','t_wind'];
  E.Place(st, 0, at(0,0));
  assert.equal(st.turn, 1);
  assert.equal(st.hands[1].length, 5, 'il Giocatore 2 pesca 5 carte');
  assert.equal(st.piles[1].length, 2);
});
test('fine partita: vince chi controlla più mostri; in parità vince chi ha giocato per primo', () => {
  // come nel gioco: 5 caselle bloccate e 20 carte. Le caselle 0-18 sono già piene, la 19 è l'ultima libera
  const blocked = [20, 21, 22, 23, 24];
  const filled = owners => { const board = {}; owners.forEach((o, i) => { board[i] = ['d', o]; }); return board; };
  const zeros = n => Array(n).fill(0), ones = n => Array(n).fill(1);
  // 10 contro 9: l'ultima carta del Giocatore 1 (senza frecce) porta 11 a 9
  let st = game({board: filled([...zeros(10), ...ones(9)]), blocked, hands:[['d'], []], turn:0, first:0});
  E.Place(st, 0, 19);
  assert.equal(st.status, 'over');
  assert.deepEqual({winner: st.result.winner, tie: st.result.tie, score: st.result.score}, {winner:0, tie:false, score:[11, 9]});
  assert.ok(st.log[0].includes('Fine partita'));
  // 9 contro 10: l'ultima carta del Giocatore 1 porta 10 a 10 -> parità, vince chi ha giocato per primo
  for(const first of [0, 1]){
    st = game({board: filled([...zeros(9), ...ones(10)]), blocked, hands:[['d'], []], turn:0, first});
    E.Place(st, 0, 19);
    assert.equal(st.status, 'over');
    assert.equal(st.result.tie, true);
    assert.deepEqual(st.result.score, [10, 10]);
    assert.equal(st.result.winner, first, 'parità: vince il Giocatore ' + (first + 1) + ', che ha giocato per primo');
    assert.ok(st.log[0].startsWith('Pareggio'));
  }
});

// ---------- preparazione del campo ----------
function setupGame(first = 0){
  E.setRng(seeded(3));
  const st = E.newGame(['alba', 'tramonto']);
  st.first = first; st.status = 'setup'; st.turn = 0; st.board = Array(25).fill(null); st.log = []; st.logCount = 0;
  st.setup = {n:0, last:null, pending:null}; st.sfx = {lc0:0, events:[]};
  return st;
}
test('preparazione: ogni lancio (colonna, riga) blocca lo spazio all\'incrocio, finché sono 5', () => {
  const st = setupGame(0);
  E.setRng(dice(1,1, 2,2, 3,3, 4,4, 5,5));
  E.advanceSetup(st);
  assert.equal(st.status, 'play'); assert.equal(st.turn, st.first);
  assert.equal(st.board.filter(x => x && x.x).length, 5);
  for(const k of [0, 6, 12, 18, 24]) assert.ok(st.board[k] && st.board[k].x, 'bloccata la casella ' + k);
  assert.equal(st.sfx.events.length, 5);
  assert.ok(st.sfx.events.every(e => e.res === 'block'));
});
test('preparazione: se lo spazio è già bloccato si ritira', () => {
  const st = setupGame(0);
  E.setRng(dice(1,1, 1,1, 2,2, 3,3, 4,4, 5,5));
  E.advanceSetup(st);
  assert.equal(st.sfx.events[1].res, 'dup');
  assert.equal(st.board.filter(x => x && x.x).length, 5);
});
test('preparazione: la numerazione dipende da chi gioca per primo', () => {
  const st = setupGame(1);   // gioca per primo il Giocatore 2: colonne e righe sono numerate al contrario
  E.setRng(dice(1,1, 1,2, 1,3, 1,4, 1,5));
  E.advanceSetup(st);
  for(let r = 0; r < 5; r++) assert.ok(st.board[at(r, 4)].x, 'colonna 1 = ultima colonna, riga ' + (5 - r));
});
test('preparazione: un 6 sul dado della colonna -> sceglie la colonna il primo giocatore, tra gli spazi liberi', () => {
  const st = setupGame(0);
  E.setRng(dice(1,1, 6,3));   // blocca (col 1, riga 1); poi colonna = 6, riga = 3
  E.advanceSetup(st);
  assert.deepEqual({stage: st.setup.pending.stage, chooser: st.setup.pending.chooser, row: st.setup.pending.row}, {stage:'col', chooser:0, row:3});
  // colonna 1 della riga 3 è libera; blocchiamone una e verifichiamo che non sia selezionabile
  st.board[at(2, 4)] = {x:1};
  assert.deepEqual(E.setupOptions(st), [true, true, true, true, false]);
  assert.equal(E.chooseSetup(st, 5), false, 'spazio occupato: rifiutato');
  E.setRng(dice(2,2, 3,3, 4,4));
  assert.equal(E.chooseSetup(st, 2), true);
  assert.ok(st.board[at(2, 1)].x, 'bloccato lo spazio scelto');
});
test('preparazione: un 6 sul dado della riga -> sceglie la riga il secondo giocatore', () => {
  const st = setupGame(0);
  E.setRng(dice(2,6));
  E.advanceSetup(st);
  assert.deepEqual({stage: st.setup.pending.stage, chooser: st.setup.pending.chooser, col: st.setup.pending.col}, {stage:'row', chooser:1, col:2});
});
test('preparazione: doppio 6 -> prima la colonna (primo giocatore), poi la riga (secondo)', () => {
  const st = setupGame(0);
  E.setRng(dice(6,6));
  E.advanceSetup(st);
  assert.deepEqual({stage: st.setup.pending.stage, chooser: st.setup.pending.chooser, row: st.setup.pending.row}, {stage:'col', chooser:0, row:null});
  assert.equal(E.chooseSetup(st, 3), true);
  assert.deepEqual({stage: st.setup.pending.stage, chooser: st.setup.pending.chooser, col: st.setup.pending.col}, {stage:'row', chooser:1, col:3});
  assert.equal(st.board.filter(x => x && x.x).length, 0, 'finora nessuna casella bloccata');
  E.setRng(dice(1,1, 2,2, 3,3, 4,4));
  assert.equal(E.chooseSetup(st, 4), true);
  assert.ok(st.board[at(3, 2)].x, 'bloccato (colonna 3, riga 4)');
});
test('preparazione: ogni scelta dopo un 6 è registrata come evento "pick" per l\'animazione', () => {
  const st = setupGame(0);
  E.setRng(dice(6,2));
  E.advanceSetup(st);
  E.setRng(dice(1,1, 2,2, 3,3, 4,4));
  E.chooseSetup(st, 5);
  assert.equal(st.sfx.events[0].kind, 'pick');
  assert.equal(st.sfx.events[0].cell, at(1, 4));
});

// ---------- validazione delle mosse (applyMove) ----------
test('applyMove: solo il giocatore che deve agire può muovere', () => {
  const st = game({hands:[['a'], ['d']], turn:0});
  const copy = JSON.stringify(st);
  assert.equal(E.applyMove(st, 1, {t:'place', hi:0, i:12}), false, 'non è il turno del Giocatore 2');
  assert.equal(JSON.stringify(st), copy);
  assert.equal(E.applyMove(st, 0, {t:'place', hi:0, i:12}), true);
  assert.ok(st.board[12] && st.board[12].k === 't_a');
});
test('applyMove: mosse malformate o impossibili vengono rifiutate senza toccare lo stato', () => {
  const st = game({board:{[at(0,0)]:['d',1]}, hands:[['a'], []], blocked:[at(4,4)]});
  const copy = JSON.stringify(st);
  for(const mv of [null, undefined, 5, 'place', {}, {t:'boh'}, {t:'place'}, {t:'place', hi:'0', i:12}, {t:'place', hi:0, i:1.5}, {t:'place', hi:0, i:NaN},
                    {t:'place', hi:0, i:25}, {t:'place', hi:0, i:-1}, {t:'place', hi:0, i:99}, {t:'place', hi:0, i:at(0,0)}, {t:'place', hi:0, i:at(4,4)},
                    {t:'place', hi:1, i:12}, {t:'place', hi:-1, i:12}, {t:'target', i:3}, {t:'setup', k:2}]){
    assert.equal(E.applyMove(st, 0, mv), false, JSON.stringify(mv));
    assert.equal(JSON.stringify(st), copy, 'stato invariato dopo ' + JSON.stringify(mv));
  }
  for(const seat of [undefined, null, 2, -1, '0']) assert.equal(E.applyMove(st, seat, {t:'place', hi:0, i:12}), false, 'posto ' + seat);
});
test('applyMove: scelta del bersaglio solo se c\'è una scelta in sospeso e dal giocatore giusto', () => {
  CARDS.t_y1 = {n:'Y1', l:1, a:100, at:'TERRA', ar:[]};
  CARDS.t_y2 = {n:'Y2', l:1, a:100, at:'TERRA', ar:[]};
  const st = game({board:{[at(2,1)]:['y1',1], [at(3,0)]:['y2',1]}, hands:[['two'],[]]});
  assert.equal(E.applyMove(st, 0, {t:'target', i:at(2,1)}), false, 'nessuna scelta in sospeso');
  assert.equal(E.applyMove(st, 0, {t:'place', hi:0, i:at(2,0)}), true);
  assert.ok(st.pending);
  assert.equal(E.applyMove(st, 1, {t:'target', i:at(2,1)}), false, 'non è il suo turno');
  assert.equal(E.applyMove(st, 0, {t:'place', hi:0, i:at(1,1)}), false, 'con una scelta in sospeso non si può piazzare');
  assert.equal(E.applyMove(st, 0, {t:'target', i:at(4,4)}), false, 'non è un bersaglio');
  assert.equal(E.applyMove(st, 0, {t:'target', i:at(3,0)}), true);
});
test('applyMove: la scelta dopo un 6 spetta solo a chi deve scegliere', () => {
  const st = setupGame(0);
  E.setRng(dice(2,6));   // 6 sul dado della riga: sceglie il Giocatore 2
  E.advanceSetup(st);
  E.setRng(dice(1,1, 2,2, 3,3, 4,4, 5,5));   // lanci per completare la preparazione dopo la scelta
  assert.equal(E.applyMove(st, 0, {t:'setup', k:2}), false, 'non spetta al Giocatore 1');
  assert.equal(E.applyMove(st, 1, {t:'setup', k:9}), false, 'numero fuori da 1-5');
  assert.equal(E.applyMove(st, 1, {t:'setup', k:'2'}), false);
  assert.equal(E.applyMove(st, 1, {t:'setup', k:2}), true);
});
test('actingSeat: chi deve agire nelle varie fasi', () => {
  assert.equal(E.actingSeat({status:'play', turn:1}), 1);
  assert.equal(E.actingSeat({status:'setup', setup:{pending:{chooser:0}}}), 0);
  assert.equal(E.actingSeat({status:'setup', setup:{pending:null}}), null);
  assert.equal(E.actingSeat({status:'lobby'}), null);
  assert.equal(E.actingSeat({status:'over'}), null);
  assert.equal(E.actingSeat(null), null);
});

// ---------- partite complete a caso (proprietà che devono valere sempre) ----------
test('partite casuali: le carte si conservano e la partita finisce sempre con 20 carte in campo', () => {
  for(let seed = 1; seed <= 40; seed++){
    E.setRng(seeded(seed));
    const rnd = n => Math.floor(E.d6() * 10 + seed) % n;   // casualità riproducibile dal motore stesso
    const st = E.newGame(['alba', 'tramonto']);
    // conclude la preparazione facendo le scelte necessarie
    let guard = 0;
    while(st.status === 'setup' && guard++ < 50){
      const seat = E.actingSeat(st); assert.notEqual(seat, null);
      const opts = E.setupOptions(st).map((ok, i) => ok ? i + 1 : 0).filter(Boolean);
      assert.ok(opts.length > 0);
      assert.equal(E.applyMove(st, seat, {t:'setup', k: opts[rnd(opts.length)]}), true);
    }
    assert.equal(st.status, 'play', 'seed ' + seed);
    assert.equal(st.board.filter(x => x && x.x).length, 5);
    guard = 0;
    while(st.status === 'play' && guard++ < 100){
      const seat = E.actingSeat(st);
      if(st.pending){
        assert.equal(E.applyMove(st, seat, {t:'target', i: st.pending.t[rnd(st.pending.t.length)]}), true);
      } else {
        const free = st.board.map((x, i) => x === null ? i : -1).filter(i => i >= 0);
        assert.equal(E.applyMove(st, seat, {t:'place', hi: rnd(st.hands[seat].length), i: free[rnd(free.length)]}), true);
      }
      // invarianti a ogni passo
      for(const s of [0, 1]){
        const onBoard = st.board.filter(x => x && x.k && x.o === s).length;
        assert.equal(st.hands[s].length + st.piles[s].length + onBoard, 15, 'carte del giocatore ' + s + ' conservate (seed ' + seed + ')');
      }
      assert.equal(new Set(st.board.filter(x => x && x.k).map(x => x.k + ':' + x.o)).size, st.board.filter(x => x && x.k).length, 'nessuna carta duplicata in campo');
    }
    assert.equal(st.status, 'over', 'seed ' + seed);
    const sc = E.score(st);
    assert.equal(sc[0] + sc[1], 20);
    assert.ok(st.result.winner === (sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : st.first));
  }
});

// ---------- testi del registro ----------
test('formatLog: gli stessi messaggi letti da locale, dal posto 1, dal posto 2 e da uno spettatore', () => {
  const T = '{p0} {v0:vince|vinci} il lancio iniziale (6 contro 2) e {v0:gioca|giochi} per primo.';
  assert.equal(E.formatLog(T, {online:false, seat:null}), 'Giocatore 1 vince il lancio iniziale (6 contro 2) e gioca per primo.');
  assert.equal(E.formatLog(T, {online:true, seat:0}), 'Tu vinci il lancio iniziale (6 contro 2) e giochi per primo.');
  assert.equal(E.formatLog(T, {online:true, seat:1}), 'L’avversario vince il lancio iniziale (6 contro 2) e gioca per primo.');
  assert.equal(E.formatLog(T, undefined), 'Giocatore 1 vince il lancio iniziale (6 contro 2) e gioca per primo.');
});
test('formatLog: soggetto minuscolo a metà frase, complemento "a" + giocatore, nessun segnaposto', () => {
  assert.equal(E.formatLog('Campo pronto. {v0:Inizia|Inizi} {p0}.', {online:true, seat:0}), 'Campo pronto. Inizi tu.');
  assert.equal(E.formatLog('Campo pronto. {v0:Inizia|Inizi} {p0}.', {online:true, seat:1}), 'Campo pronto. Inizia l’avversario.');
  assert.equal(E.formatLog('Perde e passa {pa1}.', {online:true, seat:1}), 'Perde e passa a te.');
  assert.equal(E.formatLog('Perde e passa {pa1}.', {online:true, seat:0}), 'Perde e passa all’avversario.');
  assert.equal(E.formatLog('Perde e passa {pa1}.', {online:false}), 'Perde e passa a Giocatore 2.');
  assert.equal(E.formatLog('Riga vecchia: Giocatore 1 gioca Elphase.', {online:true, seat:0}), 'Riga vecchia: Giocatore 1 gioca Elphase.');
});
test('il registro prodotto dal motore usa segnaposto e si legge bene da entrambi i punti di vista', () => {
  const st = game({board:{[at(2,1)]:['b',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  const line = st.log.find(l => l.includes('gioca'));
  assert.match(line, /\{p0\}/);
  assert.equal(E.formatLog(line, {online:true, seat:0}), 'Tu giochi A.');
  assert.equal(E.formatLog(line, {online:true, seat:1}), 'L’avversario gioca A.');
});

// ---------- ultima mossa e anteprima ----------
test('ultima mossa: ricorda chi controllava le carte che hanno cambiato lato, e resta fino alla mossa successiva', () => {
  const st = game({board:{[at(2,1)]:['b',1]}, hands:[['a'],['b']]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.last.placed, at(2,0)); assert.deepEqual(st.last.from, {[at(2,1)]:1}, 'B era del Giocatore 2');
  assert.equal(st.board[at(2,1)].c, 0, 'ora è del Giocatore 1');
  E.Place(st, 0, at(4,4));   // mossa successiva (Giocatore 2): l'ultima mossa cambia
  assert.equal(st.last.placed, at(4,4)); assert.deepEqual(st.last.from, {});
});
test('ultima mossa: una carta che cambia lato due volte e torna com\'era non risulta cambiata (il "prima" è quello originale)', () => {
  const st = game({board:{[at(2,1)]:['b',1], [at(1,1)]:['c',1]}, hands:[['a'],[]]});
  E.Place(st, 0, at(2,0));
  assert.equal(st.last.from[at(2,1)], 1); assert.equal(st.board[at(2,1)].c, 1, 'stesso controllore di prima: nessun cambiamento netto');
});
test('anteprima: previewTargets elenca i mostri avversari che la carta attaccherebbe, senza toccare lo stato', () => {
  const st = game({board:{[at(2,1)]:['b',1], [at(2,2)]:['d',0]}, hands:[['a', 'two'],[]]});
  const before = JSON.stringify(st);
  assert.deepEqual(E.previewTargets(st, 0, 0, at(2,0)), [at(2,1)], 'A (freccia a destra) in (2,0) attacca B, non il proprio mostro più in là');
  assert.deepEqual(E.previewTargets(st, 0, 0, at(0,0)), [], 'in un altro spazio non attacca nulla');
  assert.deepEqual(E.previewTargets(st, 0, 1, at(1,1)), [at(2,1)], 'Due in (1,1): a destra (1,2) è vuoto, in giù ce B');
  assert.equal(JSON.stringify(st), before, 'lo stato non cambia');
});
test('anteprima: nessun risultato per mosse non valide (spazio occupato o bloccato, turno altrui, scelta in sospeso, indici fuori misura)', () => {
  const st = game({board:{[at(2,1)]:['b',1]}, hands:[['a'],['b']], blocked:[0]});
  assert.deepEqual(E.previewTargets(st, 0, 0, at(2,1)), [], 'spazio occupato');
  assert.deepEqual(E.previewTargets(st, 0, 0, 0), [], 'spazio bloccato');
  assert.deepEqual(E.previewTargets(st, 1, 0, at(2,0)), [], 'non è il turno del Giocatore 2');
  assert.deepEqual(E.previewTargets(st, 0, 5, at(2,0)), [], 'carta inesistente');
  assert.deepEqual(E.previewTargets(st, 0, 0, 99), [], 'spazio fuori dal campo');
  st.pending = {a:0, t:[1]}; assert.deepEqual(E.previewTargets(st, 0, 0, at(2,0)), [], 'c\'è una scelta in sospeso');
});

test('knownCards: riconosce gli stati che nominano carte sconosciute (salvataggi di prima del cambio di ID)', () => {
  const st = game({board:{[at(2,1)]:['b',1]}, hands:[['a'],['b']]});
  assert.equal(E.knownCards(st), true);
  const vecchio = JSON.parse(JSON.stringify(st)); vecchio.hands[0] = ['monk']; assert.equal(E.knownCards(vecchio), false, 'carta in mano con la vecchia chiave');
  const v2 = JSON.parse(JSON.stringify(st)); v2.board[at(2,1)].k = 'seaangel'; assert.equal(E.knownCards(v2), false, 'carta sul campo con la vecchia chiave');
  const v3 = JSON.parse(JSON.stringify(st)); v3.piles = [['monk'], []]; assert.equal(E.knownCards(v3), false, 'carta nella pescata');
  assert.equal(E.knownCards(null), false); assert.equal(E.knownCards({status:'lobby'}), true, 'sala di attesa: nessuna carta');
  assert.equal(E.knownCards(E.newGame(['alba', 'tramonto'])), true, 'una partita nuova usa gli ID dei dati');
});
