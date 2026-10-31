# Ufficio — guida operativa dei lavori persistenti

## Uso quotidiano

Accedi come titolare e apri **Ufficio**. Scrivi al Direttore oppure usa il bot Telegram già configurato. Un ordine viene salvato prima di interpretarlo; la scheda **Lavori** mostra gli incarichi dell'ufficio e ogni ordine può mostrare i propri lavori collegati. Il browser non deve restare aperto perché il worker esegua i turni.

Nel campus 3D, clicca un personaggio o il suo cartellino per aprire la scheda nel pannello. **Cosa sta facendo** mostra gli incarichi assegnati, i blocchi e le azioni disponibili; **Anche conclusi** include lo storico dei lavori e i collegamenti ai documenti prodotti. **Cosa ha fatto** conserva risultati e corse del singolo agente, con pagine per lo storico precedente. Il pulsante **Attività e storico** nella Squadra apre la stessa scheda anche senza 3D.

Colori e cartellini seguono il registro degli incarichi: un blocco o una decisione richiesta restano visibili dopo la conclusione della corsa. I messaggi animati rappresentano nuove assegnazioni del Direttore e risultati registrati; il caricamento iniziale non riproduce eventi passati. La pagina aggiorna i dati ogni cinque secondi mentre ci sono lavori pronti o in corso, altrimenti ogni trenta, e sospende le letture periodiche quando è nascosta. La preferenza di movimento ridotto disattiva i messaggi animati.

Per una presentazione Tourism indica ente e destinazione. Se il sito o le prove mancano, Arricchimento lavora soltanto su quell'incarico e prepara una proposta con fonti. In **Aspetta te**, controlla e approva o rifiuta. L'approvazione valida gli effetti indicati, sblocca la presentazione e conserva l'ordine originale. La presentazione pronta resta da rivedere: il sistema non approva il deck né invia l'email al cliente al posto tuo.

Un «sì» in chat non approva nulla. Gli agenti non possono accendersi, aumentare i propri budget, pubblicare o inviare documenti sulla base di una risposta libera del modello.

## Leggere gli stati

### Smaltire «Aspetta te»

La coda distingue **Decisioni**, **Documenti** e **Avvisi**. I rapporti sulla stessa presentazione sono raggruppati in una scheda con il titolo e lo stato attuale del documento. **Apri documento** porta all'editor, dove resta l'approvazione della presentazione.

Usa **Seleziona questa vista** o le caselle delle singole schede. **Archivia avvisi selezionati** li segna come letti (`done`), conserva lo storico e lascia invariati documenti, lavori e autorizzazioni. Non archivia proposte o uscite che costituiscono una decisione richiesta da un lavoro. Per le **Decisioni**, **Approva selezionate** e **Rifiuta selezionate** applicano gli effetti descritti nelle proposte, con il medesimo servizio delle azioni singole e di Telegram. Eventuali errori restano sulle voci non gestite; quelle riuscite escono dalla coda.

Selezione e filtri valgono per la pagina corrente (massimo 50 elementi). L'archiviazione richiede la migration additiva `office_inbox_acknowledge`, da distribuire prima del codice. La RPC è eseguibile soltanto dal servizio del server; le API mantengono il controllo del titolare e del workspace.

| Stato mostrato | Cosa significa | Azione del titolare |
|---|---|---|
| In attesa | Dipendenza, orario, agente spento o occupato | Leggi prossimo controllo e responsabile; riaccendi solo se vuoi autorizzare quell'agente |
| Pronto | Il lavoro può essere preso al prossimo turno | Nessun nuovo ordine necessario |
| In esecuzione | Una corsa possiede una presa a scadenza rinnovata dal worker | Attendi l'esito; non correggere dati già in uso |
| Bloccato | Dati, configurazione, budget o ricevuta impediscono di continuare | Leggi motivo, prossima azione e chi interviene; completa i dati quando consentito |
| Aspetta te | Esiste una proposta da decidere | Apri la proposta collegata e approva/rifiuta con il pulsante |
| Riuscito | Esiste un risultato verificato per questa versione | Consulta il risultato; non coincide necessariamente con invio o pubblicazione |
| Fallito | Un errore definitivo o il limite dei tentativi richiede intervento | Correggi la causa prima di chiedere la ripresa |
| Annullato | Rifiuto o cancellazione ha interrotto quel percorso | Nessun seguito automatico dipendente |

