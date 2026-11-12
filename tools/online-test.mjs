// Prova online vera: tre Edge senza finestra (host, ospite, spettatore) collegati tramite il server PeerJS (serve internet), una partita giocata fino alla fine,
// poi caduta improvvisa dell'host (processo ucciso, senza "bye") con passaggio di host e ricollegamento dello spettatore.
// Uso: node tools/online-test.mjs [--full]   (--full aggiunge l'ultimo controllo: anche l'ospite se ne va e lo spettatore vede la stanza chiusa, circa 80 s in più)
// Variabile d'ambiente EDGE = percorso di msedge.exe (se non è quello predefinito di Windows).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FULL = process.argv.includes('--full');
const PROFBASE = fs.mkdtempSync(path.join(os.tmpdir(), 'linkgrid-online-'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); } });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/index.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function launch(name, port) {
  const prof = path.join(PROFBASE, name); fs.mkdirSync(prof, { recursive: true });
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run',
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]); });
  const call = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: PAGE }); await sleep(4000);
  const ev = async expr => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text }; return r.result.result.value; };
  return { name, proc, ev, errors, kill: () => { try { ws.close(); } catch {} proc.kill(); } };
}
const until = async (what, fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(300); } throw new Error('timeout: ' + what); };
const results = [];
const check = (n, ok, extra = '') => { results.push(`${ok ? 'OK   ' : 'FAIL '} ${n}${extra ? '  [' + extra + ']' : ''}`); log(ok ? 'OK  ' : 'FAIL', n, extra); };

