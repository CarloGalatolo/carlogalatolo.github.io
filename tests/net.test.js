'use strict';
// Test della parte online (net.js) con un PeerJS finto: stanza, host e ospite, riconnessioni, ping, ripresa della stanza, passaggio dell'host
// e protocollo a mosse (l'ospite manda solo la mossa, la calcola l'host con il motore).
const test = require('node:test');
const assert = require('node:assert/strict');
const {createNetEnv} = require('./helpers/net-env.js');

const lastSent = conn => conn.sent[conn.sent.length - 1];

// ============================================================ host
test('host: crea la stanza e vede entrare un ospite', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const peer = env.hostRoom();
  assert.equal(ctx.state.status, 'lobby'); assert.equal(ctx.state.code, 'ABCDE' === ctx.state.code ? ctx.state.code : ctx.state.code);
  assert.equal(online.signal, true); assert.equal(ctx.mySeat, 0);
  const c = env.guestHello(peer, 'guest-1', 'alba');
  assert.equal(ctx.state.players.s1.id, 'guest-1');
  assert.equal(online.peersOnline, true);
  assert.ok(c.sent.some(m => m.type === 'state' && m.state.players.s1));
});
test('host: se il collegamento col server cade e si ristabilisce, la stanza NON si azzera', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const peer = env.hostRoom();
  env.guestHello(peer, 'guest-1');
  const seq = ctx.state.seq;
  peer.disconnected = true; peer.emit('disconnected');
  assert.equal(online.signal, false); assert.ok(peer.reconnects >= 1, 'prova a ricollegarsi');
  peer.disconnected = false; peer.emit('open');
  assert.equal(ctx.state.players.s1.id, 'guest-1', 'l\'ospite è ancora al suo posto');
  assert.equal(ctx.state.seq, seq); assert.equal(online.signal, true);
});
test('host: collegamento col server chiuso del tutto -> stanza ricreata con lo stesso codice e lo stesso stato', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const peer = env.hostRoom(); const code = ctx.state.code;
  env.guestHello(peer, 'guest-4');
  peer.emit('close');
  assert.equal(online.signal, false);
  assert.ok(env.pending(t => t.ms === 1500), 'la ricreazione è programmata');
  const before = env.peers.length;
  ctx.createRoom(0, code);   // ciò che farebbe il timer
  env.lastPeer().emit('open');
  assert.equal(env.peers.length, before + 1);
  assert.equal(ctx.state.code, code); assert.equal(ctx.state.players.s1.id, 'guest-4');
});
test('host: posto dell\'ospite — si libera in sala d\'attesa, un altro può entrare, un terzo viene respinto, lo stesso ospite lo riprende', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const peer = env.hostRoom();
  const c1 = env.guestHello(peer, 'guest-1');
  c1.close();
  assert.equal(ctx.state.players.s1, null, 'posto libero dopo che l\'ospite se ne va');
  assert.equal(online.peersOnline, false);
  const c2 = env.guestHello(peer, 'guest-2', 'tramonto');
  assert.equal(ctx.state.players.s1.id, 'guest-2'); assert.equal(online.conn, c2);
  const c3 = env.guestHello(peer, 'guest-3');
  assert.ok(c3.sent.some(m => m.type === 'full'), 'terzo ospite respinto con "stanza piena"');
  assert.equal(ctx.state.players.s1.id, 'guest-2');
  const c2b = env.guestHello(peer, 'guest-2', 'tramonto');
  assert.equal(online.conn, c2b); assert.ok(!c2b.sent.some(m => m.type === 'full'), 'lo stesso ospite riprende il suo posto');
  assert.equal(c2.open, false, 'la vecchia connessione viene chiusa'); assert.equal(ctx.state.players.s1.id, 'guest-2'); assert.equal(online.peersOnline, true);
});
test('host: ping dell\'ospite -> pong; connessione senza risposte per troppo tempo -> considerata morta e posto liberato', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  const peer = env.hostRoom();
  const c = env.guestHello(peer, 'guest-4');
  c.emit('data', {type:'ping'});
  assert.ok(c.sent.some(m => m.type === 'pong'));
  ctx.startNetWatch();
  ctx.fakeNow += C.DEAD_MS + 1000;
  ctx.intervals.forEach(f => f());
  assert.equal(c.open, false); assert.equal(online.peersOnline, false);
  assert.equal(ctx.state.players.s1, null);
});

