# YGO Link Grid

Questo è un simulatore per browser di un minigioco di mia creazione che prende regole dal Tetra Master di Final Fantasy 9 e le porta sul tavolo usando le carte mostro Link di YGO.

Può essere giocato interamente dal vivo disponendo dei seguenti materiali:
- Un campo da gioco di YGO aggiornato alle regole dei mostri Link: consideralo semplicemente una griglia 5×5 contando anche gli spazi vuoti tra le zone carte mostro.
- Due mazzi da 15 mostri Link (le regole di costruzione del mazzo saranno aggiunte in seguito). Eventualmente, anche 10 carte per mazzo possono bastare.
- Due dadi a sei facce.

Il codice del simulatore è al 99% scritto dall'IA.

**Gioco online.** L'host tiene lo stato e il motore. L'ospite non manda mai uno stato: manda solo la mossa (`{t:'place', hi, i}`, `{t:'target', i}`, `{t:'setup', k}`), l'host la valida con `applyMove`, la applica e rimanda lo stato aggiornato.

**Spettatori.** Chi entra in una stanza già piena (o spunta "Entra come spettatore") guarda soltanto: l'host gli manda ogni stato (`spec:true`) e un messaggio `presence` (chi è collegato, quanti spettatori), ma non accetta nulla da lui. Gli spettatori non hanno un posto e non diventano mai host: se l'host sparisce si ricollegano alla stanza (la riapre l'altro giocatore) e, se non torna nessuno entro un minuto (o l'host esce senza altri giocatori: messaggio `closed`), la considerano chiusa. Massimo 8 spettatori.

**Dati e avvio.** Le carte stanno in `cards.json` e i mazzi in `decks.json`; `loader.js` li legge con `fetch` e poi carica `engine.js`, `net.js` e `graphics.js` nell'ordine giusto (un file JSON non si può caricare con un tag `<script>`). Per questo `index.html` non funziona se lo si apre direttamente dal disco (il browser blocca `fetch` sui file locali): in locale serve un piccolo server, per esempio `python -m http.server` dalla cartella del progetto. Su GitHub Pages funziona così com'è. I test (`npm test`) leggono i JSON direttamente. Quando pubblichi modifiche a script o dati, cambia `VERSION` in `loader.js`: finisce in coda agli indirizzi (`?v=…`) e impedisce al browser di mescolare file vecchi in cache con quelli nuovi.

**Illustrazioni.** Le immagini ritagliate delle carte (`img/cards/<ID>.jpg`, ID = codice a 8 cifre) vengono dal database YGOPRODeck, ridotte a 256×256 e salvate qui nel progetto (non si collegano al loro sito a ogni partita). Le illustrazioni e i nomi delle carte appartengono ai rispettivi proprietari (Konami): il progetto è un omaggio amatoriale senza scopo di lucro. Le sfere degli Attributi (`img/attributes/*.svg`) vengono da Yugipedia e valgono le stesse considerazioni.

**Strumenti** (`tools/`, non servono per giocare):
- `node tools/balance.js [partite per coppia]`: ogni mazzo contro ogni altro con giocatori "avidi" (scelgono la mossa che massimizza subito le catture); mostra percentuali di vittoria, scarti, pareggi e l'effetto del primo giocatore.
- `node tools/balance.js [partite] [mazzo] [--variant=file.json]`: con `--variant` si prova un mazzo modificato (file JSON con `cards` e/o `decks`) senza toccare i dati veri.
- `node tools/card-impact.js <mazzo> [partite per avversario]`: quanto pesa ogni carta del mazzo (vittorie quando è giocata meno vittorie quando resta nel mazzo), contro tutti gli altri mazzi.
- `node tools/online-test.mjs [--full]`: prova online vera con tre Edge senza finestra (host, ospite, spettatore) tramite il server PeerJS: partita intera, caduta improvvisa dell'host e ricollegamento dello spettatore (`--full` aggiunge la chiusura della stanza). Serve internet.
- `node tools/screenshot.mjs <home|game> <file.png> [larghezza] [auto|light|dark]`: screenshot della sezione mazzi o di una partita d'esempio.
Gli ultimi due usano Edge (variabile d'ambiente `EDGE` se non è nel percorso predefinito di Windows) e avviano da soli un server locale.

