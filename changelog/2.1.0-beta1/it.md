---
version: 2.1.0-beta1
title: Preferiti in shuffle
---
- Riordina i Preferiti: una modalità di modifica, trascina per spostare e, su desktop, trascina una card o un edificio direttamente al loro interno
- Nuovi temi stagionali: Pasqua, Carnevale Ambrosiano, Pi Day, il compleanno del Poli e Sant'Ambrogio
- Halloween, Natale, Pasqua e Carnevale ora decorano anche Impostazioni, changelog e le altre pagine
- Un indicatore dello stato dei dati ridisegnato che segnala quando un controllo è fallito, e l'app ora cerca nuovi dati da sola
- Una nuova schermata "pagina non trovata", un set di icone più leggero e migliori SEO e anteprime dei link
- Tante correzioni e rifiniture
<!-- more -->
La prima beta dopo la 2.0.1, con un po' di tutto: una sezione Preferiti che finalmente si può riordinare, un calendario pieno di nuove festività e tanto lavoro sotto il cofano.

## Riordina i Preferiti
I Preferiti ora hanno una modalità di modifica: rimuovi elementi, annulla e ripristina, e trascinali per metterli nell'ordine che preferisci. Su desktop puoi anche trascinare una card di un'aula, o il nome di un edificio, direttamente nei Preferiti per aggiungerlo esattamente dove lo lasci. Se è già un preferito, viene spostato.

![Modifica dei Preferiti](media/favourites-edit.mp4#loop "Modalità di modifica: trascina per riordinare, rimuovi, annulla e ripristina")

![Trascinare un'aula nei Preferiti](media/favourites-drag-card.mp4#loop "Trascina la card di un'aula nei Preferiti")

![Trascinare un edificio nei Preferiti](media/favourites-drag-building.mp4#loop "O il nome di un edificio")

## Nuove festività
- **Pasqua**, dalla Domenica delle Palme a Pasquetta: un accento lilla, un uovo nascosto in un'aula per campus ogni giorno (toccalo per romperlo), petali di fiori, colombe e uova 3D e alberi in fiore sulla mappa Campus.
- **Carnevale Ambrosiano**, dal Giovedì grasso al Sabato grasso: un accento magenta, stelle filanti, coriandoli e un'aula mascherata per campus.
- **Pi Day**, il 14 marzo: il logotipo πoliAule, l'Aula π, le cifre di π che attraversano lo schermo alle 15:14 e, nella ricerca, un controllo di quante cifre decimali conosci.
- **Il compleanno del Poli**, il 29 novembre, con un banner che conta gli anni.
- **Sant'Ambrogio**, il 7 dicembre, ha un banner tutto suo dentro il Natale.

Pasqua e Carnevale portano anche un logo tutto loro. Halloween, Natale, Pasqua e Carnevale ora decorano anche Impostazioni, changelog e le altre pagine secondarie. Puoi disattivare tutto dalle Impostazioni.

## Stato dei dati
L'indicatore dello stato dei dati è stato ridisegnato. Segnala i controlli falliti, la regola con cui i dati risultano non aggiornati è stata corretta e PoliAule ora cerca nuovi dati da solo quando lasci la pagina aperta. Una prima visita senza dati non resta più bloccata.

## Sotto il cofano
- Una nuova schermata "pagina non trovata", sia come pagina statica sia dentro l'app
- Vengono distribuite solo le icone che PoliAule usa davvero, e sono stati corretti i problemi di accessibilità segnalati da Lighthouse
- robots.txt, sitemap, security.txt, immagini di copertina e tag Open Graph per i link condivisi
- Gli header sticky aspettano di diventare sticky solo quando possono, aggirando un problema di iOS Safari con la sua barra in basso
- Aggiornato Vitrium, e il vetro ora segue i suoi ruoli e stili
