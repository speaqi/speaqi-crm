# Turismo operativo — assegnazioni e lavoro distribuito

Implementazione locale del 21 ottobre 2026. **Non attivata sul database o sul deploy.**

L'area `/tourism-lavoro` si affianca a `/tourism`, riusando login, utenti e layout del CRM. Il catalogo intelligence conserva l'accesso del proprietario; la nuova area distribuisce schede operative con un contesto condiviso esplicito. Le informazioni personali del CRM non vengono copiate automaticamente.

## Funzioni predisposte

- Responsabile principale e collaboratori identificati tramite gli UUID del team; il valore nullo del responsabile indica il proprietario, anche se non possiede una riga nel team.
- Schede partner, territori, segmenti, opportunità e attività. Un partner/portafoglio può raccogliere schede figlie. Un livello di gerarchia; il passaggio di portafoglio trasferisce tutte le figlie nella stessa transazione. Le nuove figlie ereditano l'assegnazione.
- Directory: assegnazione della selezione, fino a 100 entità, senza duplicare quelle già distribuite. Nome, paese, segmento e sito sono gli unici dati copiati automaticamente. Il contesto, compresi eventuali contatti autorizzati, si compila esplicitamente.
- “Il mio lavoro”: schede di oggi, scadute, da prendere in carico e ferme da 14 giorni; avanzamento, prossimo passo, richiamo e presa in carico. Contatori e carichi sono calcolati sull'intero insieme autorizzato dal database. La lista è paginata a 100 righe, con ricerca e filtri sulla pagina caricata, come indicato nella UI. Date in UTC.
- Scheda condivisa con contesto, opportunità/attività figlie, conversazioni, documenti tramite link e storico delle modifiche. Note append-only, interne o condivise; nessun caricamento di file introdotto. Le ultime 100 note e modifiche sono mostrate; non è un'esportazione completa dello storico.
- Pipeline operativa: da qualificare, da contattare, contatto avviato, proposta, accordo, in attesa e archiviato. Azione richiesta sempre, scadenza per ogni scheda aperta; motivo obbligatorio per attesa e archivio. Questi stati non attivano un progetto, un trial, un abbonamento o un deal CRM.
- Segnali dalla ricerca: creazione esplicita di una scheda opportunità, fonte e checklist di tre verifiche. La fonte può essere assegnata una sola volta; il segnale resta da verificare. La checklist è modificabile dagli assegnatari.
- Accessi abilitati dal proprietario per utenti esistenti: interno o partner esterno, con revoca. L'abilitazione aggiunge l'area `tourism` al membro. Le altre aree già configurate vengono preservate. I permessi del resto del CRM continuano a essere gestiti dal modulo team esistente.
- Regole salvate per paese e codice segmento (`dmo`, `tour_operator`, ecc.). Applicate esplicitamente a una selezione, scelgono il membro abilitato meno carico fra quelli della regola. Conteggio di schede aperte, non stima delle ore di lavoro. Le entità fuori criterio vengono saltate. La regola non avvia acquisizioni o invii e non è un processo pianificato.
- Riepilogo strutturato della scheda prima della chiamata, disponibile senza provider. Bozza follow-up tramite OpenAI Responses, solo su richiesta, solo da contesto condiviso e note condivise. `OPENAI_API_KEY` e, facoltativamente, `OPENAI_TOURISM_WORK_MODEL` (default `gpt-5-mini`). La chiave audio non viene riutilizzata. Limite di una richiesta al minuto per persona e processo, timeout 40 secondi, 1.000 token di output; non costituisce una quota distribuita. Nessun invio di messaggi.
- Promemoria e inattività sono avvisi nell'area lavoro, non notifiche email, WhatsApp o processi in background.

## Permessi

| Operazione | Proprietario | Interno assegnato | Partner esterno assegnato |
| --- | --- | --- | --- |
| Consultare schede | Tutte del workspace | Assegnate / in collaborazione | Assegnate / in collaborazione |
| Assegnare, importare dalla directory, configurare accessi e regole | Sì | No | No |
| Modificare contesto condiviso | Sì | No | No |
| Stato, prossima azione, scadenza, checklist e presa in carico | Sì | Sì | Sì |
| Note e documenti condivisi | Sì | Sì | Sì |
| Note e documenti interni | Sì | Sì, sulle schede assegnate | No |
| Catalogo e ricerca completi | Sì | No | No |

RLS anche per l'accesso diretto a PostgREST. Identità tramite `auth_user_id`, oppure email dell'account in `auth.users` se il collegamento esplicito manca. Nessun ruolo ricavato dai metadata modificabili dall'utente. Il profilo deve essere abilitato e la riga del team deve avere l'area `tourism`. Revocare uno dei due requisiti impedisce l'accesso al database anche con una sessione già aperta.

Funzioni applicative `SECURITY INVOKER`. Solo i lookup privati di autorizzazione e l'audit dei trigger usano `SECURITY DEFINER`, con search path vuoto, oggetti qualificati e privilegi espliciti. Nessuna funzione trigger invocabile direttamente, nessuna scrittura diretta allo storico, nessun privilegio anonimo sulle nuove tabelle/API. Aggiornamenti API con versione e passaggio di portafoglio con controllo della versione e lock. I contenuti delle note interne non vengono copiati nello storico condiviso.

## Attivazione

Schema: `supabase/migrations/20261024130000_tourism_work.sql`, transazionale e additivo, da applicare **una sola volta** sul database CRM **prima** del codice (senza, `/tourism-lavoro` risponde «Area lavoro non attivata»). Verificato con `npm run test:tourism:work` (11 scenari di RLS, note, revoca, assegnazioni, storico, idempotenza e isolamento su PGlite con le migration reali del catalogo e della ricerca). Le cinque tabelle sono nei backup (script locale e server).

Dopo l'applicazione: controllare gli advisor di sicurezza di Supabase e provare nel browser proprietario, interno e partner esterno (creazione dalla directory e da un segnale, passaggio di portafoglio, note interne invisibili al partner, revoca con sessione aperta, regola per territorio). La bozza AI richiede `OPENAI_API_KEY`.

## Verifiche di questa sessione

- **6 test unitari passati**: code/scadenze UTC, esclusione schede concluse, rimozione delle note interne dal payload del provider, gestione dell'output AI, limite per persona, area delegabile e catalogo riservato.
- **10 test di regressione sulle aree passati** (`scripts/areas.test.mjs`).
- Controllo TypeScript mirato ai nuovi moduli applicativi e test unitari: completato senza errori.
- `git diff --check`: completato senza errori.
- Suite database predisposta con 11 scenari di RLS, note, revoca, assegnazioni, storico, idempotenza e isolamento. **Non eseguita**: il modulo `@electric-sql/pglite` manca nell'installazione locale.
- Typecheck globale bloccato da dipendenze già dichiarate ma assenti, tra cui `cheerio`, `pptxgenjs`, `@sparticuz/chromium`, `puppeteer-core`, `undici`, `playwright` e `@electric-sql/pglite`. Build globale terminata con errore webpack.
- Chromium presente, ma avvio headless non riuscito nel sandbox; percorso browser non verificato. Provider AI reale non chiamato. Nessuna migrazione remota o modifica ai dati di produzione.
