# carlogalatolo.github.io

Questo è un simulatore per browser di un minigioco di mia creazione che prende regole dal Tetra Master di Final Fantasy 9 e le porta sul tavolo usando le carte mostro Link di YGO.

Può essere giocato interamente dal vivo disponendo dei seguenti materiali:
- Un campo da gioco di YGO aggiornato alle regole dei mostri Link: consideralo semplicemente una griglia 5×5 contando anche gli spazi vuoti tra le zone carte mostro.
- Due mazzi da 15 mostri Link (le regole di costruzione del mazzo saranno aggiunte in seguito). Eventualmente, anche 10 carte per mazzo possono bastare.
- Due dadi a sei facce.

Il codice del simulatore è al 99% scritto dall'IA.

## Struttura del codice

Nessuna build: i file si caricano direttamente dal browser (GitHub Pages) come script classici, nell'ordine indicato in `index.html`.

| File | Contenuto |
|---|---|
| `engine.js` | Regole del gioco: carte, mazzi, preparazione del campo, catture, combo, fine partita, validazione delle mosse (`applyMove`) e testi del registro. Funzioni pure su uno stato JSON: non toccano né il DOM né la rete, e in Node si caricano con `require`. |
| `net.js` | Parte online (PeerJS, connessione diretta tra browser): stanza, host e ospite, riconnessioni, passaggio dell'host, ripresa della stanza. |
| `script.js` | Interfaccia: disegno, animazioni, eventi, partita locale. |

**Gioco online.** L'host tiene lo stato e il motore. L'ospite non manda mai uno stato: manda solo la mossa (`{t:'place', hi, i}`, `{t:'target', i}`, `{t:'setup', k}`), l'host la valida con `applyMove`, la applica e rimanda lo stato aggiornato.

## Test

Servono solo Node (versione 20 o successiva), nessuna dipendenza da installare:

```
npm test
```

- `tests/engine.test.js`: regole, preparazione del campo, mosse non valide, partite casuali con controllo degli invarianti, dati dei mazzi.
- `tests/net.test.js`: parte online con un PeerJS finto (host, ospite, riconnessioni, ripresa della stanza, passaggio dell'host, protocollo a mosse).
- `tests/files.test.js`: struttura dei file (ordine degli script, nomi duplicati, motore senza accessi al browser).

Nei test le carte sono inventate e i dadi si possono pilotare (`setRng`), quindi non dipendono dai dati dei mazzi né dal caso.