const H = await launch('host', 9361), G = await launch('guest', 9362), S = await launch('spec', 9363);
const brief = `(()=>state ? JSON.stringify({st:state.status, seq:state.seq, turn:state.turn, board:(state.board||[]).map(x=>x?(x.x?'X':x.k+x.c):'.').join(''), mySeat, spec:online.spec, host:online.host, mode, conn:!!(online.conn&&online.conn.open), specs:online.specs.size}) : 'null')()`;
const B = async x => JSON.parse(await x.ev(brief));
try {
  const dataOk = await H.ev(`typeof GAME_DATA === 'object' && Object.keys(CARDS).length === 60 && Object.keys(DECKS).length === 4`);
  check('il gioco si carica da HTTP con loader.js (60 carte, 4 mazzi)', dataOk === true, String(dataOk));
  await H.ev(`$('od').value='mezzogiorno'; createRoom(); 0`);
  const code = await until('codice stanza', async () => (await H.ev(`state && state.code`)) || null, 30000);
  check('host: stanza creata col server PeerJS', true, code);
  await G.ev(`$('od').value='mezzanotte'; $('joinCode').value='${code}'; joinRoom(); 0`);
  await until('ospite collegato', async () => { const b = await B(G); return b && b.mode === 'online' && b.conn ? b : null; }, 40000);
  const gb = await B(G), hb = await B(H);
  check('ospite collegato: posto 2, l\'host vede la connessione', gb.mySeat === 1 && hb.conn);
  await S.ev(`$('specOpt').checked=true; $('joinCode').value='${code}'; joinRoom(); 0`);
  await until('spettatore collegato', async () => { const b = await B(S); return b && b.mode === 'online' && b.conn && b.spec ? b : null; }, 40000);
  const sb = await B(S), hb2 = await B(H);
  check('spettatore: nessun posto, l\'host ne conta 1', sb.mySeat === null && sb.spec === true && hb2.specs === 1);
  await H.ev(`startMatch(); 0`);
  await until('partita iniziata per tutti', async () => { const r = await Promise.all([H, G, S].map(B)); return r.every(b => b.st !== 'lobby') ? r : null; }, 15000);
  const mover = `(()=>{
    if(!state || state.status==='over' || isBusy()) return 'wait';
    const rnd = n => Math.floor(Math.random()*n);
    const seat = (state.status==='setup' && state.setup.pending) ? state.setup.pending.chooser : state.turn;
    if(mySeat!==seat) return 'notme';
    if(state.status==='setup'){ const ks = setupOptions(state).map((ok,i)=>ok?i+1:0).filter(Boolean); if(!ks.length) return 'wait'; act({t:'setup', k:ks[rnd(ks.length)]}); return 'moved'; }
    if(state.pending){ const t = state.pending.t; act({t:'target', i:t[rnd(t.length)]}); return 'moved'; }
    const free = state.board.map((x,i)=>x===null?i:-1).filter(i=>i>=0); if(!free.length) return 'wait';
    act({t:'place', hi:rnd(state.hands[state.turn].length), i:free[rnd(free.length)]}); return 'moved';
  })()`;
  let moves = 0, specMoves = 0; const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if ((await B(H)).st === 'over') break;
    const r = await Promise.all([H.ev(mover), G.ev(mover)]); moves += r.filter(x => x === 'moved').length;
    if ((await S.ev(mover)) === 'moved') specMoves++;
    await sleep(700);
  }
  await sleep(1000);
  const fin = await Promise.all([H, G, S].map(B));
  check('partita giocata fino alla fine online', fin[0].st === 'over' && moves > 10, `mosse=${moves}`);
  check('host, ospite e spettatore hanno lo stesso stato finale', fin[0].seq === fin[1].seq && fin[1].seq === fin[2].seq && fin[0].board === fin[2].board, JSON.stringify(fin.map(f => f.seq)));
  check('lo spettatore non ha mai potuto muovere', specMoves === 0);
  await H.ev(`startMatch(); 0`);
  await until('nuova partita per tutti', async () => { const r = await Promise.all([H, G, S].map(B)); return r.every(b => b.st !== 'over') ? r : null; }, 15000);
  log('uccido l\'host (caduta improvvisa)…'); H.kill(); const tKill = Date.now();
  const nh = await until('l\'ospite diventa host', async () => { const b = await B(G); return b.host ? b : null; }, 90000);
  check('passaggio di host: l\'ospite prende la stanza', true, `dopo ${Math.round((Date.now() - tKill) / 1000)} s, posto ${nh.mySeat}`);
  const after = await until('lo spettatore si ricollega', async () => { const s = await B(S), g = await B(G); return s.conn && s.spec && g.specs === 1 ? { s, g } : null; }, 90000);
  check('lo spettatore si ricollega al nuovo host e resta spettatore', after.s.spec === true && after.s.mySeat === null, `dopo ${Math.round((Date.now() - tKill) / 1000)} s`);
  await sleep(1500);
  const g2 = await B(G), s2 = await B(S);
  check('ospite (ora host) e spettatore hanno lo stesso stato', g2.seq === s2.seq && g2.board === s2.board, JSON.stringify({ g: g2.seq, s: s2.seq }));
  if (FULL) {
    log('chiudo anche l\'ospite (ex host)…'); G.kill(); const tG = Date.now();
    await until('lo spettatore chiude la stanza', async () => ((await S.ev(`mode`)) === null ? true : null), 100000);
    const msg = await S.ev(`document.getElementById('menuErr').textContent`);
    check('entrambi i giocatori se ne sono andati: la stanza si chiude per lo spettatore', /chiusa/.test(msg), `dopo ${Math.round((Date.now() - tG) / 1000)} s`);
  }
} catch (e) {
  results.push('FAIL ' + e.message); log('ERRORE', e.message);
  for (const x of [H, G, S]) { try { log(x.name, await x.ev(brief)); } catch {} }
}
for (const x of [H, G, S]) if (x.errors.length) results.push(`ECCEZIONI JS (${x.name}): ` + x.errors.slice(0, 3).join(' | '));
console.log('\n' + results.join('\n'));
for (const x of [H, G, S]) x.kill();
server.close();
try { fs.rmSync(PROFBASE, { recursive: true, force: true }); } catch {}
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
