---
version: 2.0.0
date: 2026-10-11
channel: stable
title: Un nuovo inizio
github: https://github.com/SummaCristian/poliaule/releases/tag/2.0.0
---
Sono fiero di annunciare che, dopo tanti mesi di duro lavoro, PoliAule 2.0 è finalmente disponibile!

Ecco le principali novità:

- Il tab Disponibili, ridisegnato
- Ecco il nuovissimo tab Campus
- Una ricerca tutta nuova
- La pagina dei dettagli dell'aula, ridisegnata
- Costruita su Vitrium, il mio nuovo design system
- Un backend rinnovato
- Nuovi loghi
<!-- more -->
Questo è uno degli sforzi più grandi che io abbia mai compiuto per un singolo progetto in vita mia, più di qualsiasi progetto universitario e di qualsiasi esame abbia mai fatto. Ho iniziato a lavorarci ben prima che PoliAule 1.0 uscisse a maggio, quando la priorità era rilasciare qualcosa il prima possibile perché tutti potessero usarlo. Quella versione era chiaramente stata scritta di corsa, e ho sempre pensato che potesse essere molto ma molto di più: per questo ho continuato a lavorare in parallelo alla reale e completa esperienza di PoliAule.

Doveva uscire in tempo per il nuovo anno accademico. Purtroppo non ce l'ho fatta, ma spero che non sia troppo tardi per apprezzare il lavoro che c'è stato dietro.

Questa versione ridisegna ogni aspetto, ogni schermata e ogni componente di PoliAule. Tutto è stato messo in discussione, valutato e poi ritoccato, ridisegnato, oppure demolito e ricostruito da zero.
È cambiato così tanto, in un modo o nell'altro, che potrei scrivere per ore di tutti i minimi dettagli su cui mi sono fissato per giornate intere, ma vi lascio il piacere di scoprirli da soli. Ecco invece un elenco dei cambiamenti più grandi di questa versione.

## Il tab Disponibili, ridisegnato
Il tab Disponibili è la parte più importante di PoliAule: è il motivo stesso per cui esiste.

Proprio per questo, non potevo lasciare che fosse un semplice elenco di aule con qualche selettore. Troppo noioso...

Ora la scheda ospita un sacco di nuove funzioni che la trasformano in una dashboard della vostra università.
In cima, a volte, un banner mostrerà informazioni importanti che potrebbe esserti utile sapere.
Subito sotto, la nuovissima sezione Preferite permette di fissare le tue aule e i tuoi edifici preferiti di qualsiasi campus, così sono sempre a portata di mano.

I risultati sono stati anch'essi completamente ripensati: un nuovo aspetto, una gerarchia delle informazioni più chiara e un'esperienza più veloce e intuitiva.

Anche i selettori sono stati ricostruiti da zero: sono sempre a portata di dito, con gesti intuitivi per aiutarti a trovare quello che ti serve, quando ti serve.

![Il tab Disponibili in PoliAule 1.1](media/available_v1.webp "Prima") ![Il tab Disponibili in PoliAule 2.0](media/available_v2.webp "Dopo")

## Il nuovissimo tab Campus
A PoliAule serviva la capacità di guidarti nel tuo campus non solo nel tempo, ma anche nello spazio. Immaginala come un T.A.R.D.I.S., solo senza tutta la faccenda spazio-temporale.

Il nuovissimo tab Campus ti permette di esplorare il campus su una mappa 3D interattiva, per scoprire dove esattamente sono riusciti a nascondere la tua lezione stavolta, come arrivarci, o trovare un motivo per non andarci (ehi, vale anche quello!).

Ma soprattutto ti permette di scoprire aule che altrimenti non troveresti mai, come quell'aula usata solo per gli eventi che dovrai trovare proprio l'unica volta che sei in ritardo, o qualcosa del genere (ogni riferimento a esperienze personali è puramente casuale).

![Il tab Campus, con la mappa 3D del campus](media/campus_v2.webp)

## Trova quello che ti serve con la nuova ricerca
Ora che è il tab Campus ad occuparsi dell'esplorazione del campus, la ricerca è finalmente libera di concentrarsi su ciò che ci si aspetta davvero da qualcosa con quel nome: poter cercare assolutamente qualsiasi cosa. E la nuova ricerca mantiene la promessa: aule, edifici e occupazioni, ma anche nomi dei corsi, esami e perfino docenti.

