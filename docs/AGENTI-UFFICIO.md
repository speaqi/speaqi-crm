# Ufficio Speaqi — gli agenti da costruire

Ogni prompt qui sotto è pensato per essere incollato così com'è in ChatGPT (o Codex) che lavora sui repository. **Si parte dal prompt 0**, la base comune: gli altri agenti la danno per esistente.

Regole che valgono per tutti (sono ripetute in ogni prompt, apposta):
- **Il modello propone, il codice decide.** Quello che esce dall'AI viene controllato contro dati veri prima di scrivere qualcosa.
- **Nessun invio verso l'esterno senza un clic umano.** Non partono email, post, fatture o pubblicazioni di mappe. L'agente prepara **bozze** e le mette in «Aspetta te» nella prima pagina del CRM.
- **Napoli in produzione è intoccabile.** Niente generazioni, rigenerazioni, sync o deploy sulla mappa di Napoli. Le prove si fanno su Marsiglia o Barcellona.
- **Budget prenotato prima di spendere.** Ogni chiamata a un modello riserva la stima, poi salda col costo vero. A budget finito l'agente si ferma e lo dice.
- **Una corsa alla volta, idempotente.** Ripetere una corsa non raddoppia niente.

Repository: `speaqi/speaqi-crm` (Next.js 15 + Supabase, il CRM), `speaqi/studiomap` (dove si costruiscono le mappe), `speaqi/speaqi` (NestJS + Next, guide pubbliche). Ogni repository ha un `CLAUDE.md` / `docs/claude/*.md` con le regole: **va letto prima di scrivere codice**.

| # | Agente | Reparto | Cadenza | Budget indicativo | Dove vive |
|---|---|---|---|---|---|
| 0 | Base comune (registro, budget, corse, /ufficio) | — | — | — | CRM |
| 1 | Direttore | Direzione | settimanale (lunedì 7:00) | 1 €/settimana | CRM |
| 2 | Costruttore di mappe da My Maps | Mappe | ogni 2 giorni | 3 €/corsa | StudioMap |
| 3 | Lingue e voce | Mappe | giornaliero (notte) | 15 €/giorno | StudioMap → Speaqi |
| 4 | Controllo qualità mappe | Mappe | giornaliero | 2 €/giorno | StudioMap |
| 5 | Pulizia del database | Operazioni | settimanale (domenica) | 0,50 €/settimana | CRM |
| 6 | Ricercatore eventi e fiere | Ricerca | ogni 2 giorni | 1 €/corsa | CRM |
| 7 | Osservatorio novità | Ricerca | giornaliero | 0,30 €/giorno | CRM |
| 8 | Arricchimento enti | Ricerca | giornaliero | 2 €/giorno | CRM (Tourism Intelligence) |
| 9 | Presentazioni | Commerciale | su richiesta + settimanale | 3 €/settimana | CRM |
| 10 | Commerciale (bozze follow-up) | Commerciale | giornaliero (feriali 8:00) | 1 €/giorno | CRM |
| 11 | Finanza | Finanza | giornaliero | 0,20 €/giorno | CRM |
| 12 | Social | Marketing | settimanale | 1 €/settimana | CRM |

---

## Prompt 0 — Base comune: registro degli agenti, budget, corse, pagina /ufficio

