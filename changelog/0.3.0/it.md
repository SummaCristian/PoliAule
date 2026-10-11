---
version: 0.3.0
title: Prima rifinitura di UI e UX
---
- Ridisegnato il selettore della data
- Ridisegnato il pulsante Cerca
- Corretta la sfocatura della tab bar su Android
<!-- more -->
Questa versione segna l'inizio di un'attenzione più ampia a UI e UX. Con le funzionalità di base ormai implementate e testate, lo sviluppo si sposta sulla rifinitura del flusso principale, a partire dal redesign dei suoi primi componenti chiave.

## Selettore della data
Il selettore della data ora ha un layout in linea personalizzato che mostra solo i giorni per cui sono stati scaricati i dati. Le date disponibili si vedono subito, e sceglierne una è più rapido e intuitivo.

- La data di oggi è ben evidenziata
- Le domeniche, quando il PoliMi è chiuso, si distinguono dagli altri giorni
- Più risalto al giorno della settimana, spesso più utile della data esatta
- Le date non disponibili sono sparite, quindi non serve più correggere la scelta a posteriori

## Pulsante Cerca
Il pulsante principale "Cerca" è stato ridisegnato per rispecchiare meglio il design system di PoliAule. È la base per le azioni principali in tutta l'app, e fissa un linguaggio visivo coerente per i componenti futuri.

## Correzioni
- Corretti i problemi di trasparenza su Android: Google Chrome e i browser basati su Chromium ora mostrano la UI correttamente, mentre Samsung Internet usa un colore pieno di ripiego per via del suo supporto CSS limitato
