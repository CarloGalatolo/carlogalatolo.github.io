# YGO Link Grid

Questo è un simulatore per browser di un minigioco di mia creazione che prende regole dal Tetra Master di Final Fantasy 9 e le porta sul tavolo usando le carte mostro Link di YGO.

Può essere giocato interamente dal vivo disponendo dei seguenti materiali:
- Un campo da gioco di YGO aggiornato alle regole dei mostri Link: consideralo semplicemente una griglia 5×5 contando anche gli spazi vuoti tra le zone carte mostro.
- Due mazzi da 15 mostri Link (le regole di costruzione del mazzo saranno aggiunte in seguito). Eventualmente, anche 10 carte per mazzo possono bastare.
- Due dadi a sei facce.

Il codice del simulatore è al 99% scritto dall'IA.

**Gioco online.** L'host tiene lo stato e il motore. L'ospite non manda mai uno stato: manda solo la mossa (`{t:'place', hi, i}`, `{t:'target', i}`, `{t:'setup', k}`), l'host la valida con `applyMove`, la applica e rimanda lo stato aggiornato.

**Spettatori.** Chi entra in una stanza già piena (o spunta "Entra come spettatore") guarda soltanto: l'host gli manda ogni stato (`spec:true`) e un messaggio `presence` (chi è collegato, quanti spettatori), ma non accetta nulla da lui. Gli spettatori non hanno un posto e non diventano mai host: se l'host sparisce si ricollegano alla stanza (la riapre l'altro giocatore) e, se non torna nessuno entro un minuto (o l'host esce senza altri giocatori: messaggio `closed`), la considerano chiusa. Massimo 8 spettatori.