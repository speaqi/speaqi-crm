# Speaqi Global Tourism Intelligence — audit e decisioni

Data: 17 ottobre 2026. Repository esaminato: `speaqi-crm`, base `b528127`.

## Analisi critica prima dello sviluppo

Il valore iniziale è la qualità del catalogo e il passaggio selettivo al CRM. Otto agenti autonomi, un graph database, scraping mondiale, confini PostGIS e una nuova applicazione aumenterebbero costi e superfici di errore prima di avere un campione validato. Partiamo con un monolite modulare nello stesso Next.js e nello stesso PostgreSQL/Supabase. Nessun nuovo servizio di produzione.

Le entità del catalogo e le relazioni hanno identità proprie: un brand Visit e un portale non sono automaticamente organizzazioni. Una DMC è un operatore commerciale, non un'autorità territoriale. La geografia è un insieme di luoghi collegati: non impone regioni/province a ogni paese e supporta coperture sovrapposte. Le relazioni hanno una fonte, uno stato e una revisione.

## Audit del codice esistente

| Componente | Evidenza | Riutilizzo / limite |
| --- | --- | --- |
| Applicazione | `package.json`: Next 15, React 19, TypeScript | Nuova area `/tourism`, navigazione e sessione esistenti |
| Auth e workspace | `src/lib/server/supabase.ts`, `src/lib/areas.ts` | JWT utente, risoluzione proprietario/collaboratore; MVP riservato al proprietario, RLS anche su accessi REST diretti |
| Anagrafica commerciale | migrazione `20260325150000_crm_schema.sql`, API contatti | `contacts` mescola persone e lead aziendali; nessuna tabella account canonica. Collegamento esplicito al contatto aziendale esistente; non inventare un secondo modello clienti/progetti |
| Pipeline | `pipeline_stages`, `deals`, `deal-ops.ts` | Pipeline e ciclo progetto restano separati. Il catalogo non crea deal, task, campagne o invii |
| Fonti prospect | area Fiere, `trade_fair_exhibitors`, area Navigazione | Pattern catalogo separato + promozione; le fonti hanno scope verticale e non sono un registro turistico mondiale |
| Ricerca | filtri PostgREST esistenti | Indice full-text PostgreSQL `simple`, paginazione sul server; nessun Elasticsearch |
| CSV | `src/lib/csv-import.ts` | Parser condiviso; anteprima, errori per riga e approvazione esplicita nel nuovo modulo |
| AI | `email-draft-context.ts`, `ai-ready.ts` | Responses API e web search già impiegate; discovery con candidati sempre non verificati e fonti citate dal provider |
| Automazioni | `automation-scheduler.ts`, `automation-schedule.ts` | Scheduler già in processo. MVP job persistenti e ripresa manuale, senza nuove campagne né crawling periodico indiscriminato |
| UI | layout, Sidebar, Topbar, `apiFetch`, Leaflet | Stesso shell, stile isolato del modulo, mappa Leaflet caricata lato client |
| Ecosistema Speaqi | app principale separata, MapLibre nel frontend | Non condividere database o identificativi per supposizione. Identificativi esterni strutturati per futuri collegamenti alle destinazioni Speaqi |
| Qualità e test | test unitari Node/tsx, fixture PostgreSQL campagne | Aggiungere test specifici su transazioni, RLS, verifiche e deduplica; nessun dato di produzione nei test |
| Backup / osservabilità | script `backup_supabase.mjs`, log e job CRM | Verificare inclusione delle nuove tabelle nel backup prima del rilascio; non dichiarare restore testato senza eseguirlo |

Non è stata effettuata un'ispezione dei dati personali o dei record di produzione. Il conteggio delle organizzazioni già nel CRM richiede il database autorizzato e non viene inventato.

## Architettura e confini MVP

PostgreSQL contiene nodi tipizzati (organizzazione, luogo, brand, portale, persona), tassonomia traducibile, relazioni molti-a-molti, evidenze per attributo, versioni append-only e job discovery. Il modello relazionale è già interrogabile come grafo: non occorre Neo4j. Il catalogo è privato per workspace e non entra in `contacts` finché l'utente sceglie Add to CRM. Le transazioni RPC impediscono importazioni parziali e promozioni concorrenti duplicate.

Il database è la barriera di sicurezza anche contro chiamate REST dirette. Le funzioni operano come invoker; gli audit usano trigger con search_path fisso. Non viene usata la service role dal modulo. L'accesso dei collaboratori, l'export di persone e la delega granulare richiedono una fase successiva: i permessi attuali dei contatti sono basati sull'assegnatario, non su un catalogo condiviso.

La verifica è una decisione umana registrata con attore e data, riferita agli attributi dell'evidenza. Un output AI o una pagina trovata non rende automaticamente verificato un record. I dati mancanti non producono un punteggio commerciale positivo o negativo. Lo score espone copertura e fattori verificati; nessuna priorità senza evidenza sufficiente.

Sincronizzazione bidirezionale: confronto del recapito istituzionale catalogo/CRM e azione esplicita in ciascuna direzione; mai sovrascrittura silenziosa del lavoro commerciale. I progetti restano l'unità economica Speaqi; il modulo non attribuisce ricavi a un'organizzazione.

## Dipendenze e rischi

- Migrazione additiva su Supabase prima dell'uso. Non applicare automaticamente migrazioni a un progetto non identificato come CRM.
- La discovery web richiede `OPENAI_API_KEY`, con modello configurabile; se assente deve fallire chiaramente e mantenere il job riprendibile. Nessun riutilizzo di credenziali audio.
- Il campione verificato dall'autore è consegnato come candidato da revisionare nel workspace. Nessun nominativo personale o email dedotta.
- Dominio condiviso ≠ stessa organizzazione; la deduplica esatta usa paese + nome normalizzato. Sito/email uguali sono suggerimenti da revisionare, non fusioni automatiche.
- La connessione CRM non equivale a consenso marketing. Un nuovo contatto nasce con eligibility `review` e senza iscrizioni.
- Nessun acquisto di dataset o API aggiuntive. Robots, licenze e policy delle fonti vanno valutati per ogni connettore futuro.

Roadmap, criteri di accettazione, procedure e risultati effettivi dei test sono riportati nel documento operativo del modulo.
