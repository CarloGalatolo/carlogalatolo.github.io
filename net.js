// Link Grid — parte online (PeerJS, connessione diretta tra browser): stanza, host/ospite, riconnessioni, passaggio dell'host, ripresa della stanza.
// Usa lo stato dell'applicazione e le funzioni di graphics.js (state, mode, mySeat, render, commit, $…): si carica dopo engine.js e prima di graphics.js.
// Modalità di gioco. Enum "stretta": i valori restano stringhe (leggibili nel debug), ma un nome sbagliato (Mode.ONLIN) lancia un errore
// invece di diventare un silenzioso `undefined` che farebbe fallire ogni confronto. `mode` vale null quando si è nel menu, senza partita.
function makeEnum(name, values){
  const e = Object.freeze(Object.assign({}, values));
  return new Proxy(e, {
    get(t, k){ if(typeof k === 'string' && !(k in t) && k !== 'toJSON' && k !== 'then') throw new ReferenceError(`${name}.${k} non esiste (valori: ${Object.keys(t).join(', ')})`); return t[k]; },
    set(t, k){ throw new TypeError(`${name} è un'enumerazione: ${String(k)} non si può modificare`); },
    deleteProperty(t, k){ throw new TypeError(`${name} è un'enumerazione: ${String(k)} non si può eliminare`); }
  });
}
const Mode = makeEnum('Mode', {LOCAL:'local', ONLINE:'online'});
const online = {peer:null, conn:null, host:false, myId:null, code:null, deck:null, peersOnline:false, signal:null, lastSeen:0, watch:null, retry:0, joinTimer:0, joinTry:0, takeTimer:0, hostLeft:false, pendingState:null, awaiting:false, awaitTimer:0,
  spec:false, specs:new Set(), specTimer:0, presence:null};	// spec = questo browser è uno spettatore; specs = (host) le connessioni degli spettatori; presence = (spettatori) chi è collegato, come lo vede l'host	// signal = l'host è collegato al server che mette in contatto i giocatori (null = non applicabile)

