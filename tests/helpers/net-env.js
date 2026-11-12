'use strict';
// Ambiente per testare net.js senza browser né rete: carica i file veri (engine.js e net.js) in un contesto isolato, con un "browser finto"
// (PeerJS, timer, localStorage, DOM minimo) e quello che net.js si aspetta da graphics.js (state, mode, render, commit…).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');
// Nel browser i dati (cards.json, decks.json) li prepara loader.js in GAME_DATA prima di caricare engine.js: qui si fa lo stesso (rileggendoli nel contesto,
// così oggetti e array sono dello stesso "mondo" del codice che li usa)
const loadGameData = ctx => vm.runInContext(`var GAME_DATA = {cards: ${read('cards.json')}, decks: ${read('decks.json')}};`, ctx, {filename: 'GAME_DATA'});

// Tutto ciò che i test devono raggiungere da fuori è dichiarato con `var`/`function` (diventa proprietà del contesto).
const PRELUDE = `
var state = null, mode = null, mySeat = null, flash = '', selHand = null, inspected = null, renders = 0;
var els = {};
function $(id){ return els[id] || (els[id] = {disabled:false, textContent:'', hidden:false, innerHTML:'', value:'alba'}); }
var esc = s => String(s);
function render(){ renders++; }
function showGame(){}
function exitToMenu(){ mode = null; state = null; }
var location = {hash:''};
var store = {};
var localStorage = {getItem:k => (k in store ? store[k] : null), setItem:(k, v) => { store[k] = String(v); }, removeItem:k => { delete store[k]; }};
var sessionStorage = {getItem:() => null, setItem(){}};
var peers = [];
var Peer = class Peer {
  constructor(id){ this.id = id; this.h = {}; this.disconnected = false; this.destroyed = false; this.conns = []; peers.push(this); }
  on(e, f){ (this.h[e] = this.h[e] || []).push(f); }
  emit(e, ...a){ (this.h[e] || []).forEach(f => f(...a)); }
  reconnect(){ this.reconnects = (this.reconnects || 0) + 1; }
  destroy(){ this.destroyed = true; this.emit('close'); }
  connect(){ const c = new Conn(); c.open = false; this.conns.push(c); return c; }
};
var Conn = class Conn {
  constructor(){ this.h = {}; this.open = true; this.sent = []; }
  on(e, f){ (this.h[e] = this.h[e] || []).push(f); }
  emit(e, ...a){ (this.h[e] = this.h[e] || []).forEach(f => f(...a)); }
  send(m){ this.sent.push(m); }
  close(){ if(this.open){ this.open = false; this.emit('close'); } }
};
var timeouts = [], intervals = [], fakeNow = 1e6;
function setTimeout(f, ms){ const t = {f, ms, done:false}; timeouts.push(t); return t; }
function clearTimeout(t){ if(t && typeof t === 'object') t.done = true; }
function setInterval(f){ intervals.push(f); return intervals.length; }
function clearInterval(){}
Date.now = () => fakeNow;
// esegue (una volta) l'ultimo timer in attesa che soddisfa pred; false se non ce n'è
function fire(pred){ const t = timeouts.filter(x => !x.done && pred(x)).pop(); if(!t) return false; t.done = true; t.f(); return true; }
function pending(pred){ return timeouts.some(x => !x.done && pred(x)); }
function lastPeer(){ return peers[peers.length - 1]; }
`;

// Copia semplificata di commit() di graphics.js (l'originale disegna anche l'interfaccia): applica fn a una copia dello stato, alza seq e, online, lo invia.
const COMMIT = `
function commit(fn){
  if(!state) return;
  if(!guardOnlineAction()) return;
  const st = structuredClone(state);
  st.sfx = null;
  if(fn(st)===false) return;
  st.seq = (state.seq||0) + 1;
  state = st; selHand = null;
  render();
  if(mode==='online') pushOnline(st);
}
`;

function createNetEnv(){
  const ctx = vm.createContext({console, structuredClone});
  vm.runInContext(PRELUDE, ctx, {filename: 'prelude'});
  loadGameData(ctx);
  vm.runInContext(read('engine.js'), ctx, {filename: 'engine.js'});
  vm.runInContext(COMMIT, ctx, {filename: 'commit'});
  vm.runInContext(read('net.js'), ctx, {filename: 'net.js'});
  vm.runInContext('var __online = online; var __C = {TAKEOVER_MS, JOIN_TRIES, PING_MS, DEAD_MS, ONLINE_NOTE, ROOM_KEY, GUEST_KEY, SPEC_CLOSE_MS, MAX_SPECS};', ctx);
  const env = {ctx, online: ctx.__online, C: ctx.__C};
  env.online.myId = 'host-1';
  env.run = code => vm.runInContext(code, ctx);   // valuta un'espressione nel contesto (per ciò che è `const`, come Mode)
  env.peers = ctx.peers;
  env.lastPeer = () => ctx.peers[ctx.peers.length - 1];
  env.fire = pred => ctx.fire(pred);
  env.pending = pred => ctx.pending(pred);
  env.conn = () => new ctx.Conn();

  // Stato di una partita in corso (vero, costruito dal motore) tra host-1 (posto 1) e guest-A (posto 2)
  env.playState = (opts = {}) => {
    const st = ctx.newGame(['alba', 'tramonto']);
    st.status = 'play'; st.turn = opts.turn ?? 0; st.first = 0; st.pending = null; st.fx = null; st.sfx = null; st.result = null;
    st.setup = {n:5, last:null, pending:null}; st.log = ['x']; st.logCount = 1;
    st.board = Array(25).fill(null); for(const i of [20, 21, 22, 23, 24]) st.board[i] = {x:1};
    st.v = 1; st.code = 'ROOMX'; st.seq = opts.seq ?? 10;
    st.players = {s0:{id:'host-1', deck:'alba'}, s1:{id:'guest-A', deck:'tramonto'}};
    return st;
  };
  // Crea la stanza come host e la apre; restituisce il Peer
  env.hostRoom = () => { ctx.createRoom(); const p = env.lastPeer(); p.emit('open'); return p; };
  // Un ospite si collega all'host: connessione + saluto. Restituisce la connessione (lato host)
  env.guestHello = (peer, id, deck = 'tramonto', state = null) => {
    const c = env.conn(); peer.emit('connection', c);
    c.emit('data', {type:'hello', id, deck, state});
    return c;
  };
  // Mette questo browser nel ruolo di ospite (posto 2) collegato a un host, con lo stato indicato. Restituisce {peer, conn}
  env.asGuest = st => {
    ctx.state = st; ctx.mode = 'online'; ctx.mySeat = 1; ctx.flash = '';
    Object.assign(env.online, {host:false, myId:'guest-A', code:'ROOMX', peersOnline:false, signal:null, hostLeft:false, conn:null, awaiting:false});
    const peer = new ctx.Peer(); env.online.peer = peer;
    ctx.guestConnect();   // registra i gestori come nel gioco
    const conn = peer.conns[peer.conns.length - 1]; conn.open = true; conn.emit('open');
    conn.emit('data', {type:'state', state: st, force:true});
    return {peer, conn};
  };
  return env;
}

module.exports = {createNetEnv, read, loadGameData, ROOT};
