// Screenshot di una parte dell'interfaccia con Edge senza finestra (un server statico locale parte e si ferma da solo).
// Uso: node tools/screenshot.mjs <scena> <file.png> [larghezza=1100] [tema=auto|light|dark]
//   scena "home": la sezione dei mazzi della home       -> <file>.png
//   scena "game": una partita d'esempio, campo e dettagli -> <file>_campo.png e <file>_dettagli.png
// Variabile d'ambiente EDGE = percorso di msedge.exe (se non è quello predefinito di Windows).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [SCENE, OUT, W = '1100', THEME = 'auto'] = process.argv.slice(2);
if (!['home', 'game'].includes(SCENE) || !OUT) { console.error('Uso: node tools/screenshot.mjs <home|game> <file.png> [larghezza] [auto|light|dark]'); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = fs.mkdtempSync(path.join(os.tmpdir(), 'linkgrid-shot-'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); } });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const PORT = 9397;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, '--no-first-run', `--window-size=${W},1000`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]); });
const call = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
await call('Runtime.enable'); await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: +W, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url }); await sleep(3500);
if (THEME !== 'auto') await ev(`document.documentElement.dataset.theme='${THEME}'; 0`);

if (SCENE === 'game') {
  await ev(`document.getElementById('btnLocal').click(); 0`); await sleep(500);
  await ev(`(()=>{
    const ks = Object.keys(CARDS);
    const st = structuredClone(state); st.status='play'; st.turn=0; st.first=0; st.pending=null; st.fx=null; st.sfx=null; st.setup={n:5,last:null,pending:null};
    st.board=Array(25).fill(null); [20,21,22,23,24].forEach(i=>st.board[i]={x:1});
    const put=(i,k,c)=>{ st.board[i]={k,o:c,c}; };
    put(6,ks[0],0); put(7,ks[15],1); put(8,ks[9],0); put(11,ks[3],1); put(12,ks[12],0); put(13,ks[28],1); put(16,ks[14],1); put(17,ks[25],0);
    st.hands[0]=ks.slice(30,35); st.hands[1]=ks.slice(45,50); st.seq=900; state=st; inspected=ks[12]; render(); 0; })()`);
  await sleep(1500);
}
const clip = async (sel, file, maxH = 4000, scale = 1.6) => {
  const r = JSON.parse(await ev(`(()=>{ const r = document.querySelector('${sel}').getBoundingClientRect(); return JSON.stringify({x:Math.max(0,r.x-6), y:r.y+scrollY-6, w:r.width+12, h:Math.min(r.height+12, ${maxH})}); })()`));
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale } });
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64')); console.log('scritto', file);
};
if (SCENE === 'home') await clip('#deckPreview', OUT, 360);
else { await clip('#board', OUT.replace(/\.png$/, '') + '_campo.png'); await clip('#inspBox', OUT.replace(/\.png$/, '') + '_dettagli.png'); }
if (errors.length) console.log('ECCEZIONI JS:', errors.join(' | '));
ws.close(); edge.kill(); server.close();
try { fs.rmSync(PROF, { recursive: true, force: true }); } catch {}
process.exit(0);