// ============================================================ ospite
test('ospite: stanza non trovata -> riprova da solo; poi saluto, stato, menu ripulito', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  online.myId = 'guest-A';
  ctx.$('joinCode').value = 'ROOMX'; ctx.$('od').value = 'tramonto';
  ctx.joinRoom();
  const peer = env.lastPeer(); peer.emit('open');
  assert.equal(peer.conns.length, 1);
  peer.emit('error', {type:'peer-unavailable'});
  assert.equal(ctx.$('menuErr').textContent, ''); assert.match(ctx.$('onlineNote').textContent, /riprovo/); assert.equal(ctx.$('btnJoin').disabled, true);
  env.fire(t => t.ms === 2500);
  assert.equal(peer.conns.length, 2, 'secondo tentativo');
  const c = peer.conns[1]; c.open = true; c.emit('open');
  assert.ok(c.sent.some(m => m.type === 'hello' && m.id === 'guest-A' && m.deck === 'tramonto'));
  c.emit('data', {type:'state', state: env.playState({turn:0})});
  assert.equal(ctx.mode, 'online'); assert.equal(ctx.mySeat, 1);
  assert.equal(ctx.$('btnJoin').disabled, false); assert.equal(ctx.$('onlineNote').textContent, C.ONLINE_NOTE);
  const hellos = c.sent.filter(m => m.type === 'hello').length;
  ctx.intervals.forEach(f => f());
  assert.equal(c.sent.filter(m => m.type === 'hello').length, hellos, 'dopo lo stato il saluto non si ripete');
  c.emit('data', {type:'ping'}); assert.ok(c.sent.some(m => m.type === 'pong'));
});
test('ospite: se l\'host non risponde subito il saluto si ripete', () => {
  const env = createNetEnv(), {ctx, online} = env;
  online.myId = 'guest-A'; online.code = 'ROOMX'; online.host = false; ctx.mode = null;
  const peer = new ctx.Peer(); online.peer = peer;
  ctx.guestConnect();
  const c = peer.conns[0]; c.open = true; c.emit('open');
  const n = c.sent.length;
  ctx.intervals.slice(-1)[0]();
  assert.ok(c.sent.length > n);
});
test('ospite: connessione persa in partita -> si ricollega da solo e al ritorno risaluta con lo stesso id', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const {peer, conn} = env.asGuest(env.playState({turn:0}));
  conn.close();
  assert.equal(online.peersOnline, false); assert.match(ctx.flash, /ricollegarmi/);
  const before = peer.conns.length;
  env.fire(t => t.ms < 11000 && t.ms !== env.C.TAKEOVER_MS);   // il tentativo automatico
  assert.equal(peer.conns.length, before + 1);
  const c2 = peer.conns[peer.conns.length - 1]; c2.open = true; c2.emit('open');
  assert.ok(c2.sent.some(m => m.type === 'hello' && m.id === 'guest-A')); assert.equal(online.conn, c2);
  c2.emit('data', {type:'state', state: env.playState({turn:0, seq:11})});
  assert.equal(ctx.state.seq, 11); assert.equal(ctx.flash, '');
});
test('ospite: stanza piena -> errore chiaro e pulsante riabilitato', () => {
  const env = createNetEnv(), {ctx, online} = env;
  online.code = 'ROOMX'; online.host = false; ctx.mode = null; ctx.$('btnJoin').disabled = true;
  const peer = new ctx.Peer(); online.peer = peer; ctx.guestConnect();
  const c = peer.conns[0]; c.open = true; c.emit('open');
  c.emit('data', {type:'full'});
  assert.equal(ctx.$('menuErr').textContent, 'La stanza è già piena.'); assert.equal(ctx.$('btnJoin').disabled, false);
});
test('ospite: dopo troppi tentativi falliti si arrende con un messaggio', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  ctx.mode = null; ctx.$('btnJoin').disabled = true; online.peer = new ctx.Peer();
  for(let i = 0; i < C.JOIN_TRIES + 1 && online.peer; i++) ctx.joinFailed('La stanza non risponde.');
  assert.equal(ctx.$('menuErr').textContent, 'La stanza non risponde.'); assert.equal(ctx.$('btnJoin').disabled, false);
});

