---
version: 0.9.0
title: Verso la 1.0
---
- Ridisegnata la timeline della disponibilità nei risultati del tab Disponibili
- Sostituiti i due selettori dell'orario con un unico selettore dell'intervallo
- La pagina dei dettagli ora mantiene la tua ricerca quando la apri dal tab Disponibili
- Nuovi URL leggibili per la pagina dei dettagli delle aule
- Aggiunte la "Ricerca all'avvio" e la "Ricerca in tempo reale"
- Aggiunta la pagina Info: tocca il logo nell'header per scoprire di più su PoliAule!
- Lanciata PoliAule Beta, con le sue icone, su [beta.poliaule.com](https://beta.poliaule.com)
- Pubblicata la documentazione, e un nuovo endpoint delle API con le date scaricate
<!-- more -->
Uno dei momenti più importanti nella storia di PoliAule. La versione stabile è vicina, quindi si smussano tutti gli angoli e si aggiungono i pezzi mancanti: nuove funzioni, correzioni ai vecchi punti deboli di PoliAule e tanta rifinitura, come la nuova pagina Info, gli URL definitivi delle aule e la documentazione per aiutare chi vuole contribuire.

PoliAule avvia anche la sua pipeline di rilascio completa: un ramo main per la produzione e un ramo beta per i test pubblici.

## Timeline
La timeline nei risultati del tab Disponibili ha un design nuovo e più elegante. Mostra meglio come le occupazioni si sovrappongono al periodo cercato, evidenziando non solo cosa succede al suo interno ma anche subito prima e subito dopo.

Le timeline nella pagina dei dettagli seguono lo stesso design e lo stesso significato, con le occupazioni ora in rosso invece che in verde, per evitare fraintendimenti.

## Selettore dell'intervallo
I due selettori dell'orario lasciano il posto a un nuovo selettore dell'intervallo: una timeline con una selezione sopra. Trascina una delle due maniglie per cambiare l'inizio o la fine, oppure trascina l'intero blocco per spostare la selezione nel corso della giornata.

I vecchi controlli, più precisi, ci sono ancora: tocca le maniglie della selezione o le sue etichette.

## Navigazione e URL
Aprendo un'aula dai risultati del tab Disponibili ora la tua ricerca viene mantenuta. Su mobile la vista del giorno si apre sullo stesso giorno che stavi guardando, e sia su mobile che su desktop viene evidenziato l'intervallo cercato. Aprire un'aula dal tab Cerca funziona come prima.

Gli URL delle aule ora usano i nomi, quindi sono più facili da scrivere e da leggere:

```
poliaule.com/#classroom/{campus}/{aula}
poliaule.com/#classroom/leonardo/2.0.1
```

Non distinguono maiuscole e minuscole, quindi `T.2.1` e `t.2.1` funzionano entrambi. Il campus serve perché alcuni nomi esistono in più campus, come `A.0.1` sia a Lecco che a Mantova.

## Ricerca all'avvio
PoliAule fa una ricerca appena si apre la pagina, con i parametri predefiniti. Insieme a dei buoni valori predefiniti, rende più veloce trovare aule libere. È attiva di default; puoi disattivarla, o cambiare i parametri predefiniti, nelle Impostazioni.

## Ricerca in tempo reale
I risultati ora si aggiornano appena cambia qualcosa nella ricerca, senza premere il pulsante. È attiva di default e si può disattivare nelle Impostazioni, perché rifare la ricerca a ogni modifica può pesare sui dispositivi meno potenti.

## Pagina Info
Una nuova pagina con più informazioni su PoliAule. Aprila toccando il logo in alto a sinistra da qualsiasi pagina, o vai direttamente su `poliaule.com/#info`.

## PoliAule Beta
PoliAule si è da poco spostata da GitHub Pages a Cloudflare Pages. A parte prestazioni migliori, per te non cambia nulla, ma permette di pubblicare più rami, ciascuno sul proprio sottodominio.

Il ramo beta di PoliAule ora vive su [beta.poliaule.com](https://beta.poliaule.com), con una sua identità: favicon e icona dell'app dedicate.

![La favicon di PoliAule Beta](media/beta-favicon.webp) ![L'icona dell'app di PoliAule Beta](media/beta-app-icon.webp)

## Documentazione
Il repository ora ha una documentazione su come funziona PoliAule, nella cartella `docs`:

- `architecture.md`: come vengono scaricati e serviti i dati, i formati JSON, la pipeline di rilascio e le dipendenze esterne
- `api.md`: la documentazione delle API REST di PoliAule, le stesse che usa l'app. Sono gratuite, quindi altri servizi possono usare i dati di PoliAule invece di interrogare i server del Politecnico
- `frontend.md`: come è costruita la UI: navigazione, routing con hash, View Transition, localizzazione, supporto PWA e altro

## Nuovo endpoint delle API
Un nuovo endpoint restituisce quando sono stati generati i dati e l'elenco delle date per cui PoliAule ha dati.
