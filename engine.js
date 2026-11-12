// Link Grid — motore di gioco: regole pure, senza interfaccia né rete. Lavora su uno stato JSON (vedi newGame) e non tocca mai il DOM.
// Nel browser è uno script classico (le funzioni diventano globali per net.js e graphics.js); in Node si carica con require() (vedi tests/).
// Dati di gioco: le carte (cards.json) e i mazzi (decks.json). In Node si leggono con require(); nel browser li legge loader.js prima di caricare gli script
// e li mette in GAME_DATA (un file JSON non si può caricare con un tag <script>).
const {cards: CARDS, decks: DECKS} = (typeof module !== 'undefined' && module.exports)
	? {cards: require('./cards.json'), decks: require('./decks.json')}
	: GAME_DATA;
const BEATS = {FUOCO:'VENTO',VENTO:'TERRA',TERRA:'ACQUA',ACQUA:'FUOCO',LUCE:'OSCURITA',OSCURITA:'LUCE'};
const ATTR_LABEL = {FUOCO:'FUOCO',ACQUA:'ACQUA',VENTO:'VENTO',TERRA:'TERRA',LUCE:'LUCE',OSCURITA:'OSCURITÀ'};
const DIRV = {T:[-1,0],B:[1,0],L:[0,-1],R:[0,1],TL:[-1,-1],TR:[-1,1],BL:[1,-1],BR:[1,1]};
const BONUS = 500;