// ============================================================ salvataggio e ripresa della stanza
test('ripresa: la stanza si salva (senza dati di animazione) e dopo un ricaricamento si riprende con lo stesso stato', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const peer = env.hostRoom();
  env.guestHello(peer, 'guest-1');
  ctx.state = Object.assign(ctx.state, env.playState({seq: ctx.state.seq + 5}), {code: ctx.state.code});
  ctx.state.players = {s0:{id:'host-1', deck:'alba'}, s1:{id:'guest-1', deck:'tramonto'}};
  ctx.state.fx = {placed:3, attacks:[]};
  ctx.saveRoom();
  const saved = JSON.parse(ctx.localStorage.getItem('linkgrid-room'));
  assert.equal(saved.hostId, 'host-1'); assert.equal(saved.state.status, 'play');
  assert.ok(!('fx' in saved.state) && !('sfx' in saved.state));
  const at = saved.at; ctx.saveRoom();
  assert.equal(JSON.parse(ctx.localStorage.getItem('linkgrid-room')).at, at, 'senza cambiamenti non si riscrive');
  // ricaricamento: si perde tutto in memoria
  ctx.state = null; ctx.mode = null; ctx.mySeat = null; Object.assign(online, {peer:null, conn:null, host:false, peersOnline:false, code:null, myId:'altro-id'});
  ctx.showResume();
  assert.equal(ctx.$('resumeBox').hidden, false); assert.match(ctx.$('resumeBox').innerHTML, new RegExp(saved.code));
  ctx.resumeRoom();
  assert.equal(online.myId, 'host-1', 'stesso id di prima');
  const p2 = env.lastPeer(); assert.equal(p2.id, 'linkgrid-v1-' + saved.code.toLowerCase());
  p2.emit('error', {type:'unavailable-id'});   // il server non ha ancora liberato l'id
  assert.match(ctx.$('onlineNote').textContent, /riprovo/); assert.equal(ctx.mode, null);
  env.fire(t => t.ms === 3000);
  env.lastPeer().emit('open');
  assert.equal(ctx.mode, 'online'); assert.equal(online.host, true); assert.equal(ctx.mySeat, 0);
  assert.equal(ctx.state.status, 'play'); assert.equal(ctx.state.players.s1.id, 'guest-1'); assert.equal(ctx.state.fx, null);
  const cg = env.guestHello(env.lastPeer(), 'guest-1');
  assert.ok(!cg.sent.some(m => m.type === 'full')); assert.equal(online.conn, cg);
});
test('ripresa: un posto lasciato si può riprendere a partita iniziata; il mazzo non cambia; "Dimentica" e salvataggi scaduti o corrotti', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const peer = env.hostRoom(); const code = ctx.state.code;
  const c1 = env.guestHello(peer, 'guest-1');
  ctx.state = Object.assign(ctx.state, env.playState({seq: ctx.state.seq + 1}), {code});
  ctx.state.players = {s0:{id:'host-1', deck:'alba'}, s1:{id:'guest-1', deck:'tramonto'}};
  c1.close();
  const cn = env.guestHello(peer, 'guest-NEW', 'alba');
  assert.equal(ctx.state.players.s1.id, 'guest-NEW', 'posto lasciato: riprendibile');
  assert.equal(ctx.state.players.s1.deck, 'tramonto', 'il mazzo del posto non cambia a partita iniziata');
  const c3 = env.guestHello(peer, 'guest-3');
  assert.ok(c3.sent.some(m => m.type === 'full'), 'posto occupato da uno collegato: respinto'); assert.equal(online.conn, cn);
  ctx.saveRoom(); ctx.forgetRoom();
  assert.equal(ctx.localStorage.getItem('linkgrid-room'), null); assert.equal(ctx.$('resumeBox').hidden, true);
  ctx.localStorage.setItem('linkgrid-room', JSON.stringify({at: ctx.fakeNow - 25 * 3600 * 1000, code:'OLD11', hostId:'x', state:{status:'play'}}));
  ctx.showResume(); assert.equal(ctx.$('resumeBox').hidden, true, 'più vecchio di 24 ore: ignorato');
  ctx.localStorage.setItem('linkgrid-room', '{rotto'); ctx.showResume(); assert.equal(ctx.$('resumeBox').hidden, true, 'corrotto: ignorato');
});