// ---------- online (PeerJS, connessione diretta tra browser) ----------
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'linkgrid-v1-';
function newCode(){ let s=''; for(let i=0;i<5;i++) s += CODE_CH[Math.floor(Math.random()*CODE_CH.length)]; return s; }
function menuError(msg){ const e=$('menuErr'); e.hidden = !msg; e.textContent = msg||''; }
function initOnline(){
  const note = $('onlineNote');
  // un id per scheda: sopravvive al ricaricamento, ma due schede dello stesso browser restano giocatori diversi
  try{ online.myId = sessionStorage.getItem('linkgrid-id'); }catch{}
  if(!online.myId){ online.myId = 'g' + Math.random().toString(36).slice(2,12); try{ sessionStorage.setItem('linkgrid-id', online.myId); }catch{} }
  if(typeof Peer === 'undefined'){ note.textContent = 'Non è stato possibile caricare la libreria per il gioco online. Controlla la connessione a internet e ricarica la pagina.'; return; }
  $('btnCreate').disabled = false; $('btnJoin').disabled = false;
  note.textContent = ONLINE_NOTE;
}
function peerErrorText(err){
  const t = err && err.type;
  if(t==='peer-unavailable') return 'Nessuna stanza aperta con questo codice. Controlla il codice, e che chi l’ha creata abbia ancora la pagina aperta.';
  if(t==='network' || t==='server-error' || t==='socket-error' || t==='socket-closed') return 'Il server che mette in contatto i giocatori non risponde. Riprova tra poco.';
  if(t==='browser-incompatible') return 'Questo browser non supporta le connessioni dirette. Prova con una versione recente di Chrome, Firefox, Edge o Safari.';
  return 'Connessione non riuscita. Riprova tra poco.';
}
// ===== costanti e controllo della connessione =====
const ONLINE_NOTE = 'La partita passa direttamente tra i due browser: entrambi devono tenere aperta questa pagina.';
const JOIN_TRIES = 5;	// tentativi automatici dell'ospite prima di arrendersi
const PING_MS = 4000, DEAD_MS = 14000;	// ping periodico tra i due browser; senza risposta per DEAD_MS la connessione si considera morta
function noteSeen(){ online.lastSeen = Date.now(); }
function startNetWatch(){	// il browser può impiegare decine di secondi ad accorgersi che l'altro è sparito: lo si scopre con un ping
  if(online.watch) return;
  noteSeen();
  online.watch = setInterval(()=>{
    pruneSpecs();
    if(!online.conn || !connected()) return;
    send({type:'ping'});
    if(online.peersOnline && Date.now() - (online.lastSeen||0) > DEAD_MS) linkLost(online.conn, true);
  }, PING_MS);
}
function stopNetWatch(){ clearInterval(online.watch); online.watch = null; }
const MAX_SPECS = 8;	// spettatori al massimo per stanza (ognuno è una connessione che l'host deve mantenere)
const SPEC_CLOSE_MS = 60000;	// uno spettatore che non ritrova la stanza per tanto tempo la considera chiusa (più dei 25 s con cui l'altro giocatore ne prende il posto)
const TAKEOVER_MS = 25000;	// l'ospite che non riesce a raggiungere l'host per tanto tempo ne prende il posto (se l'host ha detto addio, subito)
function destroyPeer(delay=0){
  clearTimeout(online.retry); clearTimeout(online.joinTimer); clearTimeout(online.takeTimer); clearTimeout(online.specTimer); online.specTimer = 0; stopNetWatch();
  const c = online.conn, p = online.peer, sp = [...online.specs];
  // prima si azzera lo stato: così i gestori di 'close' non scambiano una chiusura voluta per una caduta di rete
  online.conn = null; online.peer = null; online.peersOnline = false; online.signal = null; online.joinTry = 0; online.hostLeft = false; online.pendingState = null;
  online.spec = false; online.presence = null; online.specs.clear();
  const close = ()=>{ try{ c && c.close(); }catch{} sp.forEach(x=>{ try{ x.close(); }catch{} }); try{ p && p.destroy(); }catch{} };
  if(delay) setTimeout(close, delay); else close();	// (con un ritardo, l'ultimo messaggio — il saluto "bye" — fa in tempo a partire)
}
// La connessione con l'altro giocatore è caduta (chiusa, o senza risposte): l'host libera il posto in sala d'attesa, l'ospite prova a ricollegarsi da solo
// e, se l'host non torna, ne prende il posto (vedi becomeHost)
function linkLost(c, forceClose){
  if(c!==online.conn || c.__gone) return;
  c.__gone = true; online.peersOnline = false;
  if(forceClose){ try{ c.close(); }catch{} }
  if(online.host){
    if(state && state.status==='lobby' && state.players && state.players.s1){
      const st = structuredClone(state); st.players.s1 = null; st.seq = (state.seq||0)+1; state = st;
      sendSpecs({type:'state', state});
    }
    announcePresence();
  } else if(online.spec){	// lo spettatore non prende il posto di nessuno: aspetta che la stanza torni (stesso host o l'altro giocatore) e, se non torna, la considera chiusa
    flash = online.hostLeft ? 'L’host ha lasciato la stanza: aspetto che torni o che la riapra l’altro giocatore…' : 'Connessione con la stanza persa: provo a ricollegarmi…';
    scheduleGuestReconnect(); scheduleSpecClose();
  } else {
    flash = online.hostLeft ? 'L’altro giocatore ha lasciato la stanza: ne prendo il posto come host…' : 'Connessione con l’host persa: provo a ricollegarmi…';
    scheduleGuestReconnect();
    scheduleTakeover(online.hostLeft ? 800 : TAKEOVER_MS);
  }
  if(state) render();
}
function scheduleTakeover(ms){
  clearTimeout(online.takeTimer);
  if(online.host || online.spec || mode!==Mode.ONLINE || !state) return;
  online.takeTimer = setTimeout(()=>{ if(!online.host && mode===Mode.ONLINE && !connected()) becomeHost(); }, ms);
}
// ===== spettatori =====
// Chi entra in una stanza già piena (o lo sceglie con la casella "spettatore") guarda soltanto: l'host gli manda lo stato come all'ospite, ma non
// accetta nulla da lui (le mosse vengono solo da online.conn). Gli spettatori non hanno un posto, quindi non diventano mai host: se l'host sparisce
// si ricollegano alla stanza (la riapre l'altro giocatore) e, se non torna nessuno entro SPEC_CLOSE_MS, la considerano chiusa.
function sendSpecs(msg){	// (host) a tutti gli spettatori; il campo spec dice loro che sono spettatori
  const m = Object.assign({}, msg, {spec:true});
  for(const c of online.specs) if(c.open){ try{ c.send(m); }catch{} }
}
function broadcast(msg){ send(msg); sendSpecs(msg); }	// (host) all'altro giocatore e agli spettatori
function announcePresence(){	// (host) chi è collegato e quanti spettatori ci sono: lo sa solo l'host
  if(!online.host || mySeat===null || mySeat===undefined) return;
  const on = [false, false]; on[mySeat] = true; on[1-mySeat] = !!(connected() && online.peersOnline);
  broadcast({type:'presence', on, specs: online.specs.size});
}
function acceptSpectator(c, id){
  if(!c.__spec){
    for(const o of [...online.specs]) if(o!==c && o.__id===id){ online.specs.delete(o); try{ o.close(); }catch{} }	// lo stesso spettatore che rientra sostituisce la connessione vecchia (prima del controllo del limite: non occupa un altro posto)
    if(online.specs.size >= MAX_SPECS){ try{ c.send({type:'full'}); }catch{} setTimeout(()=>c.close(), 300); return; }
    c.__spec = true; c.__id = id; online.specs.add(c);
  }
  c.__seen = Date.now();
  try{ c.send({type:'state', state, force:true, spec:true}); }catch{}
  announcePresence(); render();
}
function specGone(c){ if(online.specs.delete(c)){ announcePresence(); if(state) render(); } }
function pruneSpecs(){	// (host) gli spettatori che non mandano più ping (rete caduta senza che la connessione si chiuda) vengono tolti
  if(!online.host) return;
  for(const c of [...online.specs]) if(!c.open || Date.now() - (c.__seen||0) > DEAD_MS){ online.specs.delete(c); try{ c.close(); }catch{} announcePresence(); if(state) render(); }
}
function scheduleSpecClose(){	// (spettatore) il tempo comincia alla prima caduta e si azzera quando lo stato della stanza torna ad arrivare
  if(online.specTimer || !online.spec) return;
  online.specTimer = setTimeout(()=>{ online.specTimer = 0; if(online.spec && mode===Mode.ONLINE && !connected()) closeSpectating('La stanza è stata chiusa: i giocatori se ne sono andati.'); }, SPEC_CLOSE_MS);
}
function closeSpectating(msg){ exitToMenu(); menuError(msg); }
function leaveRoom(){	// l'utente lascia la stanza di sua volontà: avvisa chi è collegato (la chiusura della connessione, da sola, il browser la nota solo dopo un po')
  if(mode!==Mode.ONLINE) return;
  if(online.host){
    const other = state && state.players && state.players['s'+(1-mySeat)];
    sendSpecs({type: other ? 'bye' : 'closed'});	// c'è un altro giocatore (anche se ora è scollegato): potrebbe riaprire la stanza; altrimenti la stanza è finita
  }
  send({type:'bye'});
}
// ===== passaggio dell'host =====
// Il ruolo di host (chi tiene la stanza e lo stato) è separato dal posto di gioco: se l'host sparisce, l'ospite crea la stanza con lo stesso codice
// tenendo il suo posto e il suo stato. Se l'altro torna, rientra come ospite (revertToGuest/joinAsGuest) e, se ha giocato nel frattempo, il suo stato
// più recente viene adottato (adoptNewer). Il server dei codici garantisce un solo host per stanza: chi arriva secondo trova l'id occupato.
function becomeHost(){
  if(online.host || online.spec || mode!==Mode.ONLINE || !state || !state.code) return;
  clearTimeout(online.retry); clearTimeout(online.takeTimer);
  const code = state.code;
  if(state.status==='lobby'){	// sala d'attesa: chi resta diventa il Giocatore 1 della stanza (l'altro, se torna, entra come ospite)
    const mine = state.players && state.players['s'+mySeat], st = structuredClone(state);
    st.players = {s0:{id:online.myId, deck: mine ? mine.deck : 'alba'}, s1:null}; st.seq = (state.seq||0)+1; state = st; mySeat = 0;
  }
  flash = 'L’altro giocatore non c’è più: ora l’host sei tu. Se torna, rientra nella stanza con lo stesso codice.';
  const oc = online.conn; online.conn = null; online.peersOnline = false; online.hostLeft = false;
  try{ oc && oc.close(); }catch{}
  createRoom(0, code, null, true);
}
function revertToGuest(){	// la stanza è già in mano all'altro giocatore (o il server non l'ha ancora liberata): ci si ricollega come ospite
  const old = online.peer; online.peer = null; try{ old && old.destroy(); }catch{}
  online.host = false; online.signal = null; online.peersOnline = false;
  const oc = online.conn; online.conn = null; try{ oc && oc.close(); }catch{}
  reconnect();	// (imposta "Riconnessione in corso…": il messaggio più utile va messo dopo)
  flash = 'La stanza ha già un host: mi ricollego come ospite…'; if(state) render();
  scheduleGuestReconnect(); scheduleTakeover(TAKEOVER_MS);
}
function joinAsGuest(code, restore){	// "Riprendi la stanza" dal menu, ma l'altro giocatore ne è già diventato l'host: si entra da ospite portando il proprio stato
  $('btnCreate').disabled = false;
  $('joinCode').value = code;
  joinRoom(false);
  online.pendingState = restore;	// (dopo joinRoom: destroyPeer lo azzera)
}
function adoptNewer(d, id){	// l'altro ha giocato mentre l'host non lo vedeva (o la stanza ha cambiato host): si adotta il suo stato se è più recente e valido
  if(!d || typeof d!=='object' || !state || state.status==='lobby' || d.code!==state.code || (d.seq||0) <= (state.seq||0)) return false;
  const P = state.players, seat = P.s0 && P.s0.id===id ? 0 : P.s1 && P.s1.id===id ? 1 : null;
  if(seat===null || !d.players || !d.players.s0 || !d.players.s1 || d.players.s0.id!==P.s0.id || d.players.s1.id!==P.s1.id) return false;
  // valido solo se nello stato che ho il turno (o la scelta) era suo: cioè sono mosse che poteva fare
  const was = (state.status==='play' && state.turn===seat) || (state.status==='setup' && state.setup && state.setup.pending && state.setup.pending.chooser===seat);
  if(!was) return false;
  applyRemote(d, true); return true;
}
function createRoom(tries=0, resume=null, restore=null, takeover=false){
  menuError('');
  if(typeof Peer==='undefined') return;
  $('btnCreate').disabled = true;
  if(resume){ const old = online.peer; online.peer = null; try{ old && old.destroy(); }catch{} }	// stessa stanza e stesso codice: si ricrea solo il collegamento col server
  else destroyPeer();
  const code = resume || newCode();
  const peer = new Peer(PEER_PREFIX + code.toLowerCase());
  online.peer = peer; online.host = true; online.code = code; online.signal = false;
  peer.on('open', ()=>{
    $('btnCreate').disabled = false; online.signal = true;
    // 'open' scatta anche quando il collegamento col server si ristabilisce dopo una caduta: la stanza (e l'eventuale partita) restano quelle, non si ricreano
    if(mode===Mode.ONLINE && state && state.code===code){ if(!takeover) flash = ''; render(); return; }
    mode = Mode.ONLINE; mySeat = 0;
    if(restore){	// stanza ripresa dal salvataggio (vedi resumeRoom): stesso stato di prima, l'ospite si ricollega da solo
      state = structuredClone(restore); state.fx = null; state.sfx = null; state.seq = (state.seq||0) + 1;
      if(seatFromState()===null){ state.players = state.players || {}; state.players.s0 = {id:online.myId, deck:(state.players.s0 && state.players.s0.deck) || $('od').value}; }
      mySeat = seatFromState() ?? 0;	// (dopo un passaggio di host può essere il Giocatore 2)
      $('onlineNote').textContent = ONLINE_NOTE;
    } else {
      state = {v:1, seq:1, code, status:'lobby', players:{s0:{id:online.myId, deck:$('od').value}, s1:null}, log:[]};
    }
    attach(code);
  });
  peer.on('connection', c=>hostAccept(c));
  peer.on('disconnected', ()=>{ if(online.peer!==peer) return; online.signal = false; if(mode===Mode.ONLINE && state) render(); hostKeepSignal(peer); });
  peer.on('close', ()=>{	// il collegamento col server è stato chiuso del tutto (errore grave): si ricrea con lo stesso codice
    if(online.peer!==peer || !online.host || mode!==Mode.ONLINE) return;
    online.signal = false; render();
    setTimeout(()=>{ if(online.peer===peer && mode===Mode.ONLINE) createRoom(0, code); }, 1500);
  });
  peer.on('error', err=>{
    if(online.peer!==peer) return;
    if(err.type==='unavailable-id'){
      const established = mode===Mode.ONLINE && state && state.code===code;
      if(resume || established){
        // L'id della stanza risulta occupato: o il server non ha ancora liberato quello vecchio (succede subito dopo aver chiuso la pagina), oppure
        // se l'è preso l'altro giocatore (passaggio dell'host). Dopo qualche tentativo ci si prova a collegare come ospite: se c'è già un host risponde.
        if(tries>=3){
          if(mode===Mode.ONLINE) revertToGuest();
          else if(restore) joinAsGuest(code, restore);
          return;
        }
        if(mode!==Mode.ONLINE) $('onlineNote').textContent = 'Riprendo la stanza: il server la sta ancora liberando, riprovo…';
        setTimeout(()=>{ if(online.peer===peer && (mode===Mode.ONLINE || restore)) createRoom(tries+1, code, restore, takeover); }, 3000);
        return;
      }
      if(tries<4) return createRoom(tries+1);
    }
    $('btnCreate').disabled = false;
    if(mode!==Mode.ONLINE){ menuError(peerErrorText(err)); destroyPeer(); }
    else { flash = peerErrorText(err); render(); }
  });
}
function hostAccept(c){
  c.on('data', msg=>{
    if(!msg || typeof msg!=='object' || !state) return;
    if(c===online.conn) noteSeen(); else if(c.__spec) c.__seen = Date.now();
    if(msg.type==='ping'){ try{ c.send({type:'pong'}); }catch{} return; }
    if(msg.type==='pong' || msg.type==='bye') return;	// ("bye": l'ospite se ne va di proposito: la chiusura della connessione che segue basta)
    // l'host può essere il Giocatore 1 o, dopo un passaggio di host, il 2: l'"altro" è sempre l'altro posto
    const other = 1 - mySeat, key = 's' + other;
    if(msg.type==='hello'){
      const id = String(msg.id||'').slice(0,40);
      const deck = DECKS[msg.deck] ? msg.deck : 'tramonto';
      const P = state.players;
      // il posto dell'altro è occupato solo se quel giocatore è davvero collegato: se se n'è andato (anche a partita iniziata, per esempio perché ha
      // chiuso la scheda e ha perso il suo id) chi conosce il codice può riprenderlo
      const otherHere = !!(online.conn && online.conn!==c && online.conn.open && online.peersOnline);
      const seated = !!((P.s0 && P.s0.id===id) || (P.s1 && P.s1.id===id));	// chi ha già un posto nella stanza lo riprende anche se aveva spuntato "spettatore"
      // posto occupato da un giocatore collegato (o scelta esplicita): si guarda soltanto
      if(c!==online.conn && !seated && (msg.spectate || c.__spec || (P[key] && P[key].id!==id && otherHere))){ acceptSpectator(c, id); return; }
      const old = online.conn; online.conn = c; online.peersOnline = true; flash = ''; noteSeen();
      if(old && old!==c){ try{ old.close(); }catch{} }	// (online.conn è già il nuovo: la chiusura del vecchio non conta come caduta)
      adoptNewer(msg.state, id);	// se l'altro ha giocato mentre non ci vedevamo, il suo stato (più recente) vince
      if(!state.players[key] || state.players[key].id!==id){
        const st = structuredClone(state);
        st.players[key] = {id, deck: (state.status==='lobby' || !state.players[key]) ? deck : state.players[key].deck};	// a partita iniziata i mazzi non cambiano
        st.seq = (state.seq||0)+1; state = st;
      }
      c.send({type:'state', state, force:true});	// (force: l'ospite adotta lo stato dell'host anche se il suo numero di versione è più alto)
      sendSpecs({type:'state', state}); announcePresence();	// (il posto può essere cambiato: anche gli spettatori lo vedono)
      render();
      return;
    }
    if(c!==online.conn) return;
    if(msg.type==='deck' && state.status==='lobby' && DECKS[msg.deck] && state.players[key]){
      const st = structuredClone(state); st.players[key].deck = msg.deck; st.seq = (state.seq||0)+1; state = st;
      broadcast({type:'state', state}); render(); return;
    }
    if(msg.type==='move'){	// l'ospite manda solo la mossa: la calcola l'host con il motore (applyMove la controlla), nessuno stato dell'ospite viene accettato
      if(!msg.move || (msg.seq||0)!==(state.seq||0)){ send({type:'state', state, force:true}); return; }	// mossa fatta su uno stato non aggiornato: si rimanda quello giusto
      const before = state.seq;
      commit(st=>applyMove(st, other, msg.move));
      if(state.seq===before) send({type:'state', state, force:true});	// mossa non valida (turno sbagliato, casella occupata…): l'ospite si riallinea
      return;
    }
    if(msg.type==='state') send({type:'state', state, force:true});	// (le versioni precedenti mandavano lo stato intero: non viene più accettato)
  });
  c.on('close', ()=>{ if(c.__spec) specGone(c); else linkLost(c); });
  c.on('error', ()=>{});
}
function guestConnect(){
  const peer = online.peer; if(!peer) return;
  if(peer.disconnected && !peer.destroyed){ try{ peer.reconnect(); }catch{} setTimeout(()=>{ if(online.peer===peer) guestConnect(); }, 1500); return; }
  const c = peer.connect(PEER_PREFIX + online.code.toLowerCase(), {reliable:true});
  if(!c) return joinFailed('Connessione non riuscita. Riprova tra poco.');
  let gotState = false, helloTimer = 0, helloN = 0;
  const timer = setTimeout(()=>{ if(!c.open){ try{ c.close(); }catch{} joinFailed('La stanza non risponde. Controlla il codice, che l’altro giocatore abbia la pagina aperta, e riprova.'); } }, 12000);
  const sendHello = ()=>{
    const deck = (state && state.players && mySeat!=null && state.players['s'+mySeat]) ? state.players['s'+mySeat].deck : online.deck;
    const mine = (state && state.code===online.code) ? state : online.pendingState;	// il mio stato accompagna il saluto: se è più recente dell'host (ho giocato mentre non ci vedevamo) lo adotta
    try{ c.send({type:'hello', id:online.myId, deck, state: online.spec ? null : (mine || null), spectate: online.spec}); }catch{}	// (uno spettatore non ha uno stato suo da proporre)
  };
  c.on('open', ()=>{
    clearTimeout(timer);
    const prev = online.conn; online.conn = c; online.peersOnline = true; noteSeen();
    if(prev && prev!==c){ try{ prev.close(); }catch{} }
    sendHello();
    // se l'host non risponde subito (la sua pagina può essere in pausa), il saluto si ripete finché non arriva lo stato della stanza
    helloTimer = setInterval(()=>{
      if(gotState || !c.open || online.conn!==c){ clearInterval(helloTimer); return; }
      if(++helloN > 5){ clearInterval(helloTimer); try{ c.close(); }catch{} return; }
      sendHello();
    }, 3000);
  });
  c.on('data', msg=>{
    if(!msg || typeof msg!=='object') return;
    if(c===online.conn) noteSeen();
    if(msg.type==='ping'){ try{ c.send({type:'pong'}); }catch{} return; }
    if(msg.type==='pong') return;
    if(msg.type==='bye'){ online.hostLeft = true; if(!online.spec) scheduleTakeover(1500); return; }	// l'host se ne va di proposito: la sua stanza passa a me appena la connessione si chiude
    if(msg.type==='closed'){ if(mode===Mode.ONLINE) closeSpectating('La stanza è stata chiusa: i giocatori se ne sono andati.'); return; }
    if(msg.type==='presence'){ online.presence = {on:msg.on, specs:msg.specs|0}; if(state) render(); return; }
    if(msg.type==='full'){ $('btnJoin').disabled = false; $('onlineNote').textContent = ONLINE_NOTE; destroyPeer(); if(mode===Mode.ONLINE) exitToMenu(); menuError('La stanza è già piena.'); return; }
    if(msg.type==='state' && msg.state){
      gotState = true; clearInterval(helloTimer); online.joinTry = 0; clearTimeout(online.retry); clearTimeout(online.takeTimer);
      online.hostLeft = false; online.pendingState = null;
      online.spec = !!msg.spec; clearTimeout(online.specTimer); online.specTimer = 0;
      const first = mode!==Mode.ONLINE;
      $('btnJoin').disabled = false; $('onlineNote').textContent = ONLINE_NOTE;
      if(first){ mode = Mode.ONLINE; state = null; }
      flash = '';
      applyRemote(msg.state, !!msg.force);
      if(first){ storeSaved(GUEST_KEY, {code:online.code, id:online.myId}); attach(online.code); }
      else render();
    }
  });
  c.on('close', ()=>{
    clearTimeout(timer); clearInterval(helloTimer);
    if(c!==online.conn) return;
    if(mode!==Mode.ONLINE){ online.conn = null; online.peersOnline = false; joinFailed('La connessione con la stanza si è interrotta.'); return; }
    linkLost(c);
  });
  c.on('error', ()=>{});
}
function applyRemote(d, force){
  if(!d) return;
  if(!state || force || (d.seq||0) >= (state.seq||0)){
    online.awaiting = false; clearTimeout(online.awaitTimer);
    const prevStatus = state && state.status;
    state = structuredClone(d);
    mySeat = seatFromState();
    if(state.status!=='play' || state.turn!==mySeat || state.pending) selHand = null;
    if(prevStatus==='lobby' && state.status!=='lobby') inspected = null;
    render();
  }
}