// Generatore di numeri casuali: nei test si sostituisce (setRng) per avere partite ripetibili
let rng = Math.random;
function setRng(f){ rng = f || Math.random; }
function d6(){ return 1 + Math.floor(rng()*6); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function pName(s){ return 'Giocatore ' + (s+1); }
// Il registro è condiviso tra i due giocatori, ma ognuno deve leggerlo dal proprio punto di vista ("Tu vinci" / "L'avversario vince"): il motore scrive
// segnaposto e fmtMsg() li traduce al momento di mostrarli. {pN} = giocatore N come soggetto, {paN} = "a" + giocatore N, {vN:terza|seconda} = verbo
// coniugato per il giocatore N (terza persona, oppure seconda se è "tu").
const tp = n => `{p${n}}`, tpa = n => `{pa${n}}`, tv = (n, third, second) => `{v${n}:${third}|${second}}`;
function addLog(st, msg){ st.log.unshift(msg); if(st.log.length>60) st.log.length=60; st.logCount = (st.logCount||0) + 1; }	// logCount: righe scritte in totale (l'animazione dei dadi lo usa per tenere nascosto il registro "in anticipo")
function vecs(k, ctrl){ const m = ctrl===0 ? 1 : -1; return CARDS[k].ar.map(d=>[DIRV[d][0]*m, DIRV[d][1]*m]); }
function colToC(st,k){ return st.first===0 ? k-1 : 5-k; }
function rowToR(st,k){ return st.first===0 ? k-1 : 5-k; }
function colNum(st,c){ return st.first===0 ? c+1 : 5-c; }
function rowNum(st,r){ return st.first===0 ? r+1 : 5-r; }

function newGame(deckSel){
  const st = {status:'setup', decksel:deckSel.slice(), board:Array(25).fill(null), hands:[[],[]], piles:[[],[]],
    turn:0, first:0, firstRolls:[], setup:{n:0,last:null,pending:null}, pending:null, log:[], fx:null, result:null};
  for(const s of [0,1]){ st.piles[s] = shuffle(DECKS[deckSel[s]].cards.slice()); st.hands[s] = st.piles[s].splice(0,5); }
  let a,b; do { a=d6(); b=d6(); st.firstRolls.push([a,b]); } while(a===b);
  st.first = a>b ? 0 : 1;
  addLog(st, `${tp(st.first)} ${tv(st.first,'vince','vinci')} il lancio iniziale (${a} contro ${b}) e ${tv(st.first,'gioca','giochi')} per primo.`);
  st.sfx = {lc0:st.logCount, events:[]};	// registro dei lanci di preparazione (vedi advanceSetup), per l'animazione
  advanceSetup(st);
  return st;
}
function blockCell(st, r, c, cd, rd){
  st.board[r*5+c] = {x:1}; st.setup.n++;
  addLog(st, `Bloccato lo spazio in colonna ${cd}, riga ${rd} (${st.setup.n} di 5).`);
}
function advanceSetup(st){
  const S = st.setup; let guard = 0;
  // Ogni lancio viene registrato in st.sfx.events (d = dadi, res = block/dup/six, cell = casella bloccata, lc = righe di registro scritte fino a lì):
  // l'interfaccia li mostra uno alla volta, con l'animazione dei dadi, prima di bloccare la casella o chiedere la scelta.
  const E = st.sfx ? st.sfx.events : [];
  while(S.n < 5 && !S.pending && guard++ < 500){
    const cd = d6(), rd = d6(); S.last = [cd, rd];
    const ev = {kind:'roll', d:[cd,rd], res:'six', cell:null, lc:0}; E.push(ev);
    if(cd!==6 && rd!==6){
      const r=rowToR(st,rd), c=colToC(st,cd);
      if(st.board[r*5+c]){ addLog(st, `Colonna ${cd}, riga ${rd} è già bloccato: si ritira.`); ev.res='dup'; ev.lc=st.logCount; continue; }
      blockCell(st, r, c, cd, rd); ev.res='block'; ev.cell=r*5+c; ev.lc=st.logCount; continue;
    }
    const second = 1-st.first;
    if(cd===6 && rd!==6){ S.pending = {stage:'col', chooser:st.first, row:rd}; addLog(st, `Il dado della colonna fa 6: ${tp(st.first)} ${tv(st.first,'sceglie','scegli')} la colonna (riga ${rd}).`); }
    else if(rd===6 && cd!==6){ S.pending = {stage:'row', chooser:second, col:cd}; addLog(st, `Il dado della riga fa 6: ${tp(second)} ${tv(second,'sceglie','scegli')} la riga (colonna ${cd}).`); }
    else { S.pending = {stage:'col', chooser:st.first, row:null}; addLog(st, `Doppio 6: ${tp(st.first)} ${tv(st.first,'sceglie','scegli')} prima la colonna.`); }
    ev.lc = st.logCount;
  }
  if(S.n >= 5){ S.pending = null; st.status = 'play'; st.turn = st.first; addLog(st, `Campo pronto. ${tv(st.first,'Inizia','Inizi')} ${tp(st.first)}.`); }
}
function setupOptions(st){
  const p = st.setup.pending; if(!p) return [];
  const out = [];
  for(let k=1;k<=5;k++){
    let ok;
    if(p.stage==='col'){
      const c = colToC(st,k);
      if(p.row!=null) ok = !st.board[rowToR(st,p.row)*5+c];
      else ok = true;	// doppio 6: scelta della colonna libera (al massimo 4 spazi bloccati, nessuna colonna è piena)
    } else ok = !st.board[rowToR(st,k)*5+colToC(st,p.col)];
    out.push(ok);
  }
  return out;
}
function chooseSetup(st, k){
  const p = st.setup.pending; if(!p || !setupOptions(st)[k-1]) return false;
  st.sfx = {lc0:st.logCount||0, events:[]};	// nuovo gruppo di eventi da animare (la casella scelta e gli eventuali lanci successivi)
  if(p.stage==='col'){
    if(p.row==null){ st.setup.pending = {stage:'row', chooser:1-st.first, col:k}; addLog(st, `${tp(st.first)} ${tv(st.first,'sceglie','scegli')} la colonna ${k}. Ora ${tp(1-st.first)} ${tv(1-st.first,'sceglie','scegli')} la riga.`); return true; }
    const r = rowToR(st,p.row), c = colToC(st,k);
    blockCell(st, r, c, k, p.row); st.sfx.events.push({kind:'pick', cell:r*5+c, lc:st.logCount});
  } else {
    const r = rowToR(st,k), c = colToC(st,p.col);
    blockCell(st, r, c, p.col, k); st.sfx.events.push({kind:'pick', cell:r*5+c, lc:st.logCount});
  }
  st.setup.pending = null; advanceSetup(st); return true;
}
function targetsOf(st, i){
  const A = st.board[i]; const r = Math.floor(i/5), c = i%5; const out = [];
  for(const [dr,dc] of vecs(A.k, A.c)){
    const rr=r+dr, cc=c+dc; if(rr<0||rr>4||cc<0||cc>4) continue;
    const D = st.board[rr*5+cc];
    if(D && D.k && D.c!==A.c) out.push({i:rr*5+cc, dr, dc});
  }
  return out;
}

// Ricorda chi controllava la carta in `cell` prima della mossa in corso (solo la prima volta: se poi cambia lato di nuovo, il "prima" resta quello originale)
function noteFlip(st, cell, oldCtrl){ if(st.last && st.last.from[cell]===undefined) st.last.from[cell] = oldCtrl; }
// Anteprima: quali mostri avversari attaccherebbe la carta hi della mano di seat se venisse messa in i (stesse regole di targetsOf, senza modificare nulla)
function previewTargets(st, seat, hi, i){
  if(st.status!=='play' || st.pending || st.turn!==seat || !st.hands[seat] || hi<0 || hi>=st.hands[seat].length || i<0 || i>24 || st.board[i]!==null) return [];
  const r = Math.floor(i/5), c = i%5, out = [];
  for(const [dr,dc] of vecs(st.hands[seat][hi], seat)){
    const rr = r+dr, cc = c+dc; if(rr<0 || rr>4 || cc<0 || cc>4) continue;
    const D = st.board[rr*5+cc];
    if(D && D.k && D.c!==seat) out.push(rr*5+cc);
  }
  return out;
}
// Tutte le carte nominate dallo stato (mano, pescata, campo) esistono nei dati? Serve a scartare partite salvate o ricevute con un'altra versione dei dati
// (per esempio prima che le carte prendessero come ID il codice a 8 cifre), che altrimenti romperebbero il disegno del campo.
function knownCards(st){
  if(!st || typeof st!=='object') return false;
  const ok = k => !!CARDS[k];
  return ['hands', 'piles'].every(f => !st[f] || st[f].every(a => a.every(ok))) && (!st.board || st.board.every(x => !x || !x.k || ok(x.k)));
}
function Place(st, hi, i) {
	const s = st.turn;
	if(st.status!=='play' || st.pending || st.board[i]!==null || hi<0 || hi>=st.hands[s].length) return false;
	const k = st.hands[s].splice(hi,1)[0];
	st.board[i] = {k, o:s, c:s};
	st.fx = {placed:i, drop:true, attacks:[]};
	st.last = {placed:i, from:{}};	// ultima mossa: per ogni carta che ha cambiato lato, chi la controllava prima (vedi noteFlip); resta fino alla mossa successiva
	addLog(st, `${tp(s)} ${tv(s,'gioca','giochi')} ${CARDS[k].n}.`);
	runCapture(st, i); return true;
}

function runCapture(st, a){
  for(let g=0; g<50; g++){
    const t = targetsOf(st, a);
    if(!t.length) return endTurn(st);
    if(t.length>1){ st.pending = {a, t:t.map(x=>x.i)}; return; }
    a = ResolveAttack(st, a, t[0]);
    if(a<0) return endTurn(st);
  }
  endTurn(st);
}
function chooseTarget(st, ti){
  const p = st.pending; if(!p) return false;
  const t = targetsOf(st, p.a).find(x=>x.i===ti); if(!t) return false;
  st.pending = null;
  // nuova tranche di animazioni: gli attacchi già mostrati prima della scelta non devono ripetersi (né il drop)
  st.fx = {placed: st.fx ? st.fx.placed : null, drop:false, attacks:[]};
  const n = ResolveAttack(st, p.a, t);
  if(n<0) endTurn(st); else runCapture(st, n);
  return true;
}

function ResolveAttack(st, a, t){
	const A = st.board[a], D = st.board[t.i], s = st.turn;
	const an = CARDS[A.k].n, dn = CARDS[D.k].n;
	const back = vecs(D.k, D.c).some(v=>v[0]===-t.dr && v[1]===-t.dc);
	// attacco per l'animazione: clash = il difensore risponde (scontro); flip = carta che cambia controllore (null se pareggio), to = nuovo controllore.
	// Una stessa carta può cambiare lato due volte nella stessa mossa (catturata, poi attaccante che perde): per questo ogni cambio è registrato qui.
	const at = {a, d:t.i, clash:back, flip:null, to:null};
	st.fx.attacks.push(at);
	if(!back){ noteFlip(st, t.i, D.c); D.c = s; at.flip = t.i; at.to = s; addLog(st, `${an} punta ${dn}, che non può rispondere: catturato.`); return t.i; }
	const bonus = BEATS[CARDS[A.k].at]===CARDS[D.k].at ? BONUS : 0;
	const av = CARDS[A.k].a + bonus, dv = CARDS[D.k].a;
	if(bonus) at.boost = {from:CARDS[A.k].a, to:av};	// vantaggio di Attributo: per l'animazione, l'ATK dell'attaccante sale prima dello scontro
	const atkTxt = bonus ? `${CARDS[A.k].a}+${bonus}` : `${av}`;
	if(av>dv){ noteFlip(st, t.i, D.c); D.c = s; at.flip = t.i; at.to = s; addLog(st, `Battaglia: ${an} (${atkTxt}) batte ${dn} (${dv}). Catturato.`); return t.i; }
	if(av<dv){ noteFlip(st, a, A.c); A.c = 1-s; at.flip = a; at.to = 1-s; addLog(st, `Battaglia: ${an} (${atkTxt}) perde contro ${dn} (${dv}) e passa ${tpa(1-s)}.`); return -1; }
	addLog(st, `Battaglia: ${an} e ${dn} pareggiano (${dv}). Nessuna cattura.`); return -1;
}

function score(st){ const sc=[0,0]; for(const x of st.board) if(x && x.k) sc[x.c]++; return sc; }
function endTurn(st){
  st.pending = null; const s = st.turn;
  if(!st.board.some(x=>x===null)){
    const sc = score(st); const w = sc[0]>sc[1] ? 0 : sc[1]>sc[0] ? 1 : st.first;
    st.status = 'over'; st.result = {score:sc, winner:w, tie: sc[0]===sc[1]};
    addLog(st, sc[0]===sc[1] ? `Pareggio ${sc[0]} a ${sc[1]}: ${tv(w,'vince','vinci')} ${tp(w)}, ${tv(w,'che ha','che hai')} giocato per primo.` : `Fine partita: ${tv(w,'vince','vinci')} ${tp(w)}, ${Math.max(...sc)} a ${Math.min(...sc)}.`);
    return;
  }
  st.turn = 1-s;
  const n = st.turn;
  if(!st.hands[n].length && st.piles[n].length){ st.hands[n] = st.piles[n].splice(0,5); addLog(st, `${tp(n)} ${tv(n,'ha finito','hai finito')} la mano e ${tv(n,'pesca','peschi')} 5 carte.`); }
}

// ---------- mosse ----------
// Posto che deve agire adesso: chi ha il turno, oppure chi deve scegliere riga/colonna dopo un 6 nella preparazione (null: sala d'attesa, partita finita)
function actingSeat(st){
  if(!st) return null;
  if(st.status==='setup' && st.setup && st.setup.pending) return st.setup.pending.chooser;
  if(st.status==='play') return st.turn;
  return null;
}
const isIdx = n => Number.isInteger(n);
// L'unico punto da cui interfaccia e rete modificano la partita: controlla che la mossa sia legale per quel posto e la applica.
// Mosse: {t:'place', hi, i} (carta della mano, casella) · {t:'target', i} (bersaglio da attaccare) · {t:'setup', k} (riga o colonna scelta dopo un 6).
// Restituisce false, senza toccare lo stato, se non è valida: l'host usa questo controllo per le mosse dell'ospite, che non manda mai uno stato.
function applyMove(st, seat, mv){
  if(!st || !mv || typeof mv!=='object' || (seat!==0 && seat!==1) || actingSeat(st)!==seat) return false;
  if(mv.t==='place')  return st.status==='play' && !st.pending && isIdx(mv.hi) && isIdx(mv.i) && mv.i>=0 && mv.i<25 && Place(st, mv.hi, mv.i)===true;
  if(mv.t==='target') return st.status==='play' && !!st.pending && isIdx(mv.i) && chooseTarget(st, mv.i)===true;
  if(mv.t==='setup')  return st.status==='setup' && isIdx(mv.k) && chooseSetup(st, mv.k)===true;
  return false;
}

// ---------- testi del registro ----------
// Come si chiama un giocatore nei messaggi. view = {online, seat}: in una partita online "tu" / "l’avversario" (cap = a inizio frase), altrimenti "Giocatore N".
function whoName(s, cap, view){
  if(!view || !view.online) return pName(s);
  return s===view.seat ? (cap ? 'Tu' : 'tu') : (cap ? 'L’avversario' : 'l’avversario');
}
// Traduce i segnaposto del registro (tp/tpa/tv) per chi guarda; i messaggi senza segnaposto (vecchie partite salvate) restano com'erano
function formatLog(m, view){
  const on = !!(view && view.online);
  return String(m).replace(/\{(pa|p|v)([01])(?::([^}|]*)\|([^}]*))?\}/g, (all, kind, n, third, second, off)=>{
    n = +n; const me = on && n===view.seat;
    if(kind==='v') return me ? second : third;
    if(kind==='pa') return !on ? 'a ' + pName(n) : me ? 'a te' : 'all’avversario';
    const start = off===0 || /[.!?]\s$/.test(String(m).slice(0, off));
    return whoName(n, start, view);
  });
}

if(typeof module !== 'undefined' && module.exports){
	module.exports = {CARDS, DECKS, BEATS, ATTR_LABEL, DIRV, BONUS, setRng, d6, shuffle, pName, addLog, tp, tpa, tv, vecs, colToC, rowToR, colNum, rowNum,
		newGame, blockCell, advanceSetup, setupOptions, chooseSetup, targetsOf, Place, runCapture, chooseTarget, ResolveAttack, score, endTurn, previewTargets, knownCards,
		actingSeat, applyMove, whoName, formatLog};
}
