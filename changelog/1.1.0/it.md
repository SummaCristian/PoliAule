---
version: 1.1.0
title: Un nuovo backend
---
- Rifinite animazioni e transizioni per un'esperienza più fluida
- Ridisegnate le schede delle aule con la foto dell'aula e un layout più moderno
- Rinnovato il backend: nuovi URL per le API, dati salvati su Cloudflare R2, niente più commit giornaliere. PoliAule dovrebbe essere più veloce, affidabile e scalabile che mai
- Aggiunto un nuovo endpoint delle API con gli orari e i giorni di apertura di campus ed edifici
- Preparate le basi per le novità in arrivo: la beta ora può avere un suo backend, così le nuove funzioni si possono testare senza toccare l'app stabile
<!-- more -->
Questa versione riguarda soprattutto il backend. Ho lavorato a una nuova architettura per rendere più semplice lo sviluppo delle funzioni future, quindi nell'uso di PoliAule non cambia molto.

Aspettati però novità a breve, e tieni d'occhio PoliAule Beta: con il nuovo backend posso pubblicare lì funzioni che dipendono dal backend senza toccare la versione stabile, il che vuol dire che posso finalmente sperimentare e portarti le novità prima. Restate sintonizzati!

> [!WARNING]
> Tutte le API sono state spostate su nuovi URL. Consulta il `docs/api.md` aggiornato per saperne di più.
