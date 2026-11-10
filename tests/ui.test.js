'use strict';
// Test dell'interfaccia (graphics.js) con un DOM finto: cosa mostrano il riquadro di stato, la sala d'attesa, i dettagli carta e la mano nelle varie situazioni
// (turno, preparazione, fine partita, spettatore). Non provano l'aspetto (CSS): solo i testi, le classi e le variabili di colore che il codice produce.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createUiEnv} = require('./helpers/ui-env.js');

test('graphics.js si carica con il DOM finto e la home viene preparata (mazzi, regole)', () => {
  const env = createUiEnv();
  assert.match(env.el('deckPreview').innerHTML, /Mazzo Alba/); assert.match(env.el('rulesMenu').innerHTML, /Vantaggi di Attributo/);
  assert.match(env.el('ld0').innerHTML, /option/);
});

test('stato: in partita il riquadro prende il colore del giocatore di turno', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0)});
  assert.ok(env.el('statusBox')._cls.has('turnbox')); assert.equal(env.el('statusBox').vars['--pc'], 'var(--p0)');
  assert.match(env.el('status').text, /Turno di Giocatore 1/);
  env.show({state: env.playState(1)});
  assert.equal(env.el('statusBox').vars['--pc'], 'var(--p1)'); assert.match(env.el('status').text, /Turno di Giocatore 2/);
});

test('stato: a fine partita niente colore del turno ma il bordo del vincitore e il pulsante nel riquadro', () => {
  const env = createUiEnv();
  const st = env.playState(0); st.status = 'over'; st.result = {winner:1, score:[2, 3], tie:false};
  env.show({state: st});
  const box = env.el('statusBox');
  assert.ok(!box._cls.has('turnbox')); assert.ok(box._cls.has('overlay')); assert.equal(box.vars['--pc'], 'var(--p1)');
  assert.match(env.el('status').innerHTML, /id="btnAgain"/); assert.match(env.el('status').text, /Vince Giocatore 2/);
});

test('stato: la scelta nella preparazione è nel riquadro di stato (colonna intera col doppio 6, riga/colonna fissata da un dado) e non più in "Preparazione"', () => {
  const env = createUiEnv();
  const st = env.playState(0); st.status = 'setup'; st.firstRolls = [[3, 2]]; st.first = 0;
  st.setup = {n:1, last:[6, 6], pending:{stage:'col', chooser:0, row:null}};
  env.show({state: st});   // locale: chi sceglie è nominato
  assert.match(env.el('status').text, /Giocatore 1, scegli la colonna/); assert.match(env.el('status').text, /Scegli una colonna\./);
  assert.equal(env.el('statusBox').vars['--pc'], 'var(--p0)'); assert.ok(env.el('statusBox')._cls.has('turnbox'));
  assert.doesNotMatch(env.el('extraBox').innerHTML, /tocca/i, 'l\'invito non sta più nel riquadro Preparazione');
  st.setup.pending = {stage:'row', chooser:1, col:3};
  env.show({state: st}); assert.match(env.el('status').text, /Giocatore 2, scegli la riga/); assert.match(env.el('status').text, /La colonna è 3\. Scegli una casella/);
  assert.equal(env.el('statusBox').vars['--pc'], 'var(--p1)');
  // online: chi non sceglie vede un'attesa, con il colore di chi deve scegliere
  env.show({state: st, mode:'online', mySeat:0});
  assert.match(env.el('status').text, /In attesa che l’avversario scelga la riga/); assert.equal(env.el('statusBox').vars['--pc'], 'var(--p1)');
});

test('campo: i bordi di selezione prendono il colore di chi deve scegliere', () => {
  const env = createUiEnv();
  env.show({state: env.playState(1)});
  assert.equal(env.el('board').vars['--pc'], 'var(--p1)');
  const st = env.playState(0); st.status = 'over'; st.result = {winner:0, score:[3, 2], tie:false};
  env.show({state: st}); assert.equal(env.el('board').vars['--pc'], undefined, 'nessun giocatore deve scegliere');
});

