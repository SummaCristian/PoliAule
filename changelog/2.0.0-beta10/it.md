---
version: 2.0.0-beta10
title: Ultimi ritocchi
---
- Migliorate le prestazioni in tutta la webapp
- Aggiunto il meteo live nella mappa del tab Campus
- Aggiunta la schermata Changelog
- Risolti alcuni bug

<!-- more -->
## Prestazioni

Ho svolto diversi round di test automatizzati per identificare tutte le possibili sorgenti di lag e ne ho ridotte il maggior numero possibile.

Ora PoliAule dovrebbe essere più fluido che mai anche su dispositivi più datati.

## Meteo live nella mappa

La mappa nel tab Campus ora riflette le previsioni del meteo per il Campus selezionato. La pioggia e la neve sono supportate con vari livelli di intesità.

La mappa mostra anche delle ombre realistiche in base all'ora del giorno, ma solamente col tema chiaro. Il tema scuro rimane scuro.

## Schermata Changelog

Aggiunta un'intera pagina dedicata ai cambiamenti delle varie versioni di PoliAule, attuale e passate.

Hey, se stai leggendo questo, l'hai già trovata!

Qui troverai tutte le informazioni su quello che sta succedendo dietro le quinte di PoliAule. Attiva i changelog beta e saprai anche a cosa sto lavorando prima di chiunque altro.

I nuovi aggiornamenti sono anche mostrati nel tab Disponibili per la prima settimana dopo il rilascio, per essere sicuri che non ti perda mai nulla di nuovo.

## Bug risolti

Ho finalmente trovato il tempo di svuotare l'elenco di bug che dovevo risolvere. Questo molto probabilmente non significa che ora non ce ne siano più, semplicemente significa che non ne conosco altri (per il momento).

Qui c'è una piccola lista di quello che ho risolto:

- Risolto un bug che causava un crash in Google Chrome su Android quando una specifica combinazione di navigazioni indietro, sia tramite il pulsante di PoliAule che tramite quello del browser/sistema operativo, era eseguita. Sto ancora cercando di capire quale sia il problema nello specifico, ma credo che sia colpa di Chrome (crasha l'intero renderer XO). Nel frattempo, niente animazione quando tornate indietro usando il tasto indietro di sistema o la gesture indietro di sistema
- Il popup delle impostazioni e il pannello del tab Campus non vanno più a finire dietro la barra superiore quando eseguito in forma di PWA
- Safari aveva di nuovo deciso che non gli piaceva come stavo posizionando lo sheet, troppo vicino alla safe-area inferiore. Adesso però sembra accettarla senza colorare la safe-area di un colore solido
- L'algoritmo di debounce della ricerca ora non ignorerà più quello che scrivi se vai troppo veloce. Non c'è di che.
- Le aule di cui non ho trovato dati non vengono più riportate come libere. Ora sono mostrate come "Non Disponibile" e non vengono più conteggiate tra le aule libere.

## Un ultima cosa

Se sei arrivato fino a qui, ti meriti qualcosina. Ho aggiunto alcuni easter egg qua e là. Alcuni sono piccoli, altri sono un po' più grandi. non voglio spoilerare troppo, per cui dirò solamente due cose: TEMI STAGIONALI e MOLTO PRESTO. Capirai.