```
Lavori sul repository speaqi/speaqi-crm (Next.js 15 App Router, TypeScript strict, Supabase con RLS, deploy su Railway). Prima di tutto leggi CLAUDE.md: contiene convenzioni, tabelle esistenti e regole (commenti e testi in italiano, test con node:test via tsx, logica pura in src/lib/*.ts con test, logica server in src/lib/server/*.ts, rotte /api/automation/* protette da AUTOMATION_SECRET, pianificatore interno in src/lib/automation-schedule.ts + src/lib/server/automation-scheduler.ts, pagine riservate al titolare in SUPER_ADMIN_PATHS di src/lib/areas.ts).

Obiettivo: costruire la base su cui gireranno tutti gli "agenti" dell'ufficio Speaqi. Un agente è un lavoro ricorrente con un compito, una cadenza, un budget e un registro di cosa ha fatto. Nessun agente in questo prompt: solo l'infrastruttura.

1. Migration Supabase (nuovo file in supabase/migrations/, timestamp successivo all'ultimo):
   - office_agents: id (slug testo, es. 'director'), user_id (proprietario), name, department ('direzione','mappe','ricerca','commerciale','finanza','marketing','operazioni'), description, enabled boolean default false, schedule_job text (nome del job in AUTOMATION_JOBS), model text, daily_budget_cents int, weekly_budget_cents int, monthly_budget_cents int, settings jsonb, created_at, updated_at. RLS: solo il proprietario.
   - office_agent_runs: id uuid, agent_id, user_id, started_at, finished_at, status ('running','done','partial','failed','skipped_budget','skipped_disabled'), summary text (una frase in italiano leggibile, es. "Preparate 4 bozze di follow-up"), items_created int, cost_cents_reserved int, cost_cents_actual int, error text, details jsonb. Indice su (agent_id, started_at desc). Tenuta 90 giorni.
   - office_agent_outputs: id uuid, agent_id, run_id, user_id, kind ('draft_email','draft_post','task','report','proposal','data_fix','map_job'), title, body jsonb, status ('pending','approved','rejected','done'), target_table text, target_id text, created_at, decided_at. Sono le cose che aspettano una decisione umana.
   - office_budget_ledger: id, agent_id, user_id, run_id, day date (fuso Europe/Rome), reserved_cents, actual_cents, model, tokens_in, tokens_out, created_at.
   - RPC reserve_agent_budget(p_agent_id, p_cents) security definer eseguibile solo da service_role: in una transazione con lock sulla riga dell'agente controlla speso+riservato di giorno, settimana e mese contro i tre tetti e, se c'è spazio, inserisce la riserva e restituisce l'id; altrimenti restituisce null. settle_agent_budget(p_ledger_id, p_actual_cents, tokens...) salda col costo vero.

2. src/lib/server/office-agents.ts:
   - runAgent(agentId, handler): legge l'agente; se disabilitato registra 'skipped_disabled'; apre la corsa ('running'); un agente con una corsa 'running' più recente di 30 minuti salta il turno; chiama handler(ctx) dove ctx ha reserve(cents)/settle(), addOutput(), log(); chiude la corsa con stato, riepilogo e costi; un errore non lancia fuori ma finisce in 'failed' con il messaggio.
   - callModel(ctx, {model, input, maxOutputTokens}): stima il costo dal listino (una tabella prezzi per modello in src/lib/office-pricing.ts, pura e testata), prenota, chiama OpenAI (usa la chiave e il client già presenti nel repo), salda col costo vero dai token restituiti. Senza budget lancia BudgetExceeded, che runAgent trasforma in 'skipped_budget' o 'partial'.
   - Nessun agente può mandare email, pubblicare o inviare fatture: per costruzione scrive solo in office_agent_outputs o in tabelle di bozze esistenti (email_drafts, ecc.).

3. Rotta POST /api/automation/agents/[id]/run (AUTOMATION_SECRET) che esegue l'agente indicato; un registro src/lib/server/office-agents/registry.ts mappa id → handler. Per ogni agente si aggiunge una riga in AUTOMATION_JOBS.

4. API per il titolare (requireWorkspaceOwner in src/lib/server/owner-auth.ts): GET /api/office (agenti, ultime corse, spesa di oggi/settimana/mese per agente e totale, uscite in attesa), PATCH /api/office/agents/[id] (accendi/spegni, budget, impostazioni), POST /api/office/agents/[id]/run-now, PATCH /api/office/outputs/[id] (approva/rifiuta).

5. Prima pagina: nel componente src/components/crm/CommandCenter.tsx aggiungi un riquadro "Ufficio" piccolo: agenti attivi, spesa di oggi, uscite in attesa, link a /ufficio. Le uscite in attesa compaiono anche in "Aspetta te" (buildWaiting in src/lib/command-center.ts, con test).

6. Pagina /ufficio (aggiungila a SUPER_ADMIN_PATHS e alla sidebar nel gruppo Solo admin): elenco per reparto, per ogni agente interruttore, budget, ultima corsa con riepilogo, spesa, pulsante "Fai girare adesso", e la coda delle uscite da approvare. Niente 3D in questa fase: tabella pulita e veloce, funziona da telefono.

7. Test: listino e calcolo costi, prenotazione oltre il tetto rifiutata (anche con due corse in parallelo: test su Postgres vero con tests/db.sh, come già fatto per le campagne), corsa doppia saltata, errore che finisce in 'failed'.

8. Aggiorna CLAUDE.md (tabelle, variabili, comportamento) e .env.local.example. Tutti gli agenti nascono spenti (enabled=false).

Consegna: migration, codice, test verdi (npm run test:unit e test:db), npx tsc --noEmit pulito, next build ok.
```

