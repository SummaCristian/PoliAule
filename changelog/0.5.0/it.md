---
version: 0.5.0
title: Nuovi risultati e layout desktop a due colonne
---
- Ridisegnati i risultati delle aule disponibili
- Aggiornato il layout desktop in un design a due colonne
- Aggiunte le dotazioni delle aule (prese, ethernet, proiettore, ecc.)
<!-- more -->
Il più grande miglioramento della UI finora. Il selettore del campus è l'ultimo elemento del tab Disponibili ancora in attesa del suo redesign, quindi presto l'attenzione si sposterà sul tab Cerca.

## Risultati
Le aule disponibili hanno una nuova UI dedicata: una lista di schede, una per **edificio**, ciascuna funziona come una fisarmonica. All'interno, una lista di schede più piccole mostra le singole **aule**.

Ogni aula mostra un grafico con la disponibilità dettagliata durante e attorno al periodo richiesto, più le icone delle **dotazioni** presenti in quell'aula.

## Layout a due colonne
Su desktop, quando c'è abbastanza spazio in orizzontale, il tab Disponibili ora mostra il contenuto su due colonne: a sinistra il modulo con tutti i suoi campi, a destra i risultati.

Si adatta ai dispositivi mobili e alle finestre desktop più strette, diventando un'unica colonna quando serve.

## Dotazioni delle aule
I dati sulle dotazioni delle aule ora arrivano da un'altra API REST del PoliMi, così PoliAule può mostrare le icone di ciò che offre ogni aula. Al momento sono supportati:

- Proiettore
- Microfono ambientale
- Luci regolabili
- Presa ethernet a ogni posto
- Presa elettrica a ogni posto
- Supporto alla videoconferenza