test('mano: il bordo unico compare solo quando il giocatore di turno deve scegliere la carta', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0)});
  assert.ok(env.el('handBottom')._cls.has('pick'), 'locale: tocca a chi ha la mano in basso, nessuna carta scelta');
  assert.ok(!env.el('handTop')._cls.has('pick'));
  assert.equal(env.el('handBottom').vars['--hc'], 'var(--p0)'); assert.equal(env.el('handTop').vars['--hc'], 'var(--p1)', 'ogni mano ha il colore del suo giocatore');
  env.show({state: env.playState(0), selHand: 2}); assert.ok(!env.el('handBottom')._cls.has('pick'), 'carta già scelta: niente bordo');
  env.show({state: env.playState(1), mode:'online', mySeat:0}); assert.ok(!env.el('handBottom')._cls.has('pick'), 'online, non è il mio turno');
  env.show({state: env.playState(0), mode:'online', mySeat:0}); assert.ok(env.el('handBottom')._cls.has('pick'), 'online, è il mio turno');
});

test('dettagli carta: attributo con pallino e nome, forte/debole contro, frecce con i simboli', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0), inspected: 'monk'});   // Monk of the Tenyi: TERRA, freccia giù
  const h = env.el('insp').innerHTML;
  assert.match(h, /<dt>Attributo<\/dt>/); assert.match(h, /class="attr-dot"/); assert.match(h, /class="attr-name">TERRA</);
  assert.match(h, /Forte contro ACQUA/); assert.match(h, /Debole contro VENTO/);   // (TERRA batte ACQUA, ed è battuto da VENTO)
  assert.match(h, /aria-label="giù">↓</, 'la freccia è un simbolo, con l\'etichetta a parole per gli screen reader');
  assert.match(h, /title="Monk of the Tenyi"/, 'il nome intero resta nel tooltip');
  assert.equal(env.el('insp').innerHTML.includes('senza effetto'), false);
});

test('dettagli carta: senza carta scelta c\'è il segnaposto', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0), inspected: null});
  assert.match(env.el('insp').innerHTML, /insp-empty/); assert.match(env.el('insp').text, /Tocca una carta/);
});

test('spettatore: stato in partita senza "Tu/Avversario", e chi non è collegato', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0), mode:'online', mySeat:null, spec:true, presence:{on:[true, false], specs:2}});
  assert.match(env.el('status').text, /Turno di Giocatore 1/); assert.match(env.el('status').text, /Giocatore 2 non è collegato/);
  assert.doesNotMatch(env.el('status').text, /Tocca a te|avversario/i);
  assert.ok(!env.el('handBottom')._cls.has('pick'), 'uno spettatore non sceglie carte');
  assert.match(env.el('tools').innerHTML, /Spettatori: 2/); assert.match(env.el('tools').innerHTML, /come spettatore/);
  env.show({state: env.playState(0), mode:'online', mySeat:null, spec:true, presence:{on:[false, false], specs:1}});
  assert.match(env.el('status').text, /Giocatore 1 e Giocatore 2 non sono collegati/);
});

test('spettatore: fine partita senza pulsante per ricominciare', () => {
  const env = createUiEnv();
  const st = env.playState(0); st.status = 'over'; st.result = {winner:0, score:[3, 2], tie:false};
  env.show({state: st, mode:'online', mySeat:null, spec:true});
  assert.match(env.el('status').text, /Vince Giocatore 1/); assert.doesNotMatch(env.el('status').innerHTML, /btnAgain/);
});

test('sala d\'attesa: spettatori contati dall\'host e dagli altri, posto non connesso visto da uno spettatore', () => {
  const env = createUiEnv();
  const st = env.playState(0); st.status = 'lobby'; st.code = 'ROOMX';
  env.run(`online.specs.add({open:true}); online.specs.add({open:true});`);
  env.show({state: st, mode:'online', mySeat:0, host:true});
  assert.match(env.el('extraBox').innerHTML, /Spettatori: 2/);
  env.run(`online.specs.clear()`);
  env.show({state: st, mode:'online', mySeat:null, spec:true, presence:{on:[true, false], specs:3}});
  assert.match(env.el('extraBox').innerHTML, /Spettatori: 3/); assert.match(env.el('extraBox').innerHTML, /non connesso/);
  assert.match(env.el('extraBox').innerHTML, /Stai guardando come spettatore/);
});