---

## Prompt 1 — Direttore (sceglie su cosa lavorare la settimana)

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0 (office_agents, runAgent, callModel, office_agent_outputs). Leggi CLAUDE.md.

Agente id 'director', reparto 'direzione', ogni lunedì alle 7:00 Europe/Rome, budget 1 €/settimana, modello di ragionamento economico (configurabile in settings.model).

Compito: ogni settimana propone al titolare le priorità, cioè quali città costruire o pubblicare, quali enti contattare e cosa sta fermo. Non decide al posto suo: produce un report e delle proposte da approvare.

Dati in ingresso (tutti letti dal codice, il modello riceve solo un riassunto strutturato):
- Stato delle mappe: loadMapsStatus() in src/lib/server/maps-status.ts (catalogo StudioMap + guide Speaqi online, con luoghi e luoghi pronti).
- Porti e superguide: shipping_ports (vista su tourism_hubs mode='sea') con guide_status, guide_priority, passengers, destination; tourism_destinations con guide_status, guide_priority, intl_arrivals.
- Soldi e vendite: summarizeMoney e trattative aperte (stesse query di /api/command-center).
- Ultime corse degli altri agenti (office_agent_runs degli ultimi 7 giorni): cosa è fallito, cosa ha speso.

Regole di priorità (scritte nel codice, non lasciate al modello, in src/lib/office/director.ts puro e testato):
- Una città con guide_status 'planned' e guide_priority 1, molti passeggeri o arrivi misurati e nessuna mappa in StudioMap viene prima di tutto.
- Una mappa 'pronta' in StudioMap ma non su Speaqi è lavoro quasi finito: va proposta per la pubblicazione.
- Una mappa su Speaqi con traduzioni sotto il 90% va proposta all'agente Lingue e voce.
- Napoli è esclusa da qualunque proposta di generazione o modifica.

Il modello serve solo a scrivere il testo del report: tre-cinque righe in italiano semplice per punto, senza inventare numeri (ogni numero nel testo deve esistere nei dati passati; se il controllo trova un numero che non c'è, il punto si riscrive senza).

Uscite:
- un office_agent_outputs kind='report' "Priorità della settimana" (titolo, punti ordinati, dati usati);
- un output kind='proposal' per ogni azione concreta (es. "Costruire Marsiglia da My Maps", "Pubblicare Bari", "Completare le lingue di Capri"), con target_table/target_id. Approvare una proposta la mette in coda all'agente giusto (impostazione settings.queue dell'agente destinatario); rifiutarla la toglie per 4 settimane.

Test: ordinamento delle priorità su dati finti, Napoli mai proposta, numeri inventati scartati. Aggiorna CLAUDE.md.
```

---

## Prompt 2 — Costruttore di mappe da My Maps

```
Lavori su speaqi/studiomap. Leggi prima il CLAUDE.md e i documenti del repository: descrivono importazione, gate di pubblicazione e regole. Regola assoluta: Napoli in produzione è intoccabile, le prove si fanno su Marsiglia o Barcellona.

Agente id 'mymaps_builder', reparto 'mappe', ogni 2 giorni di notte, budget 3 €/corsa. L'agente gira in StudioMap; registro e budget stanno nel CRM (speaqi-crm, tabelle office_agents/office_agent_runs/office_budget_ledger del prompt 0). Esponi da StudioMap un endpoint protetto da segreto condiviso che il CRM chiama, e restituisci al CRM costo e riepilogo della corsa.