![La ricerca in PoliAule 1.1](media/search_v1.webp "Prima") ![La ricerca in PoliAule 2.0](media/search_v2.webp "Dopo")

## La pagina dei dettagli, aggiornata
La pagina dei dettagli ridisegnata ha un aspetto più moderno, con uno sfondo colorato e card di vetro.

La schermata ora mostra anche nuove informazioni su ogni aula, come la posizione del suo edificio su una mappa, o i suoi orari di apertura e chiusura.

Anche l'animazione di apertura della pagina dei dettagli è stata ricostruita da zero, per sembrare nativa senza sacrificare le prestazioni.

![La pagina dei dettagli in PoliAule 1.1](media/details_v1.webp "Prima") ![La pagina dei dettagli in PoliAule 2.0](media/details_v2.webp "Dopo") ![La pagina dei dettagli in PoliAule 2.0, scorsa fino agli orari di apertura e alla mappa](media/details_v2_2.webp "Dopo, più in basso")

## Vitrium, il design system di PoliAule
PoliAule usa Vitrium, il mio nuovo design system. Anche se, detta così, è sbagliata: è più il contrario. Mentre lavoravo a PoliAule 2.0, ad un certo punto mi sono reso conto che stavo costruendo qualcosa di davvero carino, così l'ho estratto da questo codice e l'ho generalizzato in una libreria di componenti, che ora è usata anche da PoliAule.

Vitrium è open source: lo trovi su [vitrium.summacristian.com](https://vitrium.summacristian.com) o su [GitHub](https://github.com/SummaCristian/Vitrium). È una libreria ispirata al Liquid Glass che va fiera di due cose: una ricreazione fedele del Liquid Glass, con complesse tecniche realizzate a mano come le ombre ad anello o la diffrazione attraverso il vetro, e componenti curati e riutilizzabili che sfruttano questi materiali.

Tutti i componenti principali di PoliAule sono componenti nativi di Vitrium, come la nuova tab bar, oppure sono costruiti sulle fondamenta che Vitrium fornisce. È un chiaro esempio di quanto sia versatile il design system: esploralo pure, e usalo nei tuoi progetti se ti piace!

![La tab bar, un componente di Vitrium, in azione](media/tabbar_v2.mp4#loop "La nuova tab bar, costruita con Vitrium")

> [!NOTE]
> Vitrium, e quindi PoliAule, supporta un effetto di rifrazione attraverso il vetro, per ora solamente nei browser basati su Chromium. Firefox, Safari e i loro derivati salteranno questo effetto finché non supporteranno la tecnologia che lo rende possibile...

## Non dimentichiamoci del backend
L'intero backend è stato rivisto, e in parte riscritto, in preparazione alla 2.0.

Il recupero delle occupazioni, il pezzo più importante, è ora 10 volte più veloce: si passa da ~20 minuti a ~2 minuti per esecuzione. Il merito è di un nuovo approccio basato sullo scraping delle pagine web, invece di interrogare con cautela l'API ufficiale-ma-non-pubblica con ~2.000 richieste per esecuzione.

Ci sono anche nuovi moduli del backend che collegano i loro dati all'API, insieme a nuovi endpoint con cui giocare:

- `GET /v1/graduation-sessions`: i giorni delle sessioni di laurea del PoliMi e i campus in cui si tiene ciascuno di essi
- `GET /v1/photos/:id`: la foto di un'aula, servita da PoliAule invece che dal PoliMi
- `GET /v1/photos/:id/thumb`: la stessa foto ridotta a 640px, per le anteprime più piccole

Tutti i dettagli sono in [`docs/api.md`](https://github.com/SummaCristian/poliaule/blob/main/docs/api.md).

## Nuovi loghi, stessa personalità
I loghi di PoliAule e della sua versione Beta sono stati ridisegnati con un aspetto più moderno, in stile Liquid Glass. Spero che vi piacciano!

![La nuova icona di PoliAule](media/icon-main.webp "PoliAule") ![La nuova icona di PoliAule Beta](media/icon-beta.webp "PoliAule Beta")
