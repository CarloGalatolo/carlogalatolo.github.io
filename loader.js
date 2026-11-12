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
  try {
    const [cards, decks] = await Promise.all([get('cards.json'), get('decks.json')]);
    window.GAME_DATA = {cards, decks};
    for(const src of ['engine.js', 'net.js', 'graphics.js']) await load(src);
  } catch(e) {
    const box = document.getElementById('loadError');
    box.hidden = false;
    box.textContent = 'Non è stato possibile caricare il gioco (' + e.message + '). Se hai aperto index.html direttamente dal disco, avvia un piccolo server locale (per esempio “python -m http.server”) e aprilo da lì.';
    console.error(e);
  }
})();