Compito: partendo da un elenco di mappe Google My Maps (URL o id, messi in coda dal titolare o dalle proposte approvate del Direttore), creare o aggiornare in StudioMap la città corrispondente:
1. Scarica il KML della My Maps (export pubblico). Se non è pubblica, si ferma e lo dice.
2. Per ogni punto: nome, coordinate, descrizione, cartella/categoria. Normalizza i nomi, mappa le cartelle sulle categorie standard di StudioMap, scarta doppioni (stesse coordinate entro 30 m e nome simile).
3. Abbina ai luoghi già presenti in StudioMap (per place_id se c'è, poi per nome + distanza): un luogo esistente si aggiorna solo nei campi vuoti, mai sovrascritto.
4. I luoghi nuovi entrano in stato "da completare": il testo lo scrive la pipeline esistente di StudioMap, non questo agente. L'agente non inventa descrizioni.
5. Massimo 150 luoghi nuovi per corsa; il resto alla corsa dopo.
6. Non pubblica mai su Speaqi: quando la città supera il gate di StudioMap, crea nel CRM un output kind='proposal' "Pubblicare <città>".

Riepilogo della corsa (una frase): "Marsiglia: 84 luoghi letti, 61 nuovi, 12 già presenti, 11 scartati (doppioni)".

Test: parser KML su un file di esempio, abbinamento e doppioni, Napoli rifiutata dal codice anche se messa in coda.
```

---

## Prompt 3 — Lingue e voce

```
Lavori su speaqi/studiomap e speaqi/speaqi. Leggi docs/claude/translations.md e la sezione "Prepara per la vendita (sale-prep)" di docs/claude/maps.md nel repo speaqi: l'infrastruttura c'è già (GET/POST /maps/:id/studiomap/sale-prep, POST /maps/:id/studiomap/translations/fill con dry_run e stima del costo, testi in differita a metà prezzo, voce Gemini Flash Lite). Questo agente NON riscrive la pipeline: la chiama.

Agente id 'languages_voice', reparto 'mappe', ogni notte alle 2:00 Europe/Rome, budget 15 €/giorno (la voce è la voce più cara: circa 80% del costo). Registro e budget nel CRM (prompt 0).

Compito:
1. Prende le mappe in coda (proposte approvate dal Direttore o aggiunte dal titolare). Napoli è sempre esclusa, anche se in coda.
2. Per ogni mappa chiama prima il dry_run: riceve quante traduzioni e audio mancano e la stima in dollari (estimate.total_usd). Converte in euro con un cambio in impostazione.
3. Se la stima sta nel budget rimasto, prenota e lancia "Genera le mancanti" con include ['missing','failed','stuck'] e testi in differita. Se non ci sta, lancia solo i testi (costano poco) e rimanda l'audio alla notte dopo, dicendolo nel riepilogo.
4. Il costo vero si legge a fine giro: per i testi in differita da translation_batches.cost_usd, per l'audio dalla stima (finché non c'è un costo vero esposto) — dichiarando quale delle due.
5. Non fa mai "Aggiorna le vecchie" (outdated) da solo: quelle le propone come output kind='proposal' con il costo.
6. A fine giro, se la mappa è online, controlla che la percentuale tradotta sia salita e scrive il riepilogo: "Capri: 11 lingue, testi 1.240/1.260, audio 980/1.260, speso 9,40 €".

Test: decisione budget/testi/audio su dati finti, Napoli rifiutata, nessun outdated lanciato in automatico.
```

---

## Prompt 4 — Controllo qualità mappe

```
Lavori su speaqi/studiomap. Leggi il CLAUDE.md. Napoli è intoccabile: questo agente su Napoli può solo LEGGERE e segnalare, mai modificare.

Agente id 'maps_quality', reparto 'mappe', ogni giorno, budget 2 €/giorno, modello economico.

Compito: trovare nelle mappe i problemi che un turista noterebbe, e metterli in fila per il titolare. Non corregge da solo.
Controlli deterministici (gratis, nel codice, puri e testati):
- luoghi senza foto, con foto ripetuta su più luoghi, con coordinate fuori dalla città o a 0,0;
- testi vuoti, troppo corti (sotto 300 caratteri), o identici fra due luoghi;
- orari o telefoni in formato impossibile;
- luoghi chiusi definitivamente secondo Google Places (se il dato è già in StudioMap);
- traduzioni in alfabeto sbagliato o molto più corte dell'originale.
Controllo con il modello (solo su un campione di 20 luoghi per corsa, a rotazione): il testo contiene affermazioni non supportate dalle fonti salvate del luogo? Il modello riceve testo e fonti, risponde in JSON strict con le frasi sospette; il codice tiene solo le frasi che esistono davvero nel testo.

Uscite: un output kind='report' per mappa con i problemi raggruppati e il numero; per i problemi gravi (coordinate sbagliate, luogo chiuso) un output kind='data_fix' con la correzione proposta, da approvare.