test('scorrimento: online, quando la partita inizia si centra il campo; in sala d\'attesa e a partita già iniziata no', () => {
  const env = createUiEnv();
  const lobby = env.playState(0); lobby.status = 'lobby'; lobby.code = 'ROOMX';
  env.show({state: lobby, mode:'online', mySeat:1}); env.flushRaf();
  assert.equal(env.el('board').scrolled, 0, 'in sala d\'attesa non scorre');
  env.show({state: env.playState(0), mode:'online', mySeat:1}); env.flushRaf();
  assert.equal(env.el('board').scrolled, 1, 'la partita comincia: scorre una volta');
  env.show({state: env.playState(1, 11), mode:'online', mySeat:1}); env.flushRaf();
  assert.equal(env.el('board').scrolled, 1, 'le mosse successive non scorrono di nuovo');
});

test('ultima mossa: le carte che hanno cambiato lato si segnano, quelle tornate come prima no', () => {
  const env = createUiEnv();
  const st = env.playState(1); st.board[5] = {k:'monk', o:1, c:0}; st.board[6] = {k:'monk', o:1, c:1}; st.board[7] = {k:'monk', o:0, c:0};
  st.last = {placed:7, from:{5:1, 6:1}};   // la 5 era dell'altro giocatore (ora è cambiata), la 6 è com'era
  env.show({state: st});
  const h = env.el('board').innerHTML;
  const cell = i => h.split('<button').find(b => b.includes(`data-i="${i}"`)) || '';
  assert.match(cell(5), /changed/); assert.match(cell(5), /cambiato di lato nell’ultima mossa/);
  assert.doesNotMatch(cell(6), /changed/); assert.doesNotMatch(cell(7), /changed/);
  delete st.last; env.show({state: st}); assert.doesNotMatch(env.el('board').innerHTML, /changed/, 'senza ultima mossa (vecchie partite salvate) nessun segno');
});

test('anteprima: con una carta scelta, lo spazio sotto il cursore dà i mostri avversari che attaccherebbe (solo se si può agire)', () => {
  const env = createUiEnv();
  const st = env.playState(0); st.hands[0] = ['monk']; st.board[7] = {k:'monk', o:1, c:1};   // Monk (freccia giù): in 2 attacca 7
  env.show({state: st, selHand: 0});
  const over = i => env.run(`previewOf({closest: () => ({dataset: {i: '${i}'}})})`);
  assert.deepEqual(Array.from(over(2)), [7]); assert.deepEqual(Array.from(over(0)), []);
  env.show({state: st, selHand: null}); assert.deepEqual(Array.from(over(2)), [], 'nessuna carta scelta');
  env.show({state: st, selHand: 0, mode:'online', mySeat:1}); assert.deepEqual(Array.from(over(2)), [], 'online non è il mio turno');
  env.show({state: st, selHand: 0, mode:'online', mySeat:null, spec:true}); assert.deepEqual(Array.from(over(2)), [], 'uno spettatore non ha anteprima');
});

test('preferenze: il tema si cambia a giro (automatico, chiaro, scuro) e si ricorda; "carte verso chi le controlla" si ricorda', () => {
  const env = createUiEnv();
  const root = env.ctx.document.documentElement;
  assert.equal(root.dataset.theme, undefined); assert.match(env.el('btnTheme').textContent, /automatico/);
  env.run('cycleTheme()'); assert.equal(root.dataset.theme, 'light'); assert.match(env.el('btnTheme').textContent, /chiaro/);
  env.run('cycleTheme()'); assert.equal(root.dataset.theme, 'dark');
  env.run('cycleTheme()'); assert.equal(root.dataset.theme, undefined, 'torna al tema del dispositivo');
  env.run('cycleTheme()');
  assert.equal(env.run(`prefGet('theme', 'auto')`), 'light');
  env.run(`prefSet('face', true)`); assert.equal(env.run(`prefGet('face', false)`), true); assert.equal(env.run(`prefGet('mai-salvato', 42)`), 42);
});

