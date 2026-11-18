'use strict';
// Controlli sulla struttura del progetto: i tre script (engine.js, net.js, graphics.js) sono script classici che condividono lo stesso ambito globale nel
// browser, quindi devono essere caricati nell'ordine giusto, non dichiarare gli stessi nomi e non avere dipendenze nascoste.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {read, loadGameData} = require('./helpers/net-env.js');

const FILES = ['engine.js', 'ai.js', 'net.js', 'graphics.js'];

test('i file JavaScript hanno una sintassi valida', () => {
  for(const f of FILES) assert.doesNotThrow(() => new vm.Script(read(f), {filename: f}), f);
});
test('index.html carica PeerJS e poi loader.js; loader.js carica i dati e poi engine.js, net.js e graphics.js in quest\'ordine', () => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const idx = f => srcs.findIndex(s => s.endsWith(f));
  assert.ok(idx('peerjs.min.js') >= 0 && idx('peerjs.min.js') < idx('loader.js'), 'PeerJS prima del loader: ' + srcs.join(', '));
  assert.equal(srcs.length, 2, 'gli script del gioco non vanno aggiunti a index.html: li carica loader.js');
  assert.ok(!/<script>[\s\S]*?\S[\s\S]*?<\/script>/.test(html), 'nessuno script inline rimasto in index.html');
  assert.ok(html.includes('id="loadError"'), 'c\'è il posto per il messaggio se i dati non si caricano');
  const loader = read('loader.js');
  const order = ['cards.json', 'decks.json', 'engine.js', 'ai.js', 'net.js', 'graphics.js'].map(f => loader.indexOf("'" + f + "'"));
  assert.ok(order.every(i => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]), 'ordine nel loader: ' + order.join(','));
});
test('cards.json e decks.json: struttura valida e coerente con le regole (frecce, Attributi, mazzi)', () => {
  const cards = JSON.parse(read('cards.json')), decks = JSON.parse(read('decks.json'));
  const E = require('../engine.js');
  for(const [k, c] of Object.entries(cards)){
    assert.match(k, /^\d{8}$/, 'ID della carta = codice a 8 cifre: ' + k);
    assert.equal(typeof c.n, 'string', k + ': nome'); assert.ok(Number.isInteger(c.a) && c.a > 0, k + ': ATK');
    assert.ok(E.ATTR_LABEL[c.at], k + ': Attributo ' + c.at); assert.ok(c.ar.length && c.ar.every(d => E.DIRV[d]), k + ': frecce ' + c.ar);
    assert.equal(c.ar.length, c.l, k + ': tante frecce quanto il Link Rating'); assert.equal(new Set(c.ar).size, c.ar.length, k + ': frecce senza doppioni');
  }
  for(const [k, d] of Object.entries(decks)){
    assert.equal(typeof d.name, 'string', k + ': nome'); assert.equal(new Set(d.cards).size, d.cards.length, k + ': senza doppioni');
    for(const c of d.cards) assert.ok(cards[c], k + ': la carta ' + c + ' esiste in cards.json');
  }
  assert.deepEqual(E.CARDS, cards); assert.deepEqual(E.DECKS, decks);   // il motore usa esattamente questi dati
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
test('net.js non esegue nulla al caricamento (solo dichiarazioni): dipende da graphics.js solo a partita avviata', () => {
  // si carica in un contesto vuoto: se toccasse state, render, $ ecc. al caricamento lancerebbe un errore
  const ctx = vm.createContext({structuredClone, console});
  loadGameData(ctx);
  vm.runInContext(read('engine.js'), ctx);
  assert.doesNotThrow(() => vm.runInContext(read('net.js'), ctx));
});

test('la modalità di gioco si confronta sempre con l\'enum Mode, mai con stringhe scritte a mano', () => {
  for(const f of ['net.js', 'graphics.js']){
    const bad = read(f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\bmode\s*(===|!==|=)\s*'(local|online)'/.test(l));
    assert.deepEqual(bad, [], f + ': ' + bad.map(([n, l]) => n + ': ' + l.trim().slice(0, 60)).join(' | '));
  }
});

test('ogni carta ha la sua illustrazione in img/cards/<ID>.jpg (file locali, nessun collegamento a siti esterni)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const {ROOT} = require('./helpers/net-env.js');
  for(const k of Object.keys(JSON.parse(read('cards.json')))){
    const f = path.join(ROOT, 'img', 'cards', k + '.jpg');
    assert.ok(fs.existsSync(f), 'manca ' + f);
    const b = fs.readFileSync(f); assert.ok(b.length > 2000 && b[0] === 0xff && b[1] === 0xd8, k + '.jpg non è un JPEG valido');
  }
  assert.ok(!/https?:\/\/[^"']*\.(jpg|png)/.test(read('graphics.js')), 'graphics.js non deve puntare a immagini esterne');
});

test('ogni Attributo ha la sua sfera in img/attributes/<NOME>.svg (file locali, con viewBox perché scali)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const {ROOT} = require('./helpers/net-env.js');
  const E = require('../engine.js');
  for(const k of Object.keys(E.ATTR_LABEL)){
    const f = path.join(ROOT, 'img', 'attributes', k + '.svg');
    assert.ok(fs.existsSync(f), 'manca ' + f);
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(/<svg\b/.test(s) && /viewBox="[^"]+"/.test(s.match(/<svg\b[^>]*>/)[0]), k + '.svg: non è un SVG con viewBox');
    assert.ok(!/<script/i.test(s), k + '.svg non deve contenere script');
  }
});

test('animazioni ridotte: la regola @media (prefers-reduced-motion) spegne davvero animazioni e transizioni (parentesi e selettori a posto)', () => {
  const css = read('style.css');
  const m = [...css.matchAll(/@media \(prefers-reduced-motion:reduce\)\{(.*)\}\s*$/gm)].find(x => x[1].includes('.card.spin'));   // (ce ne sono altre, per esempio quella dell'interruttore)
  assert.ok(m, 'regola non trovata');
  const body = m[1];
  assert.match(body, /\.card\.spin[^{}]*\{animation:none\}/, 'le animazioni delle carte sono spente');
  assert.match(body, /\.hcard\{transition:none\}/, 'la transizione della mano è spenta');
  assert.equal((body.match(/\{/g) || []).length, (body.match(/\}/g) || []).length, 'graffe bilanciate dentro la @media');
});

test('loader.js: gli script e i dati si caricano con ?v=VERSION, per non mescolare file vecchi in cache con quelli nuovi', () => {
  const loader = read('loader.js');
  assert.match(loader, /const VERSION = '[^']+'/, 'VERSION definita');
  assert.ok(/url \+ '\?v=' \+ VERSION/.test(loader) && /src \+ '\?v=' \+ VERSION/.test(loader), 'dati e script usano ?v=VERSION');
  assert.doesNotThrow(() => new vm.Script(loader, {filename: 'loader.js'}), 'sintassi valida');
});

test('schermata di caricamento: c’è in index.html (senza JavaScript non resta), ha lo stile e loader.js la nasconde a fine caricamento e in caso di errore', () => {
  const html = read('index.html'), css = read('style.css'), loader = read('loader.js');
  assert.match(html, /<div id="loading"[^>]*role="status"/); assert.match(html, /<noscript><style>#loading\{display:none\}<\/style><\/noscript>/);
  assert.ok(html.indexOf('id="loading"') < html.indexOf('<div class="wrap">'), 'è il primo elemento, prima dell’interfaccia');
  assert.match(css, /#loading\{position:fixed;inset:0;/); assert.match(css, /#loading\.done\{opacity:0/);
  assert.equal((loader.match(/hideLoading\(\)/g) || []).length, 2, 'si nasconde a caricamento finito e in caso di errore');
  assert.match(loader, /Promise\.race\(\[ready, new Promise\(r => setTimeout\(r, MAX_WAIT_MS\)\)\]\)/, 'con un tempo massimo, per non restare bloccata');
});

test('menu "Su questo dispositivo": ogni testo che cambia con la modalità ha le due varianti già nella pagina, sovrapposte, e il JavaScript non ne cambia il contenuto (niente si sposta)', () => {
  const html = read('index.html'), css = read('style.css'), js = read('graphics.js');
  const sec = html.slice(html.indexOf('id="localSection"'), html.indexOf('id="btnLocal"'));
  const count = m => (sec.match(new RegExp(`data-m="${m}"`, 'g')) || []).length;
  assert.ok(count('single') >= 4 && count('single') === count('multi'), `varianti: ${count('single')} singleplayer, ${count('multi')} multiplayer`);
  assert.ok(!/\bhidden\b/.test(sec), 'niente attributo hidden nella sezione: lo spazio resta sempre occupato');
  assert.match(css, /\.swap\{display:grid\}/); assert.match(css, /\.swap>\*\{grid-area:1\/1\}/);
  assert.match(css, /#localSection\[data-mode="single"\] \.swap>\[data-m="multi"\][^{]*\{visibility:hidden\}/);
  assert.match(css, /\.ms-lab\{[^}]*font-weight:600/, 'le etichette dell’interruttore hanno sempre lo stesso peso: cambia solo il colore');
  assert.doesNotMatch(js, /localIntro|lblLd0|lblLd1|rowAiLevel|rowFace/, 'il JavaScript non cambia più i testi del menu');
  assert.match(sec, /id="modeSwitch" role="switch"/); assert.ok(sec.indexOf('data-mode-set="single"') < sec.indexOf('data-mode-set="multi"'), 'Singleplayer è la prima scelta');
});