Test: ogni controllo deterministico su dati finti, frasi inventate dal modello scartate.
```

---

## Prompt 5 — Pulizia del database

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0. Leggi CLAUDE.md, in particolare "Data Loading": decine di migliaia di contatti, quasi tutti holding. Mai caricarli tutti in memoria: si lavora a pagine di 1000 con query mirate.

Agente id 'db_cleaner', reparto 'operazioni', ogni domenica alle 4:00, budget 0,50 €/settimana (quasi tutto è deterministico).

Compito: trovare sporcizia e proporre la pulizia. Non cancella e non unisce mai da solo.
- Contatti doppi: stessa email (minuscole, senza spazi), stesso telefono normalizzato (+39), o stesso nome azienda + città. Per ogni gruppo indica quale tenere (quello con più attività, trattative o preventivi) e cosa si sposterebbe.
- Email non valide o di ruolo che non vanno usate (noreply@, pec usate come email normali): segnala.
- Contatti in pipeline (scope crm) fermi da più di 90 giorni senza attività né prossimo passo.
- Preventivi in bozza più vecchi di 60 giorni; trattative aperte su contatti chiusi.
- Enti di Tourism Intelligence con nome quasi uguale (name_key simile).
Il modello si usa solo per spiegare in una frase i casi ambigui.

Uscite: un output kind='report' con i numeri e, per ogni categoria, un output kind='data_fix' con la lista. Approvare un data_fix di doppioni esegue l'unione con una RPC transazionale (sposta attività, task, trattative, preventivi, email sul contatto da tenere, poi nasconde l'altro con hidden=true e una nota; nessun DELETE).

Test: rilevamento doppioni su dati finti, RPC di unione su Postgres vero (tests/db.sh) che non perde righe.
```

---

## Prompt 6 — Ricercatore eventi e fiere

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0. Leggi CLAUDE.md (sezione Fiere: tabella trade_fair_exhibitors, pagina /fiere).

Agente id 'events_scout', reparto 'ricerca', ogni 2 giorni, budget 1 €/corsa, modello economico con ricerca web.

Compito: trovare fiere, eventi e bandi del turismo utili a Speaqi (enti del turismo, crociere, musei, DMC, hospitality, wine) nei prossimi 6 mesi, in Italia e nei mercati europei principali.
1. Interroga una lista di fonti in settings.sources (siti di calendari fiere, ENIT, ministeri, regioni, associazioni di categoria) e la ricerca web con query fisse in settings.queries.
2. Per ogni evento estrae: nome, date, città, organizzatore, link ufficiale, tipo (fiera, workshop B2B, bando, conferenza), scadenze (iscrizione espositori, bando).
3. Il codice scarta: date passate, eventi senza link ufficiale, doppioni (stesso nome normalizzato e stesse date).
4. Punteggio di pertinenza scritto nel codice (parole chiave e tipo), non deciso dal modello.

Uscite: un output kind='report' "Eventi e bandi" con i nuovi trovati, ordinati per scadenza; per ogni evento con scadenza entro 30 giorni un output kind='task' "Decidere se partecipare a ..." che, approvato, crea un task standalone nel To Do (tasks con contact_id null, area 'speaqi').

Non scrive in trade_fair_exhibitors (quella è per gli espositori di una fiera). Se serve una tabella eventi, crea office_events con unicità su (user_id, slug, start_date).

Test: estrazione da una pagina di esempio salvata, doppioni, date passate scartate.
```

---

## Prompt 7 — Osservatorio novità

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0.

Agente id 'news_watch', reparto 'ricerca', ogni giorno alle 7:00, budget 0,30 €/giorno, modello economico.

Compito: una rassegna breve delle novità che contano per Speaqi: turismo (crociere, arrivi, regole, finanziamenti), mappe e guide digitali, concorrenti (STQRY, Cuseum, SmartGuide, VoiceMap, Locatify: elenco in settings), AI applicata al turismo, prezzi e modelli AI che Speaqi usa (OpenAI, Gemini, OpenRouter).
1. Legge feed RSS e pagine in settings.feeds; solo articoli delle ultime 48 ore.
2. Scarta doppioni (stesso link o titolo quasi uguale) e articoli già visti (tabella office_news_seen).
3. Il modello riassume al massimo 8 notizie, ognuna in due righe con il perché conta per Speaqi. Il link è obbligatorio e deve essere uno di quelli letti (il codice scarta link inventati).

Uscita: un output kind='report' "Novità di oggi". Se il titolare attiva settings.telegram=true, il riepilogo esce anche sul bot Telegram già configurato nel CRM (notificationChannel in src/lib/server/whatsapp.ts), come messaggio interno.

Test: filtro 48 ore, doppioni, link inventati scartati.
```