// ============================================================ passaggio dell'host
test('passaggio host: l\'ospite perde l\'host e dopo il tempo previsto crea la stanza, tenendo posto e partita', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  const {conn} = env.asGuest(env.playState({turn:0}));
  conn.close();
  assert.match(ctx.flash, /ricollegarmi/); assert.ok(env.pending(t => t.ms === C.TAKEOVER_MS), 'passaggio programmato');
  assert.equal(online.host, false, 'prima di quel momento resta ospite');
  env.fire(t => t.ms === C.TAKEOVER_MS);
  const hp = env.lastPeer();
  assert.equal(hp.id, 'linkgrid-v1-roomx'); assert.equal(online.host, true);
  hp.emit('open');
  assert.equal(ctx.mySeat, 1); assert.equal(ctx.state.status, 'play'); assert.equal(ctx.state.seq, 10);
  assert.match(ctx.flash, /ora l’host sei tu/); assert.equal(online.signal, true);
});
test('passaggio host: l\'ex host rientra al suo posto; il suo stato più recente si adotta solo se valido', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  const {conn} = env.asGuest(env.playState({turn:0}));
  conn.close(); env.fire(t => t.ms === C.TAKEOVER_MS); const hp = env.lastPeer(); hp.emit('open');
  const c2 = env.guestHello(hp, 'host-1', 'alba', env.playState({turn:0}));
  assert.ok(online.conn === c2 && !c2.sent.some(m => m.type === 'full'), 'rientra al posto 0, non respinto');
  assert.ok(c2.sent.some(m => m.type === 'state' && m.force === true));
  // ha giocato offline nel suo turno (turno 0): adottato
  c2.emit('data', {type:'hello', id:'host-1', deck:'alba', state: Object.assign(env.playState({seq:13}), {turn:1, log:['mossa offline']})});
  assert.equal(ctx.state.seq, 13); assert.equal(ctx.state.log[0], 'mossa offline');
  // uno stato "più recente" ma non possibile (era il turno del nuovo host): rifiutato
  c2.emit('data', {type:'hello', id:'host-1', deck:'alba', state: Object.assign(env.playState({seq:20}), {turn:0, log:['finto']})});
  assert.equal(ctx.state.seq, 13); assert.notEqual(ctx.state.log[0], 'finto');
});
test('passaggio host: un host al posto 2 accetta le mosse dell\'altro solo nel turno di quello', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  const {conn} = env.asGuest(env.playState({turn:0}));
  conn.close(); env.fire(t => t.ms === C.TAKEOVER_MS); const hp = env.lastPeer(); hp.emit('open');
  const c2 = env.guestHello(hp, 'host-1', 'alba');
  const hi = 0, cell = 12;
  c2.emit('data', {type:'move', move:{t:'place', hi, i:cell}, seq: ctx.state.seq});
  assert.ok(ctx.state.board[cell] && ctx.state.board[cell].c === 0, 'mossa del Giocatore 1 nel suo turno: applicata');
  const seq = ctx.state.seq;
  c2.emit('data', {type:'move', move:{t:'place', hi:0, i:13}, seq});
  assert.equal(ctx.state.board[13], null, 'ora tocca a me (posto 2): la mossa fuori turno è rifiutata');
  assert.equal(lastSent(c2).force, true);
});
test('passaggio host: "bye" -> il passaggio è quasi immediato', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const {conn} = env.asGuest(env.playState({turn:0}));
  conn.emit('data', {type:'bye'});
  assert.equal(online.hostLeft, true); assert.ok(env.pending(t => t.ms === 1500));
  conn.close();
  assert.ok(env.pending(t => t.ms === 800));
  env.fire(t => t.ms === 800);
  assert.equal(online.host, true); assert.equal(env.lastPeer().id, 'linkgrid-v1-roomx');
});
test('passaggio host: codice ancora occupato -> dopo qualche tentativo torna a cercare l\'host come ospite, senza creare un\'altra stanza', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  const {conn} = env.asGuest(env.playState({turn:0}));
  conn.close(); env.fire(t => t.ms === C.TAKEOVER_MS);
  for(let i = 0; i < 6 && online.host; i++){ env.lastPeer().emit('error', {type:'unavailable-id'}); env.fire(t => t.ms === 3000); }
  assert.equal(online.host, false); assert.match(ctx.flash, /già un host/);
  assert.ok(env.pending(t => t.ms === C.TAKEOVER_MS), 'riproverà più tardi');
  assert.ok(env.peers.every(p => !p.id || p.id === 'linkgrid-v1-roomx'), 'mai una stanza con un codice diverso');
});
test('passaggio host: in sala d\'attesa chi resta diventa il Giocatore 1 e l\'ex host rientra come Giocatore 2', () => {
  const env = createNetEnv(), {ctx, online, C} = env;
  const lobby = {v:1, seq:4, code:'ROOMX', status:'lobby', players:{s0:{id:'host-1', deck:'alba'}, s1:{id:'guest-A', deck:'tramonto'}}, log:[]};
  const {conn} = env.asGuest(lobby);
  conn.close(); env.fire(t => t.ms === C.TAKEOVER_MS); env.lastPeer().emit('open');
  assert.equal(ctx.mySeat, 0); assert.equal(ctx.state.players.s0.id, 'guest-A'); assert.equal(ctx.state.players.s0.deck, 'tramonto'); assert.equal(ctx.state.players.s1, null);
  env.guestHello(env.lastPeer(), 'host-1', 'alba');
  assert.equal(ctx.state.players.s1.id, 'host-1'); assert.equal(online.peersOnline, true);
});
test('passaggio host: un ex host rimasto aperto, trovando il codice preso, rientra come ospite senza perdere lo stato', () => {
  const env = createNetEnv(), {ctx, online} = env;
  ctx.state = env.playState({seq:30}); ctx.mode = 'online'; ctx.mySeat = 0;
  Object.assign(online, {host:true, myId:'host-1', code:'ROOMX', conn:null, peersOnline:false, peer:new ctx.Peer('linkgrid-v1-roomx')});
  ctx.createRoom(0, 'ROOMX', null, false);
  for(let i = 0; i < 6 && online.host; i++){ env.lastPeer().emit('error', {type:'unavailable-id'}); env.fire(t => t.ms === 3000); }
  assert.equal(online.host, false); assert.equal(ctx.state.seq, 30); assert.equal(ctx.mySeat, 0);
});
test('passaggio host: "Riprendi la stanza" dal menu quando l\'altro ne è già l\'host -> si entra come ospite col proprio stato', () => {
  const env = createNetEnv(), {ctx, online} = env;
  ctx.localStorage.setItem('linkgrid-room', JSON.stringify({at: ctx.fakeNow, code:'ROOMX', hostId:'host-1', state: env.playState({seq:40})}));
  ctx.resumeRoom();
  for(let i = 0; i < 6 && ctx.$('joinCode').value !== 'ROOMX'; i++){ env.lastPeer().emit('error', {type:'unavailable-id'}); env.fire(t => t.ms === 3000); }
  assert.equal(ctx.$('joinCode').value, 'ROOMX'); assert.equal(online.host, false); assert.equal(online.myId, 'host-1');
  assert.equal(online.pendingState.seq, 40, 'il proprio stato accompagna il saluto');
});