// La connessione con l'altro giocatore è caduta (chiusa, o senza risposte): l'host libera il posto in sala d'attesa, l'ospite prova a ricollegarsi da solo
function scheduleGuestReconnect(n=0){	// l'ospite riprova da solo, con pause crescenti, finché non è di nuovo collegato
  clearTimeout(online.retry);
  if(online.host || mode!==Mode.ONLINE || connected() || n>=60) return;
  online.retry = setTimeout(()=>{
    if(online.host || mode!==Mode.ONLINE || connected()) return;
    reconnect(); scheduleGuestReconnect(n+1);
  }, Math.min(2000 + n*1000, 8000));
}
function netWake(){	// la scheda torna visibile o la rete torna disponibile: si ricollega subito invece di aspettare il prossimo tentativo
  if(mode!==Mode.ONLINE) return;
  if(online.host){ if(online.peer && online.peer.disconnected && !online.peer.destroyed) hostKeepSignal(online.peer); }
  else if(!connected()) reconnect();
}
// ===== host =====
function hostKeepSignal(peer, n=0){	// ricollega l'host al server finché non ci riesce (la riconnessione di PeerJS è un solo tentativo)
  if(online.peer!==peer || peer.destroyed || !peer.disconnected) return;
  try{ peer.reconnect(); }catch{}
  setTimeout(()=>{ if(online.peer===peer && !peer.destroyed && peer.disconnected) hostKeepSignal(peer, n+1); }, Math.min(1500 + n*1500, 10000));
}
// ===== ospite =====
function joinFailed(why){	// prima connessione fallita: riprova da solo qualche volta prima di arrendersi (l'host potrebbe essere in fase di ricollegamento al server)
  if(mode===Mode.ONLINE){ flash = why; render(); scheduleGuestReconnect(); return; }
  const peer = online.peer;
  online.joinTry = (online.joinTry||0) + 1;
  if(peer && !peer.destroyed && online.joinTry < JOIN_TRIES){
    $('onlineNote').textContent = `Non trovo ancora la stanza: riprovo (tentativo ${online.joinTry+1} di ${JOIN_TRIES})…`;
    clearTimeout(online.joinTimer);
    online.joinTimer = setTimeout(()=>{ if(mode!==Mode.ONLINE && online.peer===peer) guestConnect(); }, 2500);
    return;
  }
  $('btnJoin').disabled = false; $('onlineNote').textContent = ONLINE_NOTE;
  menuError(why); destroyPeer();
}
function joinRoom(asSpectator){
  menuError('');
  const code = $('joinCode').value.trim().toUpperCase();
  if(!/^[A-Z0-9]{5}$/.test(code)) return menuError('Il codice ha 5 caratteri, lettere e numeri.');
  if(typeof Peer==='undefined') return;
  $('btnJoin').disabled = true;
  destroyPeer();
  online.host = false; online.code = code; online.deck = $('od').value; online.joinTry = 0;
  online.spec = asSpectator===undefined ? !!($('specOpt') && $('specOpt').checked) : !!asSpectator;	// (dopo destroyPeer, che lo azzera) casella "spettatore"; se la stanza è piena lo si diventa comunque
  const g = loadSaved(GUEST_KEY);	// stesso id dell'ultima volta in questa stanza: si riprende il proprio posto anche da una scheda nuova
  if(g && g.code===code && g.id){ online.myId = g.id; try{ sessionStorage.setItem('linkgrid-id', g.id); }catch{} }
  $('onlineNote').textContent = 'Mi collego alla stanza…';
  const peer = new Peer();
  online.peer = peer;
  peer.on('open', ()=>{ if(!connected()) guestConnect(); });	// ('open' scatta di nuovo se il collegamento col server si ristabilisce: non si apre una seconda connessione)
  peer.on('disconnected', ()=>{ if(online.peer===peer && !peer.destroyed) setTimeout(()=>{ try{ peer.reconnect(); }catch{} }, 1500); });
  peer.on('error', err=>{
    if(online.peer!==peer) return;
    if(mode!==Mode.ONLINE){
      if(err.type==='peer-unavailable') return joinFailed(peerErrorText(err));
      $('btnJoin').disabled = false; $('onlineNote').textContent = ONLINE_NOTE;
      menuError(peerErrorText(err)); destroyPeer(); return;
    }
    flash = peerErrorText(err); online.peersOnline = false; render(); scheduleGuestReconnect();
  });
}
function reconnect(){
  online.joinTry = 0;
  if(online.host) return;
  flash = 'Riconnessione in corso…'; render();
  if(online.peer && !online.peer.destroyed && !online.peer.disconnected) guestConnect();
  else {
    const keepState = state;
    const peer = new Peer(); online.peer = peer;
    peer.on('open', ()=>{ if(!connected()) guestConnect(); });
    peer.on('error', err=>{ if(online.peer===peer){ flash = peerErrorText(err); render(); scheduleGuestReconnect(); } });
    state = keepState;
  }
}
// ===== riprendere la stanza dopo aver chiuso o ricaricato la pagina =====
const ROOM_KEY = 'linkgrid-room', GUEST_KEY = 'linkgrid-guest', ROOM_TTL = 24*3600*1000;
function loadSaved(key){ try{ const v = JSON.parse(localStorage.getItem(key)); return v && Date.now() - (v.at||0) < ROOM_TTL ? v : null; }catch{ return null; } }
function storeSaved(key, v){ try{ localStorage.setItem(key, JSON.stringify(Object.assign({at:Date.now()}, v))); }catch{} }
let savedSeq = -1;
function saveRoom(){	// l'host salva la stanza a ogni cambiamento di stato (la tiene solo lui): così può riprenderla anche dopo una chiusura o un ricaricamento
  if(mode!==Mode.ONLINE || !online.host || !state || !state.code || (state.seq||0)===savedSeq) return;
  savedSeq = state.seq||0;
  const copy = Object.assign({}, state); delete copy.fx; delete copy.sfx;
  storeSaved(ROOM_KEY, {code:state.code, hostId:online.myId, state:copy});
}
function showResume(){
  const box = $('resumeBox'); if(!box) return;
  const r = loadSaved(ROOM_KEY);
  if(!r || !r.state || !r.code){ box.hidden = true; box.innerHTML = ''; return; }
  const what = r.state.status==='lobby' ? 'in sala d’attesa' : r.state.status==='over' ? 'partita finita' : 'partita in corso';
  box.hidden = false;
  box.innerHTML = `<div>Hai lasciato la stanza <b>${esc(r.code)}</b> (${what}). Riprendila: l’altro giocatore, se è ancora collegato, rientra da solo.</div>`+
    `<div class="row"><button class="btn primary" id="btnResume">Riprendi la stanza</button><button class="btn" id="btnForget">Dimentica</button></div>`;
}
function forgetRoom(){ try{ localStorage.removeItem(ROOM_KEY); }catch{} savedSeq = -1; showResume(); }
function resumeRoom(){
  const r = loadSaved(ROOM_KEY);
  if(!r || !r.state){ showResume(); return; }
  if(typeof Peer==='undefined') return;
  online.myId = r.hostId; try{ sessionStorage.setItem('linkgrid-id', r.hostId); }catch{}	// stesso id di prima: il posto 1 della stanza è ancora il suo
  savedSeq = -1;
  createRoom(0, r.code, r.state);
}
function attach(code){
  selHand = null; inspected = null; flash = '';
  showGame(); render(); startNetWatch();
  try{ location.hash = 'stanza-' + code; }catch{}
}

