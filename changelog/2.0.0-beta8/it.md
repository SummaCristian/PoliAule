---
version: 2.0.0-beta8
title: Una ricerca in stile Spotlight
---
- Ridisegnata tutta la ricerca, per trovare più facilmente aule, professori e corsi, con una nuova sezione "Top Hit" per il risultato più rilevante
- Ridisegnata la pagina Info
- Resa molto più veloce la transizione verso i dettagli di un'aula, con framerate più alti anche sui dispositivi più datati
- La mappa del tab Campus ora si carica in background, così la UI resta reattiva mentre viene scaricata
- Le foto delle aule ora arrivano come miniature dove sono mostrate piccole, per prestazioni molto migliori
- Il grafico delle occupazioni nella pagina dei dettagli ora è di vetro colorato
- Aggiunto Trasferimento: sposta preferiti e impostazioni su un altro dispositivo con un codice QR
<!-- more -->
## Cerca
Ispirata a Spotlight, la nuova ricerca divide i risultati in sezioni e mostra in cima quello più promettente, nella nuova sezione "Top Hit".

I professori hanno una pagina tutta loro dentro la ricerca, con tutte le loro lezioni ed esami raggruppati per corso. Anche i corsi possono raggruppare più occupazioni in una riga espandibile, così la lista è più facile da scorrere.

Su desktop tutta la UI funziona con la tastiera: le frecce spostano la selezione, Invio la apre ed Esc chiude la ricerca.

## Prestazioni
In vista del lancio stabile di PoliAule 2, ho iniziato a lavorare sulle prestazioni. Questo aggiornamento affronta le due maggiori fonti di rallentamenti: la mappa e la transizione di navigazione.

### Mappa
La mappa di Mapbox ora si carica interamente in un thread in background, lasciando il thread principale alla UI e alle tue interazioni. Il primo caricamento può durare un po' di più, ma è un compromesso che ne vale la pena per un'esperienza più fluida.

La pagina dei dettagli mostra la stessa mappa del tab Campus, e spostarla e ridimensionarla a ogni transizione era un altro grosso peso. Ora succede solo a transizione finita, o prima solo quando si torna al tab Campus, così la transizione ha il thread principale tutto per sé.

### Transizione di navigazione
La transizione con lo zoom verso un'aula c'è ancora, più fluida che mai. È stata rifatta (di nuovo!) per affidare il più possibile al compositor del browser, che lavora fuori dal thread principale ed è di solito più ottimizzato di qualsiasi cosa si possa fare in JavaScript.

Provata su tutti i principali motori dei browser: Chrome e Firefox su desktop, Safari e Chrome su mobile. Su un banco di prova automatico, un telefono Android 12 del 2019 con Chrome ha fatto in media circa 55 fps su 60, mentre Safari su iOS 27 arriva a circa 115 fps su 120.

## Miniature
Un nuovo endpoint fornisce versioni a risoluzione più bassa delle foto delle aule, generate dallo stesso processo mensile che le scarica. La UI le usa dove le foto sono piccole, come nelle schede della griglia e nei risultati di ricerca, e tiene la risoluzione piena per la grande intestazione della pagina dei dettagli. Ha fatto una grande differenza sulle prestazioni complessive dell'app.

## Trasferimento
PoliAule non ha account né sincronizzazione nel cloud, quindi una nuova funzione nelle Impostazioni ti permette di spostare da solo impostazioni e preferiti da un dispositivo all'altro.

Vengono codificati in un link: aprilo e PoliAule ti chiede se vuoi importarli. Puoi condividere il link direttamente o inquadrare il codice QR che PoliAule genera per te.