// ============================================================ protocollo a mosse (l'ospite non manda mai uno stato)
function hostWithGuest(env, turn){
  const {ctx} = env;
  const peer = env.hostRoom();
  const c = env.guestHello(peer, 'guest-A');
  const st = env.playState({turn, seq: ctx.state.seq + 1});
  st.code = ctx.state.code; st.players = {s0:{id:'host-1', deck:'alba'}, s1:{id:'guest-A', deck:'tramonto'}};
  ctx.state = st;
  return {peer, c};
}
test('mosse: una mossa valida dell\'ospite nel suo turno viene calcolata dall\'host e lo stato aggiornato torna all\'ospite', () => {
  const env = createNetEnv(), {ctx} = env;
  const {c} = hostWithGuest(env, 1);
  const seq = ctx.state.seq, card = ctx.state.hands[1][0];
  c.emit('data', {type:'move', move:{t:'place', hi:0, i:12}, seq});
  assert.ok(ctx.state.board[12] && ctx.state.board[12].k === card, 'la carta è in campo');
  assert.equal(ctx.state.board[12].c, 1); assert.equal(ctx.state.seq, seq + 1);
  const m = lastSent(c);
  assert.equal(m.type, 'state'); assert.equal(m.state.seq, seq + 1); assert.ok(m.state.fx && m.state.fx.placed === 12, 'lo stato porta i dati di animazione');
  assert.equal(ctx.state.turn, 0, 'il turno passa all\'host');
});
test('mosse: mosse non valide non cambiano nulla e l\'ospite viene riallineato', () => {
  const env = createNetEnv(), {ctx} = env;
  const {c} = hostWithGuest(env, 1);
  const bad = [
    {t:'place', hi:0, i:99}, {t:'place', hi:0, i:-1}, {t:'place', hi:0, i:20 /* bloccata */}, {t:'place', hi:9, i:12}, {t:'place', hi:'0', i:12},
    {t:'place', hi:0, i:1.5}, {t:'target', i:3}, {t:'setup', k:2}, {t:'boh'}, null, 5, {},
  ];
  for(const mv of bad){
    const before = JSON.stringify(ctx.state), n = c.sent.length;
    c.emit('data', {type:'move', move: mv, seq: ctx.state.seq});
    assert.equal(JSON.stringify(ctx.state), before, 'stato invariato per ' + JSON.stringify(mv));
    assert.equal(lastSent(c).force, true, 'riallineamento dopo ' + JSON.stringify(mv)); assert.ok(c.sent.length > n);
  }
});
test('mosse: una mossa fuori turno viene rifiutata', () => {
  const env = createNetEnv(), {ctx} = env;
  const {c} = hostWithGuest(env, 0);   // tocca all'host
  const before = JSON.stringify(ctx.state);
  c.emit('data', {type:'move', move:{t:'place', hi:0, i:12}, seq: ctx.state.seq});
  assert.equal(JSON.stringify(ctx.state), before);
  assert.equal(lastSent(c).force, true);
});
test('mosse: una mossa fatta su uno stato non aggiornato (seq diverso) viene rifiutata e si rimanda lo stato giusto', () => {
  const env = createNetEnv(), {ctx} = env;
  const {c} = hostWithGuest(env, 1);
  const before = JSON.stringify(ctx.state);
  c.emit('data', {type:'move', move:{t:'place', hi:0, i:12}, seq: ctx.state.seq - 1});
  assert.equal(JSON.stringify(ctx.state), before);
  assert.equal(lastSent(c).force, true); assert.equal(lastSent(c).state.seq, ctx.state.seq);
});
test('mosse: l\'ospite non può imporre uno stato: i messaggi "state" dell\'ospite vengono ignorati', () => {
  const env = createNetEnv(), {ctx} = env;
  const {c} = hostWithGuest(env, 1);
  const before = JSON.stringify(ctx.state);
  const fake = env.playState({turn:0, seq: ctx.state.seq + 50}); fake.log = ['barare']; fake.code = ctx.state.code;
  c.emit('data', {type:'state', state: fake});
  assert.equal(JSON.stringify(ctx.state), before);
  assert.equal(lastSent(c).force, true);
});
test('mosse: solo la connessione dell\'ospite collegato può muovere', () => {
  const env = createNetEnv(), {ctx} = env;
  const {peer} = hostWithGuest(env, 1);
  const stranger = env.conn(); peer.emit('connection', stranger);   // non ha ancora salutato
  const before = JSON.stringify(ctx.state);
  stranger.emit('data', {type:'move', move:{t:'place', hi:0, i:12}, seq: ctx.state.seq});
  assert.equal(JSON.stringify(ctx.state), before);
});
test('mosse (ospite): sendMove manda mossa e versione dello stato e blocca altre mosse finché non torna lo stato dell\'host', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const {conn} = env.asGuest(env.playState({turn:1}));
  ctx.sendMove({t:'place', hi:0, i:12});
  const m = lastSent(conn);
  assert.equal(m.type, 'move'); assert.deepEqual(JSON.parse(JSON.stringify(m.move)), {t:'place', hi:0, i:12}); assert.equal(m.seq, ctx.state.seq);
  assert.equal(online.awaiting, true);
  conn.emit('data', {type:'state', state: env.playState({turn:0, seq: ctx.state.seq + 1})});
  assert.equal(online.awaiting, false, 'lo stato dell\'host sblocca');
  ctx.sendMove({t:'place', hi:0, i:13}); assert.equal(online.awaiting, true);
  env.fire(t => t.ms === 4000);
  assert.equal(online.awaiting, false, 'se la risposta non arriva, si sblocca da solo');
});
test('mosse (ospite): senza connessione non invia nulla e avvisa', () => {
  const env = createNetEnv(), {ctx, online} = env;
  const {conn} = env.asGuest(env.playState({turn:1}));
  conn.open = false;
  const n = conn.sent.length;
  ctx.sendMove({t:'place', hi:0, i:12});
  assert.equal(conn.sent.length, n); assert.match(ctx.flash, /Connessione con l’host persa/); assert.equal(online.awaiting, false);
});
test('mosse (ospite): lo stato dell\'host con force sostituisce quello locale anche se ha un seq più basso', () => {
  const env = createNetEnv(), {ctx} = env;
  const {conn} = env.asGuest(env.playState({turn:1, seq:20}));
  conn.emit('data', {type:'state', state: env.playState({turn:1, seq:15}), force:true});
  assert.equal(ctx.state.seq, 15);
  conn.emit('data', {type:'state', state: env.playState({turn:1, seq:10})});
  assert.equal(ctx.state.seq, 15, 'senza force uno stato più vecchio viene scartato');
});