---

## Prompt 8 — Arricchimento enti (Tourism Intelligence)

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0. Leggi CLAUDE.md, sezioni Tourism Intelligence (tourism_entities, tourism_relations, tourism_destinations, tourism_evidence, tourism_crm_links) e il worker di ricerca esistente (TOURISM_RESEARCH_ENABLED, fetchResearchPage con fetch sicuro). Riusa quello che c'è.

Agente id 'entity_enricher', reparto 'ricerca', ogni giorno, budget 2 €/giorno.

Compito: per le destinazioni prioritarie (guide_priority 1-2, oppure proposte dal Direttore) trovare chi è l'ente giusto da contattare e completarne la scheda: sito, email generale, telefono, chi decide (ufficio turismo, assessorato, DMO, consorzio), relazioni COVERS/MANAGES/PROMOTES.
Regole:
- Ogni dato scritto deve avere una evidenza in tourism_evidence con URL e frase della fonte. Niente fonte, niente dato.
- Email personali di persone fisiche: non si raccolgono. Solo indirizzi istituzionali pubblicati sul sito dell'ente.
- Si riempiono solo i campi vuoti; un campo già scritto a mano non si tocca.
- Massimo 10 enti per corsa.

Uscite: i dati verificati vanno nelle tabelle Tourism (con evidenza); un output kind='report' con cosa è stato trovato; per ogni ente pronto (sito + email + relazione con la destinazione) un output kind='proposal' "Creare il contatto nel CRM e preparare la presentazione" che, approvato, crea il contatto (scope crm), il link tourism_crm_links e mette l'ente in coda all'agente Presentazioni.

Test: dato senza evidenza rifiutato, campo già compilato non sovrascritto.
```

---

## Prompt 9 — Presentazioni

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0. Leggi CLAUDE.md, sezione "Presentazioni per destinazione (Tourism Intelligence)": generazione, modello, segnaposto [DA VERIFICARE], approvazione e PDF esistono già (tourism_decks, tourism-deck-agent.ts). Questo agente usa quella pipeline, non ne crea un'altra.

Agente id 'presentations', reparto 'commerciale', su richiesta (coda) più un giro settimanale, budget 3 €/settimana.

Compito:
1. Per ogni ente in coda (dall'Arricchimento enti o messo dal titolare), crea la presentazione con i dati dell'ente e della destinazione, avvia la generazione e aspetta l'esito.
2. Non approva mai: una presentazione pronta va in "Aspetta te" come "Presentazione da approvare" (c'è già in buildWaiting).
3. Elenca i segnaposto [DA VERIFICARE] rimasti e, per ognuno, prova a trovare il dato nelle evidenze di Tourism Intelligence; se lo trova con fonte, propone la correzione come output kind='data_fix'; altrimenti lo lascia segnalato.
4. Quando il titolare approva una presentazione, prepara la bozza email all'ente con il link pubblico, nel motore email_drafts esistente (mai invio: la bozza si manda a mano da /email o da Gmail).

Test: niente approvazione automatica, la bozza email nasce solo dopo l'approvazione, un segnaposto si chiude solo con un dato che ha la fonte.
```

---

## Prompt 10 — Commerciale (bozze di follow-up)

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0. Leggi CLAUDE.md, sezioni Email AI Drafts, sla.ts (cadenza dei follow-up), Wine Project e Commerciale. Le bozze email si generano già con src/lib/server/email-drafts.ts: questo agente lo chiama.

Agente id 'sales_followup', reparto 'commerciale', feriali alle 8:00, budget 1 €/giorno.

Compito: ogni mattina preparare le bozze delle email che il titolare dovrebbe mandare oggi, così le trova pronte in /email.
- Chi: contatti in pipeline con follow-up scaduto o di oggi, preventivi inviati e non firmati da più di 5 giorni, preventivi firmati e non pagati da più di 3 giorni, rinnovi di abbonamento entro 30 giorni (email di cortesia), trattative ferme da più di 14 giorni.
- Esclusi: disiscritti, chi ha risposto dopo l'ultima email, contatti hidden, holding (quelli sono delle campagne), chi ha già una bozza in attesa.
- Massimo 15 bozze al giorno, in ordine di valore (preventivo più alto prima).
- Ogni bozza dice nel campo nota perché è stata preparata ("preventivo PRV-2026-0042 inviato 7 giorni fa, non firmato").