Un ordine è **Fatto** solo quando il piano è chiuso e tutti gli incarichi richiesti sono riusciti. Se aspetta una tua decisione o un prerequisito, il motivo resta visibile anche dopo un riavvio.

## Correggere senza ricreare l'ordine

In **Lavori**, apri il lavoro bloccato e scegli **Completa i dati** quando disponibile. Per My Maps puoi fornire il link; per la verifica ente il sito ufficiale e la città. Il server accetta solo i campi ammessi e controlla la revisione: se il lavoro è cambiato, aggiorna prima di riprovare. La correzione è una nuova versione dello stesso incarico, con storico dei dati precedenti.

**Ricontrolla e riprendi** richiede un nuovo controllo dei prerequisiti: non cambia interruttore, budget o autorizzazioni. **Annulla lavoro** conserva la traccia; non cancella gli oggetti già prodotti. Un rifiuto di verifica non si aggira rilanciando automaticamente una nuova proposta.

Se l'interfaccia indica **esito incerto/riconciliazione**, non creare un altro ordine per ottenere lo stesso effetto. Esamina tentativo, corsa, riserva e ricevuta del servizio: il sistema non autorizza un rilancio cieco. Le azioni non disponibili nell'interfaccia non vanno sostituite modificando direttamente le righe SQL.

## Attivazione da parte dell'operatore

L'installazione del codice non accende gli agenti. Il nuovo worker è disattivato se **`OFFICE_WORKER_ENABLED`** non vale `true`. Riutilizza il pianificatore esistente, che richiede anche `AUTOMATION_SCHEDULER_ENABLED`, `AUTOMATION_SECRET` e `AUTOMATION_WORKSPACE_USER_ID` correttamente configurati. Non pubblicare i valori dei segreti nei log o nei report.

Sequenza di rilascio:

1. Mantieni spento il worker durante la preparazione. Esegui backup, prove locali e controlla che le corse già iniziate abbiano esito o riconciliazione. Il deploy e le migrazioni di produzione richiedono l'autorizzazione del titolare.
2. Applica **prima del codice** le nuove migrazioni additive del ramo, in ordine. Il file dei lavori persistenti aggiunge tabelle, RPC e vincoli; non modifica retroattivamente i file SQL già distribuiti.
3. Distribuisci il codice. Se lo schema manca, il pannello segnala l'aggiornamento: i nuovi ordini restano ricevuti, senza una seconda esecuzione volatile. Le approvazioni che dipendono dal registro restano pendenti invece di consumare un effetto non tracciato.
4. Verifica importazione e conteggi delle vecchie voci. L'importatore usa una chiave stabile e ricevute/storico disponibili; ciò che ha esito incerto rimane da riconciliare. Le liste di monitoraggio non vanno cancellate o trasformate alla cieca in nuovi incarichi a pagamento. Non far consumare la stessa coda contemporaneamente al vecchio e al nuovo percorso.
5. Includi **`office-work`** in `AUTOMATION_SCHEDULER_JOBS` se la variabile contiene un elenco. Non abilitare tutti i job del CRM soltanto per aggiungere il worker. Poi abilita `OFFICE_WORKER_ENABLED=true` per il passaggio autorizzato e osserva il primo turno.
6. Controlla, su dati di prova consentiti, ordine salvato → incarico → corsa → risultato. Verifica che il job continui senza browser aperto. Accendi soltanto gli specialisti che devono lavorare e mantieni i budget scelti dal titolare.

Il turno periodico è ogni cinque minuti e chiama `POST /api/automation/office-work` con l'autenticazione macchina esistente. Quando il database non risponde il pianificatore limita la durata delle prenotazioni e attende progressivamente prima di ritentare. Non è una rotta pubblica né un modo per impersonare un altro workspace. Le pagine del titolare usano `GET /api/office/work` e dettaglio/correzione su `/api/office/work/<id>`; token di presa e checkpoint interni non vengono esposti dal pannello.

