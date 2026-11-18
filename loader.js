// Link Grid — avvio: legge i dati (cards.json, decks.json) e poi carica gli script del gioco, uno dopo l'altro e nell'ordine giusto.
// Serve perché engine.js ha bisogno dei dati già pronti e un file JSON non si può caricare con un tag <script> (si legge con fetch, quindi serve un server:
// da GitHub Pages funziona; aprendo index.html direttamente dal disco il browser blocca la lettura dei file, vedi README).
// VERSION: da cambiare a ogni pubblicazione che tocca script o dati. Finisce in coda agli indirizzi (?v=…), così il browser non riusa dalla cache una versione
// vecchia di engine.js, net.js, graphics.js, cards.json o decks.json mescolandola con le nuove (GitHub Pages permette di tenere i file in cache per circa 10 minuti).
(async () => {
  const VERSION = '2026-11-12';
  const get = async url => { const r = await fetch(url + '?v=' + VERSION); if(!r.ok) throw new Error(url + ': ' + r.status); return r.json(); };
  const load = src => new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = src + '?v=' + VERSION; s.onload = ok; s.onerror = () => ko(new Error('Impossibile caricare ' + src));
    document.body.appendChild(s);	// (uno script aggiunto così viene eseguito appena caricato: per questo si aspetta il precedente prima di aggiungere il successivo)
  });
  // Schermata di caricamento (#loading in index.html): resta finché non è pronto tutto, poi sfuma e sparisce; se qualcosa va storto sparisce comunque, per lasciar vedere l'errore.
  const loading = document.getElementById('loading');
  const hideLoading = () => { if(!loading) return; loading.classList.add('done'); setTimeout(() => { loading.hidden = true; }, 400); };
  const MAX_WAIT_MS = 8000;	// oltre questo tempo si mostra comunque la pagina (un'immagine o un font lenti non devono bloccarla)
  const preload = src => new Promise(done => { const i = new Image(); i.onload = i.onerror = () => done(); i.src = src; });
  try {
    const [cards, decks] = await Promise.all([get('cards.json'), get('decks.json')]);
    window.GAME_DATA = {cards, decks};
    for(const src of ['engine.js', 'ai.js', 'net.js', 'graphics.js']) await load(src);
    // le illustrazioni e le sfere si caricano prima di mostrare la pagina (così le carte della home non "compaiono" a pezzi), insieme ai font
    const ready = Promise.all([
      document.fonts ? document.fonts.ready : null,
      ...Object.keys(cards).map(id => preload('img/cards/' + id + '.jpg')),
      ...Object.keys(ATTR_LABEL).map(a => preload('img/attributes/' + a + '.svg'))
    ]);
    await Promise.race([ready, new Promise(r => setTimeout(r, MAX_WAIT_MS))]);
    hideLoading();
  } catch(e) {
    hideLoading();
    const box = document.getElementById('loadError');
    box.hidden = false;
    box.textContent = 'Non è stato possibile caricare il gioco (' + e.message + '). Se hai aperto index.html direttamente dal disco, avvia un piccolo server locale (per esempio “python -m http.server”) e aprilo da lì.';
    console.error(e);
  }
})();