Non manda niente: il passo d'invio resta quello umano esistente (Prepara in Gmail / invio da /email).

Uscita: riepilogo "Preparate 9 bozze: 4 preventivi da firmare, 3 follow-up, 2 rinnovi".

Test: selezione ed esclusioni su dati finti, tetto di 15, nessuna doppia bozza.
```

---

## Prompt 11 — Finanza

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0. Leggi CLAUDE.md, sezioni Fattura elettronica (Aruba), Abbonamenti annuali e Stripe. Fatture in bozza e stato SDI esistono già: questo agente non invia fatture, mai.

Agente id 'finance', reparto 'finanza', ogni giorno alle 8:30, budget 0,20 €/giorno (quasi tutto deterministico).

Compito: tenere in ordine i soldi e dire al titolare cosa fare.
- Preventivi pagati senza fattura: per ciascuno prepara la bozza con createInvoiceDraftFromQuote (idempotente) e la segnala.
- Fatture in bozza con problemi (invoiceProblems): elenca cosa manca (CAP, codice destinatario...) e, se il dato è nel contatto collegato, propone la correzione come output kind='data_fix'.
- Fatture scartate o non consegnate: spiega il motivo SDI in una frase.
- Pagamenti Stripe falliti (subscription_status past_due): propone una bozza email di sollecito gentile (email_drafts).
- Bonifici attesi: preventivi accettati a bonifico non pagati da più di 15 giorni → bozza di sollecito.
- Il primo di ogni mese: report "Mese chiuso" con incassato, fatturato, da fatturare, rinnovi del mese, differenze fra incassato e fatturato.

Uscite: report e data_fix; tutto quello che riguarda soldi va in "Aspetta te". Nessun invio allo SDI e nessuna email partono da qui.

Test: calcoli del mese nel fuso italiano, idempotenza delle bozze, nessuna chiamata ad Aruba upload in nessun percorso dell'agente.
```

---

## Prompt 12 — Social

```
Lavori su speaqi/speaqi-crm, sulla base del prompt 0.

Agente id 'social', reparto 'marketing', ogni lunedì, budget 1 €/settimana.

Compito: preparare le bozze dei post della settimana (Instagram, LinkedIn, Facebook) per far conoscere le guide Speaqi. Non pubblica mai: le bozze vanno in office_agent_outputs kind='draft_post' da approvare e copiare a mano (o, in futuro, da mandare a uno strumento di pubblicazione con un clic).
- Materia prima: le guide online (loadMapsStatus + payload pubblico delle mappe: numero di luoghi, lingue, itinerari, foto), le novità della settimana (mappe pubblicate, lingue aggiunte), e i luoghi più aperti se disponibili.
- 3-5 bozze: per ognuna testo per piattaforma, hashtag (al massimo 5), link alla guida con UTM (utm_source=<piattaforma>&utm_medium=social&utm_campaign=office_social), e la foto suggerita presa dalla mappa (URL esistente, mai generata).
- Ogni numero nel testo (luoghi, lingue, minuti di audio) deve venire dai dati: il codice scarta il post se trova un numero che non c'è.
- Tono: quello di Speaqi, semplice, niente superlativi vuoti, niente promesse non vere. Nessun post su Napoli diverso da quelli già approvati.

Test: numeri inventati scartati, link con UTM corretti, nessuna chiamata di pubblicazione.
```

---

## Dopo: l'ufficio in 3D

Quando gli agenti girano davvero, la pagina /ufficio può diventare anche la scena 3D del prototipo, con un omino per agente. Il prototipo è su [claude.ai/artifact/Hi1UAE2wAK6Wqiw75bPNSZ](https://claude.ai/artifact/Hi1UAE2wAK6Wqiw75bPNSZ). Legge `GET /api/office`: reparto, stato (al lavoro / fermo / in errore), spesa di oggi e ultima corsa. È solo un'aggiunta: la tabella resta la vista principale, ed è quella che si usa da telefono.
