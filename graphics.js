// Link Grid — interfaccia e applicazione: disegno, animazioni, eventi, partita locale. Il motore è in engine.js, la parte online in net.js.
// ---------- UI ----------
const $ = id => document.getElementById(id);
const ARROW_POLY = {
  T:'38,8 50,1 62,8', B:'38,92 50,99 62,92', L:'8,38 1,50 8,62', R:'92,38 99,50 92,62',
  TL:'2,16 2,2 16,2', TR:'84,2 98,2 98,16', BL:'2,84 2,98 16,98', BR:'98,84 98,98 84,98'
};
const ATTR_VAR = {FUOCO:'--fuoco',ACQUA:'--acqua',VENTO:'--vento',TERRA:'--terra',LUCE:'--luce',OSCURITA:'--oscurita'};
function esc(s){ return String(s).replace(/[&<>"]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

function cardHTML(k, ctrl, rot, extra=''){
  const C = CARDS[k];
  const polys = Object.keys(ARROW_POLY).map(d=>`<polygon points="${ARROW_POLY[d]}" class="${C.ar.includes(d)?'on':''}"/>`).join('');
  const cls = ctrl===0 ? 'c0' : ctrl===1 ? 'c1' : 'cn';
  const face = faceMode && mode==='local';   // modalità "carte verso chi le controlla"
  const turned = rot && face;
  return `<span class="card ${cls} ${turned?'turned':''} ${face?'face':''} ${extra}" data-k="${k}">`+
    `<svg viewBox="0 0 100 100" class="${rot&&!turned?'rot':''}" aria-hidden="true">${polys}</svg>`+
    `<span class="cbody"><span class="cname">${esc(C.n)}</span><span class="catk">${C.a}</span>`+
    `<span class="cmeta"><span class="adot" style="--ac:var(${ATTR_VAR[C.at]})" title="${ATTR_LABEL[C.at]}"></span><span>L${C.l}</span></span></span></span>`;
}
const DIR_IT = {T:'su',B:'giù',L:'sinistra',R:'destra',TL:'su a sinistra',TR:'su a destra',BL:'giù a sinistra',BR:'giù a destra'};
function cardLabel(k){ const C=CARDS[k]; return `${C.n}, ATK ${C.a}, Link ${C.l}, ${ATTR_LABEL[C.at]}, frecce ${C.ar.map(d=>DIR_IT[d]).join(', ')}`; }

// ---------- app state ----------
let mode = null;          // 'local' | 'online'
let state = null;
let localView = 0;
let faceMode = false;
let mySeat = null;
let selHand = null;
let inspected = null;
let animSeq = -1;
// Sequenza di animazione della mossa in corso (vedi "sequenza di animazione"): `fxView` = come si vede il tabellone in quel momento
// ({ctrl: controllore mostrato per le carte che cambiano lato, sel: i bersagli da scegliere sono già visibili}); null = stato reale.
let fxView = null, fxToken = 0, fxSeq = -1;
let flash = '';
// Animazione dei dadi di preparazione: finché `present` è attivo l'interfaccia mostra la preparazione "in differita" (caselle bloccate,
// registro e scelte compaiono solo dopo che il relativo lancio è stato mostrato) e nessuno può agire. Solo UI: non viene mai sincronizzato.
let present = null, presentTimer = 0, setupSeq = -1;

function viewSeat(){ return mode==='online' ? (mySeat ?? 0) : localView; }
function seatName(s){
  if(mode==='online'){ if(mySeat===null) return pName(s); return s===mySeat ? 'Tu' : 'Avversario'; }
  return pName(s);
}
// Come si chiama un giocatore nei messaggi, dal punto di vista di chi guarda (le funzioni pure sono nel motore: whoName, formatLog)
const viewOf = () => ({online: mode==='online' && mySeat!==null, seat: mySeat});
function who(s, cap){ return whoName(s, cap, viewOf()); }
function fmtMsg(m){ return formatLog(m, viewOf()); }
function canAct(seat){ return !present && (mode==='local' || mySeat===seat); }
// Vero mentre i dadi di preparazione girano o la sequenza di animazione di una mossa è in corso: i click su carte e caselle vengono ignorati.
function isBusy(){ return !!(present || fxView || online.awaiting); }
function deckOf(s){ return state.decksel ? state.decksel[s] : state.players?.['s'+s]?.deck; }

// ---------- commit ----------
function commit(fn){
  if(!state) return;
  if(!guardOnlineAction()) return;
  const st = structuredClone(state);
  st.sfx = null;	// gli eventi da animare valgono solo per la mossa che li ha prodotti
  if(fn(st)===false) return;
  st.seq = (state.seq||0) + 1;
  state = st; selHand = null;
  render();
  if(mode==='online') pushOnline(st);
}
// Unico punto da cui l'interfaccia compie una mossa. In locale o da host la applica il motore (applyMove la valida);
// l'ospite online manda solo la mossa all'host, che la calcola e rimanda lo stato.
function act(move){
  if(!state) return;
  if(mode==='online' && !online.host){ sendMove(move); return; }
  const seat = mode==='online' ? mySeat : actingSeat(state);
  commit(st=>applyMove(st, seat, move));
}
// ---------- animazione dei dadi di preparazione ----------
const DIE_ROLL_MS = [500, 500];	// quanto girano il dado della colonna e quello della riga (stesso valore = si fermano insieme; valori diversi = uno dopo l'altro)
const DIE_HOLD_MS = {block:450, dup:500, pick:350};	// pausa dopo il risultato, prima del lancio successivo (con un 6 non c'è: la scelta compare subito)
function cancelPresent(){ clearTimeout(presentTimer); present = null; }
function startPresent(st){
  cancelPresent();
  const evs = (st.sfx && st.sfx.events) || [];
  if(!evs.length) return;	// niente da animare (es. scelta della sola colonna)
  present = {seq:st.seq, evs, i:-1, lc:st.sfx.lc0||0, face:null, rolling:[false,false], fresh:null,
    hidden:new Set(evs.filter(e=>e.cell!=null).map(e=>e.cell)),
    reduced:!!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)};
  stepPresent();
}
function revealEvent(ev){	// da qui in poi la casella bloccata e le righe di registro di questo evento sono visibili
  const P = present; if(!P) return;
  if(ev.cell!=null){ P.hidden.delete(ev.cell); P.fresh = ev.cell; }
  P.lc = ev.lc; render();
}
function stepPresent(){
  const P = present; if(!P) return;
  P.i++; P.fresh = null;
  if(P.i >= P.evs.length){ present = null; render(); return; }	// fine: compaiono la scelta richiesta o la partita
  const ev = P.evs[P.i];
  if(ev.kind==='pick'){ revealEvent(ev); presentTimer = setTimeout(stepPresent, P.reduced?200:DIE_HOLD_MS.pick); return; }
  const stops = P.reduced ? [0,0] : DIE_ROLL_MS, t0 = performance.now();
  P.face = P.face || [1,1];
  const tick = ()=>{
    if(present!==P) return;
    const t = performance.now() - t0; let spinning = false;
    for(const k of [0,1]){
      if(t < stops[k]){
        let f; do { f = 1 + Math.floor(Math.random()*6); } while(f===P.face[k]);	// ogni scatto mostra un volto diverso
        P.face[k] = f; spinning = true;
      } else P.face[k] = ev.d[k];
      P.rolling[k] = t < stops[k];
    }
    if(spinning){ updateDice(); presentTimer = setTimeout(tick, 70); }
    else {
      P.rolling = [false,false];
      // con un 6 il lancio è l'ultimo del gruppo: fine animazione subito, così la scelta di riga o colonna compare appena i dadi si fermano
      if(ev.res==='six' && P.i===P.evs.length-1){ present = null; render(); return; }
      revealEvent(ev); presentTimer = setTimeout(stepPresent, P.reduced?250:DIE_HOLD_MS[ev.res]);
    }
  };
  render();	// mostra subito i dadi (e il numero di spazi già bloccati) prima di farli girare
  tick();
}
function updateDice(){	// aggiorna solo i due dadi, senza ridisegnare tutto a ogni scatto
  const P = present; if(!P || !P.face) return;
  for(const [id,k] of [['dieC',0],['dieR',1]]){
    const b = $(id); if(!b) continue;
    b.textContent = DIE[P.face[k]]; b.parentNode.classList.toggle('rolling', P.rolling[k]);
  }
}
// ---------- sequenza di animazione della mossa ----------
// Il motore calcola l'intera mossa in un colpo solo, ma qui viene mostrata un passo alla volta. Il tabellone parte dallo stato PRIMA delle catture
// (fxView.ctrl = controllore mostrato per ogni carta che cambia lato) e ogni attacco, uno dopo l'altro, fa:
//   [aumento ATK] → affondo (anche del difensore, se c'è scontro) → all'impatto la carta catturata passa al nuovo controllore e ruota.
// Lo stato mostrato è quindi sempre quello reale fino al passo corrente: una carta che cambia lato due volte nella stessa mossa (catturata e poi
// persa in battaglia) ruota due volte. Ogni passo parte quando la rotazione precedente è finita. Un render() a metà usa fxView, quindi non mostra
// mai uno stato "più avanti" di quello animato. I tempi si leggono dalle variabili CSS (--lead, --atk-time, --spin-time, --boost-time).
const cssMs = name => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return (parseFloat(v) || 0) * (v.endsWith('ms') ? 1 : 1000); };
const fxSleep = ms => new Promise(r=>setTimeout(r, ms));
const cellEl = i => document.querySelector(`.cell[data-i="${i}"]`);
const cardEl = i => document.querySelector(`.cell[data-i="${i}"] .card`);
function restartClass(el, cls){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function ctrlShown(st, i){ return fxView && i in fxView.ctrl ? fxView.ctrl[i] : st.board[i].c; }	// controllore di una carta come si vede ora
function scoreView(st){ const sc=[0,0]; st.board.forEach((x,i)=>{ if(x && x.k) sc[ctrlShown(st,i)]++; }); return sc; }
function refreshScores(){	// aggiorna solo i due contatori "Controllati", senza ridisegnare il tabellone
  if(!state || state.status==='lobby') return;
  const vs = viewSeat(), sc = scoreView(state), top = $('infoTop').querySelector('.big'), bot = $('infoBottom').querySelector('.big');
  if(top) top.textContent = sc[1-vs];
  if(bot) bot.textContent = sc[vs];
}
function setCardCtrl(i, ctrl){	// cambia in loco colore e frecce di una carta (stessa logica di cardHTML), senza ricostruirla: le altre animazioni in corso non si interrompono
  const cell = cellEl(i), card = cardEl(i); if(!cell || !card) return;
  const rot = ctrl!==viewSeat(), turned = rot && faceMode && mode==='local';
  card.classList.remove('c0','c1','cn'); card.classList.add(ctrl===0 ? 'c0' : 'c1');
  card.classList.toggle('turned', turned);
  const svg = card.querySelector('svg'); if(svg) svg.classList.toggle('rot', rot && !turned);
  const m = /^(colonna \d+, riga \d+)/.exec(cell.getAttribute('aria-label') || '');
  if(m) cell.setAttribute('aria-label', `${m[1]}, ${seatName(ctrl)}: ${cardLabel(card.dataset.k)}`);
}
function lungeNow(from, to){	// affondo della cella `from` verso la cella `to`; la direzione si misura sullo schermo (vale anche a tavolo capovolto)
  const a = cellEl(from), c = cellEl(to); if(!a || !c) return;
  const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect();
  const dx = rc.left-ra.left, dy = rc.top-ra.top, len = Math.hypot(dx,dy) || 1;
  a.style.setProperty('--lx', dx/len); a.style.setProperty('--ly', dy/len);
  restartClass(a, 'lunge');
}
function boostNow(i, b){	// il valore ATK della carta conta da b.from a b.to
  const n = cardEl(i)?.querySelector('.catk'); if(!n) return;
  n.style.setProperty('--atk-from', b.from); n.style.setProperty('--atk-to', b.to);
  restartClass(n, 'boost');
}
function showSelection(st){	// compaiono gli anelli dei bersagli (e della carta che attacca) senza ridisegnare il tabellone
  if(!st.pending || !fxView) return;
  fxView.sel = true;
  $('board').classList.add('selnew');
  for(const i of st.pending.t) cellEl(i)?.classList.add('target');
  cellEl(st.pending.a)?.classList.add('attacker');
}
function cancelFx(){ fxToken++; fxView = null; const b = $('board'); if(b) b.classList.remove('selnew'); }
function startFx(st){
  cancelFx();
  const attacks = st.fx.attacks || [];
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(reduced || (!attacks.length && (st.fx.placed==null || st.fx.drop===false))) return;	// niente da animare: si mostra subito lo stato reale
  const ctrl = {};	// controllore PRIMA della mossa di ogni carta che cambia lato (= l'opposto del suo primo cambio)
  for(const at of attacks) if(at.flip!=null && at.to!=null && !(at.flip in ctrl)) ctrl[at.flip] = 1 - at.to;
  fxView = {ctrl, sel:false}; fxSeq = st.seq;
  playFx(st, fxToken);
}
async function playFx(st, token){
  await Promise.resolve();	// il render() in corso deve prima finire di costruire il tabellone
  const alive = ()=> token===fxToken;
  const lead = cssMs('--lead'), atk = cssMs('--atk-time'), spin = cssMs('--spin-time'), boost = cssMs('--boost-time'), hit = atk/2;
  if(!alive()) return;
  if(st.fx.placed!=null && st.fx.drop!==false){ const c = cardEl(st.fx.placed); if(c) restartClass(c, 'drop'); }
  const A = st.fx.attacks || [];
  if(!A.length) await fxSleep(lead);	// solo il drop della carta piazzata
  for(let k=0; k<A.length && alive(); k++){
    const at = A[k];
    if(at.boost){ boostNow(at.a, at.boost); await fxSleep(boost); if(!alive()) return; }
    lungeNow(at.a, at.d); if(at.clash) lungeNow(at.d, at.a);
    await fxSleep(hit); if(!alive()) return;	// impatto
    if(at.flip!=null && at.to!=null){
      fxView.ctrl[at.flip] = at.to; setCardCtrl(at.flip, at.to);
      const c = cardEl(at.flip); if(c){ c.classList.toggle('p1', at.to===1); restartClass(c, 'spin'); }	// verso inverso per il Giocatore 2
      refreshScores();
      if(k===A.length-1 && st.pending){	// ultimo passo con una scelta di bersaglio: la selezione compare --lead prima della fine della rotazione
        await fxSleep(Math.max(0, spin-lead)); if(!alive()) return;
        showSelection(st);
        await fxSleep(Math.min(lead, spin));
      } else await fxSleep(spin);
    } else await fxSleep(Math.max(0, atk-hit));	// pareggio: nessuna cattura
  }
  if(!alive()) return;
  showSelection(st);	// (se la selezione non era ancora comparsa)
  $('board').classList.remove('selnew');
  fxView = null; render();	// fine: si ridisegna lo stato reale (identico a quello appena mostrato)
}
// ---------- render ----------
function render(){
  if(!state) return;
  if(state.sfx && state.seq!==setupSeq && state.status!=='lobby'){ setupSeq = state.seq; startPresent(state); }
  else if(present && present.seq!==state.seq) cancelPresent();	// lo stato è cambiato mentre i dadi giravano
  // sequenza di animazione della mossa: parte una volta per ogni nuovo stato con st.fx; se lo stato cambia mentre è in corso, viene annullata
  if(state.fx && state.seq!==animSeq && state.status!=='lobby'){ animSeq = state.seq; startFx(state); }
  else if(fxView && fxSeq!==state.seq) cancelFx();
  const st = state, vs = viewSeat();
  const topSeat = 1-vs, botSeat = vs;
  const lobby = st.status==='lobby';
  // player info
  for(const [el, s] of [[$('infoTop'), topSeat],[$('infoBottom'), botSeat]]){
    if(lobby){ el.innerHTML=''; continue; }
    const sc = scoreView(st)[s];
    const turn = st.status==='play' && st.turn===s;
    el.style.setProperty('--pc', `var(--p${s})`);
    el.innerHTML = `<span class="who ${turn?'turn':''}">${esc(seatName(s))}</span>`+
      `<span class="count">${DECKS[deckOf(s)].name}, mazzo ${st.piles[s].length}</span>`+
      `<span class="count">Controllati <span class="big">${sc}</span></span>`;
  }
  $('infoTop').classList.toggle('turned', faceMode && mode==='local' && !lobby);
  // hands
  renderHand($('handTop'), topSeat, true);
  renderHand($('handBottom'), botSeat, false);
  renderBoard();
  renderStatus();
  renderExtra();
  renderInspector();
  const logHidden = present ? Math.max(0, (st.logCount||0) - present.lc) : 0;	// righe dei lanci non ancora mostrati
  $('log').innerHTML = (st.log||[]).slice(logHidden).map(l=>`<li>${esc(fmtMsg(l))}</li>`).join('');
  renderTools();
  saveRoom();
}
function renderHand(el, seat, isTop){
  const st = state;
  if(st.status==='lobby'){ el.innerHTML=''; return; }
  const vs = viewSeat(); const rot = seat!==vs;
  const hand = st.hands[seat];
  let h = '';
  for(let i=0;i<5;i++){
    if(i>=hand.length){ h += '<span class="slot"></span>'; continue; }
    const k = hand[i];
    const sel = selHand===i && st.turn===seat;
    h += `<button class="hcard ${sel?'sel':''}" data-seat="${seat}" data-h="${i}" aria-pressed="${sel}" aria-label="${esc(cardLabel(k))}">${cardHTML(k, seat, rot)}</button>`;
  }
  el.innerHTML = h;
}
function renderBoard(){
  const st = state, vs = viewSeat(), el = $('board');
  const flip = vs===1;
  const lobby = st.status==='lobby';
  const showNums = !lobby && st.first!=null;
  let h = `<span class="lab"></span>`;
  for(let dc=0; dc<5; dc++){ const c = flip?4-dc:dc; h += `<span class="lab">${showNums?colNum(st,c):''}</span>`; }
  const placing = !lobby && st.status==='play' && !st.pending && selHand!=null && canAct(st.turn);
  const lastPlaced = st.fx ? st.fx.placed : null;
  const showSel = !fxView || fxView.sel;	// i bersagli da scegliere compaiono quando la sequenza di animazione arriva a mostrarli
  const sp = !lobby && st.status==='setup' && !present ? st.setup.pending : null;
  const picking = sp && canAct(sp.chooser) ? {p:sp, opts:setupOptions(st)} : null;
  const pickK = (r,c)=>{
    if(!picking) return 0;
    if(picking.p.stage==='col') return picking.p.row!=null && r===rowToR(st,picking.p.row) && picking.opts[colNum(st,c)-1] ? colNum(st,c) : 0;	// 6 sul dado della colonna: la riga è fissa
    return c===colToC(st,picking.p.col) && picking.opts[rowNum(st,r)-1] ? rowNum(st,r) : 0;	// 6 sul dado della riga: la colonna è fissa
  };
  for(let dr=0; dr<5; dr++){
    const r = flip?4-dr:dr;
    h += `<span class="lab">${showNums?rowNum(st,r):''}</span>`;
    for(let dc=0; dc<5; dc++){
      const c = flip?4-dc:dc, i = r*5+c; let x = lobby ? null : st.board[i];
      if(x && x.x && present && present.hidden.has(i)) x = null;	// casella che i dadi non hanno ancora bloccato
      const pos = showNums ? `colonna ${colNum(st,c)}, riga ${rowNum(st,r)}` : '';
      if(x && x.x){ h += `<span class="cell blocked ${present && present.fresh===i ? 'fresh' : ''}" role="gridcell" aria-label="${pos}, bloccato"></span>`; continue; }
      if(x && x.k){
        const cc = ctrlShown(st, i);	// controllore come si vede ora (durante la sequenza di animazione può essere ancora quello di prima della mossa)
        const isT = showSel && st.pending && st.pending.t.includes(i);
        const isA = showSel && st.pending && st.pending.a===i;
        h += `<button class="cell has ${isT?'target':''} ${isA?'attacker':''} ${lastPlaced===i?'last':''}" data-i="${i}" aria-label="${pos}, ${esc(seatName(cc))}: ${esc(cardLabel(x.k))}${isT?', bersaglio possibile':''}">${cardHTML(x.k, cc, cc!==vs)}</button>`;
      } else {
        const pk = pickK(r,c);
        if(pk) h += `<button class="cell open pick" data-pick="${pk}" aria-label="${pos}, libero: scegli ${picking.p.stage==='col'?'questa colonna':'questa riga'}"></button>`;
        else h += `<button class="cell ${placing?'open':''}" data-i="${i}" aria-label="${pos}, libero" ${lobby?'disabled':''}></button>`;
      }
    }
  }
  if(picking && picking.p.stage==='col' && picking.p.row==null){
    for(let dc=0; dc<5; dc++){
      const k = colNum(st, flip?4-dc:dc);
      h += `<button class="colpick" style="grid-column:${dc+2} / ${dc+3};grid-row:2 / 7" data-pick="${k}" aria-label="Scegli la colonna ${k}"></button>`;	// una colonna per bordo (le linee di fine vanno esplicite: con "auto" l'elemento si estenderebbe fino al bordo della griglia)
    }
  }
  el.innerHTML = h;
}
function renderStatus(){
  const st = state; const el = $('status'); const box = $('statusBox');
  box.classList.remove('overlay'); box.style.removeProperty('--pc');
  let main = '', sub = '', action = '';
  if(st.status==='lobby'){ main = 'Stanza in attesa'; sub = st.players?.s1 ? (online.peersOnline ? 'Entrambi i giocatori sono nella stanza.' : 'Il secondo giocatore si è disconnesso.') : 'In attesa del secondo giocatore.'; }
  else if(present){ main = 'Preparazione del campo'; sub = 'Lancio dei dadi…'; }
  else if(st.status==='setup'){ main = 'Preparazione del campo'; const p = st.setup.pending; sub = p ? (canAct(p.chooser) ? 'Tocca a te scegliere: tocca una casella evidenziata nel campo.' : `${seatName(p.chooser)} sta scegliendo.`) : ''; }
  else if(st.status==='play'){
    const me = canAct(st.turn);
    if(st.pending){ main = me ? (mode==='local' ? `${pName(st.turn)}, scegli chi attaccare` : 'Scegli quale mostro attaccare') : `${seatName(st.turn)} sceglie chi attaccare`; sub = me ? 'Il tuo mostro punta più avversari: tocca quello evidenziato che vuoi attaccare.' : ''; }
    else if(me){ main = mode==='local' ? `Turno di ${pName(st.turn)}` : 'Tocca a te'; sub = selHand==null ? 'Scegli una carta dalla mano, poi uno spazio libero.' : 'Ora tocca uno spazio libero evidenziato.'; }
    else { main = 'Turno dell’avversario'; sub = online.peersOnline ? '' : 'L’avversario non è connesso in questo momento.'; }
  } else if(st.status==='over'){
    const r = st.result; box.classList.add('overlay'); box.style.setProperty('--pc', `var(--p${r.winner})`);
    const esito = mode==='online' && mySeat!==null ? (r.winner===mySeat ? 'Hai vinto' : 'Hai perso') : `Vince ${pName(r.winner)}`;
    main = `<span class="big">${esito}</span>`;
    sub = `${r.score[0]} a ${r.score[1]}${r.tie ? ', pareggio risolto a favore di chi ha giocato per primo' : ''}.`;
    // nuova partita: il pulsante sta nel box del risultato (in online lo vede solo chi è host, l'altro un avviso)
    if(mode==='local') action = `<button class="btn primary" id="btnAgain">Gioca ancora</button>`;
    else if(online.host) action = `<button class="btn primary" id="btnAgain">Nuova partita</button>`;
    else if(mySeat!==null) action = `<span class="note">${esc(who(1-mySeat, true))} può avviare una nuova partita.</span>`;
  }
  const text = `${main}${sub?`<small>${esc(sub)}</small>`:''}${flash?`<small class="err">${esc(flash)}</small>`:''}`;
  // con un'azione (fine partita) il box ha due colonne: a sinistra il risultato; a destra, nello spazio vuoto, il pulsante centrato in altezza
  el.innerHTML = action ? `<div class="status-row"><div class="status-text">${text}</div><div class="status-action">${action}</div></div>` : text;
}
const DIE = ['','⚀','⚁','⚂','⚃','⚄','⚅'];
function renderExtra(){
  const st = state, box = $('extraBox');
  if(st.status==='lobby'){ box.hidden = false; box.innerHTML = lobbyHTML(); return; }
  if(st.status!=='setup' && !present){ box.hidden = true; box.innerHTML=''; return; }
  box.hidden = false;
  const S = st.setup, fr = st.firstRolls[st.firstRolls.length-1];
  const shown = S.n - (present ? present.hidden.size : 0);	// spazi bloccati finora mostrati
  let h = `<h3>Preparazione</h3>`;
  h += `<div class="note">Lancio iniziale: <b style="color:var(--p0)">${esc(seatName(0))} ${DIE[fr[0]]} ${fr[0]}</b>, <b style="color:var(--p1)">${esc(seatName(1))} ${DIE[fr[1]]} ${fr[1]}</b>. Gioca per primo ${esc(who(st.first))}.</div>`;
  h += `<div class="note">Spazi bloccati: ${shown} di 5.</div>`;
  // dadi: il dado della colonna è del primo giocatore, quello della riga del secondo (ognuno col colore del suo giocatore)
  const dd = present && present.face ? present.face : S.last, rl = present ? present.rolling : [false,false];
  if(dd) h += `<div class="dice">`+
    `<span class="die ${rl[0]?'rolling':''}" style="--dc:var(--p${st.first})"><b id="dieC">${DIE[dd[0]]}</b>colonna<small>${esc(seatName(st.first))}</small></span>`+
    `<span class="die ${rl[1]?'rolling':''}" style="--dc:var(--p${1-st.first})"><b id="dieR">${DIE[dd[1]]}</b>riga<small>${esc(seatName(1-st.first))}</small></span></div>`;
  const p = present ? null : S.pending;	// la scelta compare solo a dadi fermi
  if(p){
    const what = p.stage==='col' ? 'la colonna' : 'la riga';
    const fixed = p.stage==='col' ? (p.row!=null ? ` (la riga è ${p.row})` : '') : ` (la colonna è ${p.col})`;
    if(canAct(p.chooser)){	// la scelta si fa sul campo: qui solo l'istruzione
      const where = p.stage==='col' && p.row==null ? 'una delle colonne evidenziate' : 'una delle caselle evidenziate';
      h += `<div>${esc(mode==='local'?pName(p.chooser)+', scegli':'Scegli')} ${what}${fixed}: tocca ${where} nel campo.</div>`;
    } else h += `<div class="note">In attesa che ${esc(who(p.chooser))} scelga ${what}${fixed}.</div>`;
  }
  box.innerHTML = h;
}
function lobbyHTML(){
  const st = state; const P = st.players||{};
  let h = `<h3>Stanza</h3><div class="code" aria-label="Codice stanza">${esc(st.code)}</div>`;
  h += `<p class="note">Dai questo codice all’altro giocatore. Tieni aperta questa pagina finché giocate: la stanza esiste solo finché è aperta qui.</p>`;
  for(const s of [0,1]){
    const p = P['s'+s];
    const mine = mySeat===s;
    h += `<div class="row"><span style="min-width:7.5em">${esc(seatName(s))}</span>`;
    if(!p) h += `<span class="note">libero</span>`;
    else if(mine) h += `<select data-deck-seat="${s}" aria-label="Il tuo mazzo">${deckOptions(p.deck)}</select>`;
    else h += `<span>${DECKS[p.deck]?.name||'?'}${online.host && mySeat!==null && s===1-mySeat && !online.peersOnline ? ' <span class="note">(non connesso)</span>' : ''}</span>`;
    h += `</div>`;
  }
  if(online.host && online.signal===false) h += `<p class="err">Il collegamento con il server che mette in contatto i giocatori è caduto: l’altro giocatore non può trovare la stanza. Sto riprovando a ricollegarmi…</p>`;
  if(online.host) h += `<button class="btn primary" id="btnStart" ${P.s1&&online.peersOnline?'':'disabled'}>Inizia la partita</button>`;
  else if(mySeat!==null) h += `<p class="note">La partita parte quando ${esc(who(1-mySeat))} la avvia.</p>`;
  else h += `<p class="note">Stai guardando come spettatore: la stanza è già piena.</p>`;
  return h;
}
function renderInspector(){
  const el = $('insp');
  if(!inspected){ el.className='note'; el.textContent='Tocca una carta per vederne i dettagli.'; return; }
  const C = CARDS[inspected];
  el.className='insp';
  el.innerHTML = cardHTML(inspected, null, false) + `<dl><dt>Nome</dt><dd>${esc(C.n)}</dd><dt>ATK</dt><dd>${C.a}</dd><dt>Link</dt><dd>${C.l}</dd><dt>Attributo</dt><dd>${ATTR_LABEL[C.at]}${BEATS[C.at]?`, forte contro ${ATTR_LABEL[BEATS[C.at]]}`:''}</dd><dt>Frecce</dt><dd>${C.ar.map(d=>DIR_IT[d]).join(', ')}</dd>${C.nx?'<dt>Tipo</dt><dd>senza effetto</dd>':''}</dl>`;
}
function renderTools(){
  const st = state, el = $('tools'); let h = '';
  if(mode==='local' && st.status!=='lobby') h += `<button class="btn" id="btnRotate">Gira il tavolo</button><button class="btn" id="btnFace" aria-pressed="${faceMode}">${faceMode?'Carte tutte nello stesso verso':'Carte verso chi le controlla'}</button>`;
  if(mode==='online' && !online.host && !online.peersOnline) h += `<button class="btn primary" id="btnReconnect">Riconnetti</button>`;
  if(mode==='online' && online.host && online.signal===false) h += `<button class="btn primary" id="btnResignal">Ricollega la stanza</button>`;
  el.innerHTML = h;
}

// ---------- events ----------
document.addEventListener('click', e=>{
  const t = e.target.closest('button'); if(!t) return;
  if(t.id==='btnLocal') return startLocal();
  if(t.id==='btnCreate') return createRoom();
  if(t.id==='btnJoin') return joinRoom();
  if(t.id==='btnExit') return exitToMenu();
  if(t.id==='btnReconnect') return reconnect();
  if(t.id==='btnResume') return resumeRoom();
  if(t.id==='btnForget') return forgetRoom();
  if(t.id==='btnResignal'){ if(online.peer) hostKeepSignal(online.peer); return; }
  if(t.id==='btnRotate'){ if(isBusy()) return; localView = 1-localView; return render(); }
  if(t.id==='btnFace'){ if(isBusy()) return; faceMode = !faceMode; return render(); }
  if(t.id==='btnStart' || t.id==='btnAgain') return startMatch();
  if(!state) return;
  if(isBusy()) return;	// carte e caselle non sono cliccabili durante le animazioni
  flash = '';
  if(t.dataset.pick!=null){ const k = +t.dataset.pick; const p = state.setup?.pending; if(p && canAct(p.chooser)) act({t:'setup', k}); return; }	// scelta di riga/colonna sul campo (dopo un 6)
  if(t.dataset.h!=null){
    const seat = +t.dataset.seat, hi = +t.dataset.h;
    inspected = state.hands[seat][hi];
    if(state.status==='play' && !state.pending && state.turn===seat && canAct(seat)) selHand = selHand===hi ? null : hi;
    return render();
  }
  if(t.dataset.i!=null){
    const i = +t.dataset.i, x = state.board[i];
    if(state.status==='play' && state.pending && state.pending.t.includes(i) && canAct(state.turn)){ inspected = x.k; return act({t:'target', i}); }
    if(x && x.k){ inspected = x.k; return render(); }
    if(!x && state.status==='play' && selHand!=null && !state.pending && canAct(state.turn)){ const hi = selHand; return act({t:'place', hi, i}); }
    return render();
  }
});
document.addEventListener('change', e=>{
  const t = e.target;
  if(t.dataset && t.dataset.deckSeat!=null && state && state.status==='lobby'){
    const s = +t.dataset.deckSeat; if(s!==mySeat) return;
    const deck = t.value; const seq = (state.seq||0)+1;
    state = structuredClone(state); state.players['s'+s].deck = deck; state.seq = seq; render();
    lobbyUpdate({players:{['s'+s]:{deck}}, seq});
  }
});

// ---------- local ----------
function startLocal(){
  mode = 'local'; mySeat = null; localView = 0; selHand = null; inspected = null; flash='';
  faceMode = $('faceOpt').checked;
  state = {seq:0, status:'lobby', players:{s0:{deck:$('ld0').value}, s1:{deck:$('ld1').value}}};
  showGame(); startMatch();
}
function startMatch(){
  if(!state) return;
  if(mode==='online' && !online.host) return;
  const P = state.players; if(!P || !P.s0 || !P.s1) return;
  inspected = null;
  commit(st=>{ const g = newGame([P.s0.deck, P.s1.deck]); Object.assign(st, g); });
}
function showGame(){ $('menu').hidden = true; $('game').hidden = false; $('btnExit').hidden = false; }
function exitToMenu(){
  if(mode==='online' && connected()) send({type:'bye'});
  destroyPeer(online.conn ? 250 : 0);
  cancelPresent(); cancelFx(); setupSeq = -1; animSeq = -1;	// la prossima partita riparte da seq basso: le animazioni non vanno considerate già viste
  mode = null; state = null; mySeat = null; selHand = null;
  $('menu').hidden = false; $('game').hidden = true; $('btnExit').hidden = true; showResume();
  try{ history.replaceState(null, '', location.pathname + location.search); }catch{}
}


// ---------- boot ----------
function deckOptions(sel){ return Object.entries(DECKS).map(([k,d])=>`<option value="${k}" ${k===sel?'selected':''}>${d.name}</option>`).join(''); }
$('ld0').innerHTML = deckOptions('alba'); $('ld1').innerHTML = deckOptions('tramonto'); $('od').innerHTML = deckOptions('alba');
$('deckPreview').innerHTML = Object.values(DECKS).map(d=>`<details><summary>Mazzo ${d.name}</summary><div class="minicards">${d.cards.map(k=>cardHTML(k,null,false)).join('')}</div></details>`).join('');
// Schema dei vantaggi di Attributo (SVG, generato da BEATS): ogni freccia va da chi ha il vantaggio a chi lo subisce.
// Fuoco/Vento/Terra/Acqua in cerchio; Luce e Oscurità con doppia freccia. I colori seguono il tema (variabili CSS).
function attrDiagram(){
  const POS = {FUOCO:[130,24], VENTO:[205,75], TERRA:[130,126], ACQUA:[55,75], LUCE:[340,28], OSCURITA:[340,122]};
  const W = 88, H = 26, GAP = 3;   // dimensioni della "pillola" di ogni Attributo e distanza dalla punta della freccia
  const f = n => n.toFixed(1);
  let arrows = '';
  for(const [a,b] of Object.entries(BEATS)){
    const pa = POS[a], pb = POS[b];
    let ux = pb[0]-pa[0], uy = pb[1]-pa[1]; const len = Math.hypot(ux,uy); ux /= len; uy /= len;
    const nx = -uy, ny = ux, off = BEATS[b]===a ? 7 : 0;                 // frecce reciproche: affiancate
    const d = Math.min((W/2)/(Math.abs(ux)||1e-9), (H/2)/(Math.abs(uy)||1e-9)) + GAP;   // dal centro al bordo della pillola
    const sx = pa[0]+ux*d+nx*off, sy = pa[1]+uy*d+ny*off, ex = pb[0]-ux*d+nx*off, ey = pb[1]-uy*d+ny*off;
    const hx = ex-ux*9, hy = ey-uy*9;                                      // base della punta
    arrows += `<line x1="${f(sx)}" y1="${f(sy)}" x2="${f(hx)}" y2="${f(hy)}" class="am-line"/>`+
      `<polygon points="${f(ex)},${f(ey)} ${f(hx+nx*4.5)},${f(hy+ny*4.5)} ${f(hx-nx*4.5)},${f(hy-ny*4.5)}" class="am-head"/>`;
  }
  const nodes = Object.keys(POS).map(a=>{
    const [x,y] = POS[a], c = `var(${ATTR_VAR[a]})`;
    return `<rect x="${x-W/2}" y="${y-H/2}" width="${W}" height="${H}" rx="${H/2}" class="am-node" style="stroke:${c}"/>`+
      `<circle cx="${x-W/2+14}" cy="${y}" r="5" style="fill:${c}"/>`+
      `<text x="${x-W/2+25}" y="${y+4}" class="am-text">${ATTR_LABEL[a]}</text>`;
  }).join('');
  const alt = Object.entries(BEATS).map(([a,b])=>`${ATTR_LABEL[a]} batte ${ATTR_LABEL[b]}`).join('; ');
  return `<svg class="attrmap" viewBox="0 0 400 150" role="img" aria-label="Vantaggi di Attributo: ${alt}">${arrows}${nodes}</svg>`;
}

// Regole di preparazione
$('rulesSetup').innerHTML = `<details open>
	<summary>Preparazione</summary>
	<ol>
		<li><b>Chi inizia.</b> Entrambi i giocatori tirano un dado: il numero più alto determina il primo giocatore (in caso di pareggio si ritira).</li>
		<li><b>Campo.</b> Si gioca in una griglia di 5×5 spazi. Il primo giocatore numera le colonne da 1 a 5 partendo dalla sua sinistra; il secondo numera le righe da 1 a 5 partendo dalla più vicina a sé.</li>
		<li><b>Spazi bloccati.</b> Entrambi i giocatori tirano un dado: il dado del primo giocatore indica la colonna, quello del secondo la riga; lo spazio all’incrocio viene bloccato e non vi si potranno giocare carte. <b>Si ripete finché gli spazi bloccati sono 5.</b></li>
		<li><b>Singolo 6.</b> Il giocatore che ha fatto 6 al dado sceglie il numero, da 1 a 5, tra gli spazi ancora liberi: la colonna se è il primo giocatore, la riga se è il secondo.</li>
		<li><b>Doppio 6.</b> Se entrambi i giocatori fanno 6 al dado, il primo giocatore sceglie la colonna, poi il secondo sceglie la riga: lo spazio indicato dev’essere libero.</li>
	</ol>
	<p class="note">Nel simulatore, la preparazione è gestita automaticamente.</p>
</details>`;

// Regole di gioco. Mostrato nel menu principale e in partita.
const RULES_HTML =
`<details>
	<summary>Regole</summary>
	<ul>
		<li>Piazza un mostro in uno spazio libero. Se una sua freccia punta un mostro avversario, <b>deve attaccarlo</b>; se ne punta più di uno, scegline <b>uno solo</b>.</li>
		<li>Se il difensore non ha la freccia opposta, è <b>catturato</b>. Altrimenti si confrontano gli ATK: chi ne ha meno viene catturato, con il pareggio non succede nulla.</li>
		<li>Il mostro catturato ruota verso di te e, se ora punta altri mostri avversari, attacca a sua volta (combo). Se il tuo attaccante perde, viene catturato dall’avversario e il turno finisce.</li>
		<li>Quando non restano più spazi liberi, la partita termina: <b><u>vince chi controlla più mostri</u></b> (in caso di parità <b>vince il primo giocatore</b>).</li>
	</ul>
	<p class="note">Gli effetti dei mostri sono ignorati.</p>
	<div><b>Vantaggi di Attributo</b> (+${BONUS} ATK all’attaccante):</div>
	${attrDiagram()}
	<p class="note">La freccia va dall’Attributo che ha il vantaggio a quello che lo subisce.</p>
</details>`;

$('rulesGame').innerHTML = RULES_HTML;	// Riquadro delle regole nella schermata di gioco.
$('rulesMenu').innerHTML = RULES_HTML;	// Riquadro delle regole nella scchermata principale.
$('rulesMenu').querySelector('details').open = true;	// nella home le regole partono aperte (in partita restano chiuse)
const hm =/^#stanza-([A-Za-z0-9]{5})$/.exec(location.hash);
if(hm) $('joinCode').value = hm[1].toUpperCase();
initOnline();
showResume();
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) netWake(); });
window.addEventListener('online', netWake);