---
version: 2.0.0-beta6
title: La mappa del campus
---
- Ridisegnato il tab Campus
- Aggiunta una mappa con tutti gli edifici di un campus
- Aggiunta un'opzione per disattivare l'effetto vetro, per prestazioni migliori sui dispositivi più lenti
<!-- more -->
## Tab Campus e mappa
Il tab Campus è stato ridisegnato da zero per un'esperienza migliore e più completa.

Ora ha una mappa a schermo intero, basata su Mapbox, in cui puoi esplorare liberamente i campus in 3D e vedere tutti gli edifici e dove si trovano, comodissima nei campus più grandi come Leonardo o Bovisa.

Accanto alla mappa c'è una griglia di edifici più classica, per trovare in fretta quello che cerchi. Usa una delle due viste, o entrambe insieme.

Tocca un edificio per vedere le aule al suo interno.

## Prestazioni
L'effetto più costoso nella versione di Liquid Glass di PoliAule è la sfocatura. Alcune GPU, soprattutto sui dispositivi più economici, e alcuni browser faticano a calcolarla in tempo reale, e le prestazioni diventano pessime quando viene usata tanto quanto in PoliAule.

Ora, la prima volta che PoliAule si apre, esegue un test nascosto per capire se il tuo dispositivo regge la sfocatura completa. Se non ce la fa, PoliAule usa un materiale vetro più semplice, più opaco e senza sfocatura, che ha un aspetto simile a una frazione del costo. Puoi sempre forzare l'una o l'altra scelta nelle Impostazioni.

> [!NOTE]
> Il test viene eseguito solo la prima volta che PoliAule si apre, e il risultato viene salvato nel browser. I browser tengono questi dati separati per ogni (sotto)dominio, quindi PoliAule e PoliAule Beta non li condividono.