// L'ospite manda la mossa all'host (con la versione dello stato su cui è fatta) e aspetta lo stato aggiornato: nel frattempo non può fare altro
function sendMove(move){
  if(online.spec) return;	// gli spettatori non giocano
  if(!connected()){ flash = 'Connessione con l’host persa. Usa “Riconnetti” per rientrare.'; render(); return; }
  online.awaiting = true; clearTimeout(online.awaitTimer);
  online.awaitTimer = setTimeout(()=>{ online.awaiting = false; }, 4000);	// (se la risposta non arriva, si sblocca da solo)
  send({type:'move', move, seq: state ? (state.seq||0) : 0});
}
function connected(){ return !!(online.conn && online.conn.open); }
function send(msg){ if(connected()){ try{ online.conn.send(msg); }catch{} } }
function pushOnline(st){
  if(online.host) sendSpecs({type:'state', state:st});
  if(connected()) send({type:'state', state:st});
  else if(online.host && st.status!=='lobby'){ flash = 'L’avversario è disconnesso: riceverà la situazione aggiornata quando rientra con lo stesso codice.'; render(); }
}
function guardOnlineAction(){
  // Il giocatore ospite non può muovere senza connessione: l’host tiene la partita.
  if(mode===Mode.ONLINE && !online.host && !connected()){ flash = 'Connessione con l’host persa. Usa “Riconnetti” per rientrare.'; render(); return false; }
  return true;
}
function lobbyUpdate(patch){
  // usato solo per il cambio mazzo in sala d’attesa
  if(online.host){ broadcast({type:'state', state}); }
  else send({type:'deck', deck: patch.players['s'+mySeat].deck});
}
function seatFromState(){
  const P = state && state.players || {};
  if(P.s0 && P.s0.id===online.myId) return 0;
  if(P.s1 && P.s1.id===online.myId) return 1;
  return null;
}
