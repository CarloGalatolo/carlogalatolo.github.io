'use strict';
// Ambiente per provare graphics.js (l'interfaccia) senza browser: carica i tre file veri (engine.js, net.js, graphics.js) in un contesto isolato con un DOM
// "finto" che si limita a ricordare ciò che gli viene scritto (innerHTML, classi, stili), così i test possono controllare cosa mostrerebbe l'interfaccia.
const vm = require('node:vm');
const {read, loadGameData} = require('./net-env.js');

class FakeEl {
  constructor(id){
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.open = false;
    this.className = ''; this.dataset = {}; this.vars = {}; this.scrolled = 0;
    const cls = new Set(); this._cls = cls;
    this.classList = {
      add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !cls.has(c) : !!on; want ? cls.add(c) : cls.delete(c); return want; }, contains: c => cls.has(c)
    };
    this.style = {setProperty: (k, v) => { this.vars[k] = v; }, removeProperty: k => { delete this.vars[k]; }, getPropertyValue: k => this.vars[k] || ''};
  }
  querySelector(){ return new FakeEl('q'); }
  querySelectorAll(){ return []; }
  addEventListener(){}
  scrollIntoView(){ this.scrolled++; }
  closest(){ return null; }
  appendChild(){}
  get text(){ return this.innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }   // il contenuto senza i tag, per leggerlo nei test
}

function createUiEnv(){
  const els = {};
  const rafQueue = [];
  const document = {
    getElementById: id => els[id] || (els[id] = new FakeEl(id)),
    querySelector: () => new FakeEl('q'), querySelectorAll: () => [], addEventListener(){}, documentElement: new FakeEl('html'), hidden: false,
    fonts: {ready: Promise.resolve()}
  };
  const store = {};
  const ctx = vm.createContext({
    console, structuredClone, document,
    window: {addEventListener(){}, matchMedia: () => ({matches: true}), scrollTo(){}},
    matchMedia: () => ({matches: true}), getComputedStyle: () => ({getPropertyValue: () => '0'}),
    location: {hash: '', pathname: '/', search: ''}, history: {replaceState(){}},
    localStorage: {getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }},
    sessionStorage: {getItem: () => null, setItem(){}},
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    performance: {now: () => Date.now()},
    requestAnimationFrame: f => { rafQueue.push(f); return rafQueue.length; }
  });
  // (niente Peer: initOnline mostra il messaggio "libreria non caricata", che qui non interessa)
  loadGameData(ctx);
  for(const f of ['engine.js', 'net.js', 'graphics.js']) vm.runInContext(read(f), ctx, {filename: f});
  const env = {ctx, els, el: id => document.getElementById(id), flushRaf(){ while(rafQueue.length) rafQueue.shift()(); }};
  env.run = code => vm.runInContext(code, ctx);   // valuta nel contesto (per let/const di graphics.js: state, mode, selHand…)

  // Stato di una partita in corso tra due giocatori (costruito dal motore): turno di `turn`, campo con 5 spazi bloccati
  env.playState = (turn = 0, seq = 10) => {
    const st = ctx.newGame(['alba', 'tramonto']);
    st.status = 'play'; st.turn = turn; st.first = 0; st.pending = null; st.fx = null; st.sfx = null; st.result = null;
    st.setup = {n:5, last:null, pending:null}; st.log = ['x']; st.logCount = 1;
    st.board = Array(25).fill(null); for(const i of [20, 21, 22, 23, 24]) st.board[i] = {x:1};
    st.seq = seq; st.players = {s0:{id:'a', deck:'alba'}, s1:{id:'b', deck:'tramonto'}};
    return st;
  };
  // Imposta le variabili dell'interfaccia e ridisegna
  env.show = ({state, mode = 'local', mySeat = null, selHand = null, inspected = null, spec = false, presence = null, host = false}) => {
    ctx.__s = state;
    env.run(`state = __s; mode = ${JSON.stringify(mode)}; mySeat = ${mySeat}; selHand = ${selHand}; inspected = ${JSON.stringify(inspected)};
      online.spec = ${spec}; online.presence = ${JSON.stringify(presence)}; online.host = ${host}; online.peersOnline = true; flash = '';`);
    ctx.render();
  };
  return env;
}

module.exports = {createUiEnv};
