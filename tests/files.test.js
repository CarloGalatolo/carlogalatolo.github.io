'use strict';
// Controlli sulla struttura del progetto: i tre script (engine.js, net.js, script.js) sono script classici che condividono lo stesso ambito globale nel
// browser, quindi devono essere caricati nell'ordine giusto, non dichiarare gli stessi nomi e non avere dipendenze nascoste.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {read} = require('./helpers/net-env.js');

const FILES = ['engine.js', 'net.js', 'script.js'];

test('i file JavaScript hanno una sintassi valida', () => {
  for(const f of FILES) assert.doesNotThrow(() => new vm.Script(read(f), {filename: f}), f);
});
test('index.html carica engine.js, net.js e script.js in quest\'ordine, dopo PeerJS', () => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const idx = f => srcs.findIndex(s => s.endsWith(f));
  assert.ok(idx('peerjs.min.js') >= 0 && idx('peerjs.min.js') < idx('engine.js'), 'PeerJS prima degli script del gioco');
  assert.ok(idx('engine.js') >= 0 && idx('engine.js') < idx('net.js') && idx('net.js') < idx('script.js'), 'ordine: ' + srcs.join(', '));
  assert.ok(!/<script>[\s\S]*?\S[\s\S]*?<\/script>/.test(html), 'nessuno script inline rimasto in index.html');
});
test('nessun nome di primo livello è dichiarato in più di un file (in un browser sarebbe un errore)', () => {
  const seen = new Map();
  for(const f of FILES){
    for(const line of read(f).split('\n')){
      const m = line.match(/^(?:async\s+)?(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/);
      if(!m) continue;
      assert.ok(!seen.has(m[1]) || seen.get(m[1]) === f, `${m[1]} è dichiarato in ${seen.get(m[1])} e in ${f}`);
      seen.set(m[1], f);
    }
  }
  assert.ok(seen.size > 100);
});
test('il motore non tocca il browser: niente DOM, rete o archiviazione', () => {
  const src = read('engine.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  for(const forbidden of ['document.', 'window.', 'localStorage', 'sessionStorage', 'Peer(', 'setTimeout', 'setInterval', 'fetch(', 'location.'])
    assert.ok(!src.includes(forbidden), 'engine.js usa ' + forbidden);
});
test('net.js non esegue nulla al caricamento (solo dichiarazioni): dipende da script.js solo a partita avviata', () => {
  // si carica in un contesto vuoto: se toccasse state, render, $ ecc. al caricamento lancerebbe un errore
  const ctx = vm.createContext({structuredClone, console});
  vm.runInContext(read('engine.js'), ctx);
  assert.doesNotThrow(() => vm.runInContext(read('net.js'), ctx));
});
