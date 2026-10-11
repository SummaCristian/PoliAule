---
version: 0.8.0
title: Tab Cerca e dettagli delle aule
---
- Aggiunto il tab Cerca: trova qualsiasi aula navigando tra campus ed edifici, o con una barra di ricerca
- Aggiunta la pagina dei dettagli dell'aula: una foto, il numero di posti, le dotazioni e l'orario completo della settimana
- Aggiunta una schermata iniziale per rendere più fluido il caricamento della pagina
- Aggiunto un passaggio rapido tra i selettori "Da" e "A" su mobile
- Aggiunta un'impostazione per scegliere il tab da aprire all'avvio
- Migliorato il tab Disponibili
<!-- more -->
Una delle versioni più grandi nella storia di PoliAule. Completa finalmente la UI con l'attesissimo tab Cerca e una pagina dei dettagli tutta nuova, dove puoi esplorare tutto quello che PoliAule sa di qualsiasi aula in qualsiasi campus.

Sono state ritoccate, migliorate o riscritte anche tante piccole cose: piccoli redesign, micro-animazioni e molta più cura per i dettagli.

## Selettori dell'orario
Su mobile i selettori dell'orario ora hanno un pulsante per passare direttamente dall'uno all'altro, senza chiuderli e riaprirli.

Inoltre limitano la scelta tra le 07:15 e le 20:15. Scegliendo un orario successivo si passa automaticamente al primo giorno valido.

## Schermata iniziale
Una schermata iniziale ora copre il tempo necessario a scaricare ed elaborare i dati all'avvio. Quando tutto è pronto, il logo di PoliAule scivola nell'header e rivela la UI.

## Tab predefinito
Scegli se PoliAule deve aprirsi sempre su un tab, Disponibili o Cerca, oppure ricordare l'ultimo che hai usato.

## Tab Cerca
Il tab Cerca è finalmente qui. Contiene un elenco annidato di campus, edifici e aule, con la loro disponibilità attuale e le loro dotazioni, più una barra di ricerca per trovare qualsiasi aula. Tocca un'aula per aprire la sua nuova pagina dei dettagli.

La ricerca cerca il testo tra i nomi di aule, edifici e campus. Ed è tollerante: dato che la maggior parte delle aule ha nomi come X.Y.Z, puoi scrivere spazi al posto dei punti.

## Dettagli dell'aula
Una pagina tutta nuova dedicata a una singola aula, con tutto quello che PoliAule sa di lei:

- La foto
- Lo stato attuale
- Il numero di posti, posti accessibili e postazioni con computer
- Le dotazioni
- L'orario completo dei prossimi 7 giorni

L'orario si adatta allo schermo: una vista di un solo giorno con un selettore della data già familiare su mobile, un orario settimanale completo su 7 righe su desktop.

> [!TIP]
> Anche se PoliAule gira interamente nel browser, alla pagina dei dettagli si arriva tramite un **hash** nell'URL, come poliaule.com/**#classroom/32**. La parte dopo il `#` non viene mai inviata al server, ma PoliAule la legge all'avvio e apre subito i dettagli dell'aula 32 (in questo caso la 2.0.1).
>
> Questo vuol dire che le pagine delle aule **si possono condividere come link!**

> [!WARNING]
> Questi URL potrebbero cambiare prima del rilascio stabile di PoliAule 1.0.0: sto cercando un modo per renderli più leggibili, usando i nomi delle aule invece degli ID.

## Tab Disponibili
Le aule nei risultati ora si possono toccare per aprire la loro pagina dei dettagli, proprio come nel tab Cerca.

L'intera sezione dei risultati è stata ricostruita quasi da zero. Le schede delle aule ora vengono disegnate solo quando servono, il che migliora molto le prestazioni sui dispositivi meno potenti, e anche sui telefoni più potenti durante alcune transizioni complesse (*coff* Safari *coff*).

> [!WARNING]
> Non è più possibile mostrare tutti gli edifici aperti. Il caricamento progressivo era necessario per avere buone prestazioni sui browser mobili, quindi ora ogni edificio parte chiuso, e aprirne uno chiude l'altro. Così il numero di schede a schermo resta sotto controllo.