test('partita locale: si salva a ogni mossa, si riprende dalla home e a partita finita non c\'è più nulla da riprendere', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0), mode:'local'});
  assert.equal(env.run('loadSaved(LOCAL_KEY)'), null, 'nessun salvataggio prima di una mossa');
  env.run(`act({t:'place', hi:0, i:0})`);
  const saved = JSON.parse(JSON.stringify(env.run('loadSaved(LOCAL_KEY)')));
  assert.equal(saved.state.seq, env.run('state.seq')); assert.equal(saved.state.fx, null); assert.equal(saved.view, 0);
  env.run('exitToMenu()');
  assert.equal(env.el('localResume').hidden, false); assert.match(env.el('localResume').innerHTML, /btnResumeLocal/); assert.match(env.el('localResume').text, /turno di Giocatore 2/);
  env.run('resumeLocal()');
  assert.equal(env.run('mode'), 'local'); assert.equal(env.run('state.seq'), saved.state.seq); assert.equal(env.run('state.turn'), 1);
  // a partita finita il salvataggio sparisce
  env.run(`state = Object.assign({}, state, {status:'over', result:{winner:0, score:[3,2], tie:false}}); saveLocal();`);
  assert.equal(env.run('loadSaved(LOCAL_KEY)'), null);
  env.run('exitToMenu()'); assert.equal(env.el('localResume').hidden, true);
});

test('partita locale: "Dimentica" e salvataggi scaduti, rotti o già finiti non si offrono', () => {
  const env = createUiEnv();
  env.show({state: env.playState(0), mode:'local'}); env.run(`act({t:'place', hi:0, i:0})`);
  env.run('forgetLocal()'); assert.equal(env.run('loadSaved(LOCAL_KEY)'), null); assert.equal(env.el('localResume').hidden, true);
  const put = v => env.run(`localStorage.setItem(LOCAL_KEY, ${JSON.stringify(JSON.stringify(v))}); showLocalResume();`);
  put({at: 1, state:{status:'play', turn:0, board:[]}}); assert.equal(env.el('localResume').hidden, true, 'scaduto');
  env.run(`localStorage.setItem(LOCAL_KEY, '{rotto'); showLocalResume();`); assert.equal(env.el('localResume').hidden, true, 'rotto');
  put({at: env.run('Date.now()'), state:{status:'over'}}); assert.equal(env.el('localResume').hidden, true, 'già finita');
});

test('accessibilità: le nuove righe del registro si annunciano (solo quelle nuove), non la storia intera', () => {
  const env = createUiEnv();
  const a = env.playState(0, 10); a.log = ['vecchia']; a.logCount = 1;
  env.show({state: a, mode:'online', mySeat:0});
  assert.equal(env.el('logLive').textContent, '', 'primo disegno: nessun annuncio');
  const b = env.playState(1, 11); b.log = ['nuova', 'vecchia']; b.logCount = 2;
  env.show({state: b, mode:'online', mySeat:0}); assert.equal(env.el('logLive').textContent, 'nuova');
  env.show({state: b, mode:'online', mySeat:0}); assert.equal(env.el('logLive').textContent, 'nuova', 'stesso stato ridisegnato: niente di nuovo');
  const c = env.playState(0, 12); c.log = ['terza', 'nuova', 'vecchia']; c.logCount = 3;
  env.show({state: c, mode:'online', mySeat:0}); assert.equal(env.el('logLive').textContent, 'terza');
  const d = env.playState(0, 13); d.log = ['x', 'y', 'z']; d.logCount = 5;   // (il registro è dal più recente: x è l'ultima)
  env.show({state: d, mode:'online', mySeat:0}); assert.equal(env.el('logLive').textContent, 'y x', 'due righe nuove insieme: si leggono in ordine cronologico (la più vecchia prima)');
});