### Agenda degli incarichi

La scheda Agenda salva istruzioni al Direttore con cadenza giornaliera, ogni due giorni o settimanale, data e ora di Roma. Il worker materializza al massimo cinque incarichi dovuti per giro; ordine, incarico e avanzamento sono atomici. Dopo uno stop prolungato viene creato soltanto il turno dovuto più recente, non tutti gli arretrati. Se il turno precedente è ancora aperto, il successivo viene saltato per non accumulare copie. La pausa conserva lo storico; la modifica usa una revisione per non sovrascrivere un turno appena avviato.

L'agenda richiede la migration `office_recurring_orders` e il worker acceso. Non avvia un sistema spento e non imposta un limite di spesa separato per incarico: valgono i budget degli agenti. La vista mostra l'ultimo lavoro.

Il riepilogo ha una frequenza indipendente impostabile nella stessa scheda. Il worker salva nel CRM, senza chiamate AI, un rapporto con situazione dei lavori e costi del periodo (ultimi 30 giorni al massimo dopo uno stop prolungato); il dettaglio riporta fino a 30 lavori aggiornati e 10 situazioni aperte da verificare. È un avviso consultabile e non aumenta il contatore delle decisioni. Non viene ancora consegnato automaticamente via Telegram o email.

## Controlli e diagnosi

Inizia da stato, motivo, prossima azione e tentativo del lavoro. In `automation_job_runs` il campo `outcome` distingue **riuscito**, **saltato con motivo**, **bloccato**, **fallito**. Un agente spento/occupato è un'attesa legittima; un errore di trasporto è un fallimento. Un report senza dati non sostituisce la ricevuta del risultato richiesto.

| Sintomo | Verifica |
|---|---|
| Nessun turno | Flag del worker/pianificatore, inclusione `office-work`, secret/workspace, server attivo e schema applicato |
| Agente fermo | Interruttore e corsa già in esecuzione; il lavoro resta salvato con prossimo controllo |
| Fonte mancante o illeggibile | Correggi sito/link sul lavoro originale; non modificare l'ente come verificato senza prove |
| Budget insufficiente | Confronta spesa effettiva e riserve contro tutti i tetti; non liberare riserve incerte e non aumentare budget implicitamente |
| Presentazione senza risultato | Verifica ente/destinazione approvati, ricevuta del tentativo e deck persistito; una corsa conclusa con avviso non è successo |
| Riavvio | Controlla lease scaduta e checkpoint: passi certamente non avviati possono riprendere, effetti incerti richiedono riconciliazione |
| Telegram non ricevuto | Consulta evento e stato di consegna. Un timeout è incerto, non prova che il messaggio non sia arrivato; evitare reinvii ciechi |

Il journal e gli eventi sono persistenti. Le notifiche operative sono corte, legate al lavoro e dirette al titolare/chat autorizzata; un errore di notifica non annulla un risultato già verificato. Non sostituiscono email commerciali, pubblicazioni, SDI o autorizzazioni contrattuali.

## Sospensione, rollback e limiti

Per sospendere nuovi consumi, disabilita il worker tramite la configurazione autorizzata. Questo non interrompe retroattivamente un effetto esterno già partito: attendi le corse attive o riconciliale, preservando riserve, tentativi e ricevute. Dopo il passaggio al registro persistente, un rollback non deve riattivare i vecchi consumatori della stessa coda. Conserva le tabelle e i lavori per la ripresa, senza migrazioni distruttive.

Napoli, Naples e `napolimap` restano esclusi dai lavori cartografici. Un import My Maps produce candidati, non una guida pronta o una pubblicazione. Il primo percorso Tourism non è un'implementazione completa di Agenzia, Distribuzione, preventivazione autonoma, onboarding dopo l'accordo o firma dei contratti. La matrice delle verifiche e dei limiti è in [UFFICIO-TEST-REPORT.md](UFFICIO-TEST-REPORT.md).
