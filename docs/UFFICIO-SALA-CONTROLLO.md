# Ufficio — sala di controllo di StudioMap

> **Aggiornamento 14/11/2026:** Napoli non è più protetta: si lavora come le altre città, in StudioMap e nel CRM. La migration `20261114150215_office_naples_unlocked.sql` toglie il blocco anche dal database (va applicata prima o insieme al deploy). Le righe qui sotto che parlano di «Napoli esclusa/rifiutata/protetta» descrivono il comportamento precedente.

Stato al 12 novembre 2026. L'unità di lavoro dell'Ufficio è la **città**, non l'agente: ogni città attraversa le stesse fasi e l'Ufficio dice a che punto è, cosa la blocca e chi la sblocca.

Scoperta → Luoghi → Testi → Temi e presentazione → Itinerari → Controlli → Su Speaqi → Lingue e voce → Prezzo → Online → Venduta

## Cosa c'è (secondo incremento, 12/11)

- Comandi dalla riga della città, con piano e stima, conferma e avanzamento: scrivere i testi dei luoghi, scrivere temi e presentazione, inviare a Speaqi, mettere online. Bridge `POST /api/office/production/run` in StudioMap (stessi lavori dei suoi bottoni, ricevuta per `request_id`).
- Domande al Direttore: «cosa manca a X?», «a che punto sono le mappe?», anche da Telegram.
- Non fatto: la catena «porta X online» in un ordine solo, lingue e voce e prezzo dalla riga, costo speso per città, spesa nel registro budget dell'Ufficio.

## Cosa c'è (primo incremento)

- Vista «Città» come pagina di partenza di `/ufficio`: otto fasi per città, prossimo passo, link alla sezione di StudioMap, stima per i testi guida mancanti, credito OpenRouter.
- Bridge di sola lettura `POST /api/office/production/read` in StudioMap.
- Caricamento: il 3D si scarica solo se scelto e resta in cache; `/api/office` passa da ~45 a 6 letture.

## Fotografia di produzione (letta il 12/11, sola lettura)

- Pianificatore: ultima riga di `automation_job_runs` il 26/10, per tutti i job, backup compreso. Da verificare su Railway (`AUTOMATION_SCHEDULER_ENABLED`).
- Nessuna corsa di agente partita a orario (nessuna chiave `cron:`).
- Ultimi 30 giorni: Direttore 118 corse, Presentazioni 18, tutti gli altri 8. My Maps 3 su 3 fallite.
- Registro dei lavori fermo al 26/10: 8 lavori bloccati, 22 proposte del Direttore in attesa.
- StudioMap espone circa 190 operazioni; l'Ufficio ne raggiungeva 6 (4 letture).

## Operazioni da collegare

Legenda: ✅ c'è · 🔌 esiste in StudioMap/Speaqi, serve un bridge · 🆕 da costruire. Ogni bridge di scrittura segue le regole di sempre: `request_id` stabile, stima prima, riserva nel budget dell'Ufficio, ricevuta, Napoli rifiutata, niente pubblicazione senza clic.

**Produzione**
- 🔌 Creare la destinazione e avviare la scoperta dei luoghi (`/api/destinations/create`, `/discovery`)
- ✅ Importare da My Maps (fallisce in produzione: da riparare)
- 🔌 Aggiungere luoghi per nome, arricchire, foto e crediti (`/api/places/add-by-name`, `/api/google-photos`, `/api/image-credits/fill`)
- 🔌 Scrematura, doppioni, fuori area (`/api/places/culling`, `/duplicates`, `/outside-area`)
- 🔌 Testi mancanti e rigenerazione (`/api/generate`, `/api/editorial/regenerate`)
- 🔌 Otto temi, «Benvenuti» e presentazione, anche in blocco con stima (`/api/city-guide/run`, `/bulk`)
- 🔌 Audio della presentazione (`/api/intro-voice`)
- 🔌 Itinerari: ricerca, completamento, approvazione (`/api/itineraries/*`)
- 🔌 Trasporti (import GTFS, anteprima, pubblicazione)
- ✅ Fonti eventi · 🔌 raccolta e pubblicazione eventi (`/api/events/*`)

**Qualità**
- ✅ Rapporto qualità · 🔌 applicare le correzioni approvate
- ✅ «Tieni / Togli» da Telegram
- 🔌 Controllo categorie (`/api/categories/review`, `/api/places/categories/apply`)
- 🔌 Diagnosi, riparazione, cancello di readiness (`/api/map-diagnosis`, `/api/repair`, `/api/quality-gate`)
- 🔌 Cronologia e ripristino (`/api/history/*`)

**Pubblicazione**
- ✅ Arretrato «Da pubblicare» · 🔌 anteprima e invio di punti e itinerari (`/api/speaqi/points|routes/*`)
- 🔌 Creare la mappa su Speaqi, prezzo, descrizione (`/api/speaqi/bootstrap`, `/price`)
- 🔌 Mettere online, sempre col clic (`/api/speaqi/publish`)
- 🔌 «Prepara per la vendita»: testi, voce, concierge (Speaqi `sale-prep`)
- ✅ Lingue e audio · 🆕 audio solo dove c'è domanda, deciso dall'Ufficio

**Soldi e controllo**
- ✅ Credito OpenRouter nella vista Città · 🆕 quote Google
- 🆕 Costo per città: speso, stimato per finirla, incassato
- 🆕 Tetto di spesa per città
- 🆕 Rapporto del mattino: avanzato stanotte, aspetta te, fermo e perché

**Commerciale legato alla città**
- ✅ Presentazioni, bozze email, partner, enti, fatture, To Do
- 🆕 Città online → presentazione all'ente → bozza email → opportunità, fino al clic
- 🆕 Dopo la vendita: codici prepagati, QR e biglietti del partner
- 🆕 Aperture e acquisti per città, per scegliere la prossima

**Ordini**
- 🆕 «Porta Marsiglia online»: un ordine che diventa la catena, con stima prima di spendere
- 🆕 «Cosa manca a Lisbona?», «quanto costa finire Bologna?»
- 🆕 Notte di produzione: città e budget scelti la sera, esito al mattino

## Ordine proposto

1. Pianificatore e backup.
2. Primo bridge di scrittura: temi e presentazione (stima già in pagina, `/api/city-guide/run` esiste).
3. Pubblicazione: anteprima e invio a Speaqi, poi lingue e prezzo.
4. Ordine «porta X online» sul registro dei lavori.
5. Fasi dopo l'online: lingue e voce, prezzo, venduta (servono letture da Speaqi).