// ============================================================ enum Mode
test('Mode: valori, nome sbagliato che lancia un errore, enumerazione non modificabile', () => {
  const env = createNetEnv();
  assert.equal(env.run('Mode.LOCAL'), 'local'); assert.equal(env.run('Mode.ONLINE'), 'online');
  assert.equal(env.run('Object.keys(Mode).join(",")'), 'LOCAL,ONLINE');
  assert.throws(() => env.run('Mode.ONLIN'), /Mode\.ONLIN non esiste/, 'un refuso non diventa un silenzioso undefined');
  assert.throws(() => env.run('Mode.LOCAL = "x"'), /enumerazione/);
  assert.throws(() => env.run('Mode.NUOVO = "x"'), /enumerazione/);
  assert.throws(() => env.run('delete Mode.LOCAL'), /enumerazione/);
  assert.equal(env.run('Mode.LOCAL'), 'local', 'invariata dopo i tentativi di modifica');
  assert.equal(env.run('JSON.stringify(Mode)'), '{"LOCAL":"local","ONLINE":"online"}', 'serializzabile (toJSON non dà errore)');
});
test('Mode: confronti con i valori stringa di prima continuano a funzionare', () => {
  const env = createNetEnv();
  env.ctx.mode = 'online';
  assert.equal(env.run('mode === Mode.ONLINE'), true);
  env.ctx.mode = null;
  assert.equal(env.run('mode === Mode.ONLINE || mode === Mode.LOCAL'), false, 'null = menu');
});
