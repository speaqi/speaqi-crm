# Speaqi Agency — analisi e prima integrazione CRM

La sezione `/agency` riguarda siti internet ed e-commerce per clienti esterni. È separata dalle presentazioni Tourism Intelligence e dal catalogo della piattaforma Speaqi. Accesso riservato al proprietario, sia nella navigazione sia nell’API AI.

## Analisi della base esistente

Fonte esaminata: repository `speaqi/speaqiagency`, `README.md`, `content/agency.json`, `content/brand.md`, `public/deck.js`, `clients/_esempio.json` (20 ottobre 2026).

- La separazione Agency/piattaforma è già dichiarata correttamente nel progetto Agency.
- Esistono una base web 1920×1080, esportazione PDF, loghi e font locali, paginazione del preventivo e segnalazione dei dati mancanti.
- La linea visiva è navy `#1D2D44`, arancio `#FC511F`, crema `#FAF7ED`; Bricolage Grotesque e Inter. I font sono ancora indicati come provvisori nel documento del brand.
- I contenuti aziendali sono quasi tutti `[DA VERIFICARE]`: presentazione dell’agenzia, metodo, portfolio, condizioni, referenti e dati legali. Non è una presentazione pronta per essere consegnata.
- Il progetto Agency non contiene un agente AI. Nel checkout CRM esaminato manca un collegamento Agency; il modulo presentazioni esistente è dedicato alle destinazioni turistiche.
- Non è stata modificata né pubblicata la base del repository Agency. Questa integrazione riusa gli asset identici già presenti nel CRM in `public/deck`.

## Flusso implementato

1. Apri Speaqi Agency nel menu del CRM.
2. Configura il modello comune: copertina, obiettivo, agenzia, proposta, perimetro, percorso proposto, condizioni, chiusura.
3. Inserisci nome e testo sul cliente. Compila separatamente condizioni economiche, tempi confermati e recapiti.
4. Genera la bozza. L’AI personalizza quattro slide; profilo aziendale, percorso, condizioni e contatti sono mantenuti dal codice. Non vengono letti contatti, prezzi SaaS o materiali Tourism.
5. Rivedi e modifica le slide. Segnaposto, numeri non supportati e testi troppo lunghi sono segnalati. Gli importi generati fuori dalle condizioni vengono rimossi.
6. Esporta una copia JSON o un HTML autonomo con font e loghi incorporati. Per il PDF apri l’HTML e usa Stampa → Salva come PDF, con orientamento orizzontale e senza intestazioni. La versione per consegna richiede campi completi e revisione esplicita. L’HTML di bozza rimane esportabile.

Le bozze e il modello sono conservati nel browser, separatamente per utente. Non si sincronizzano tra dispositivi; cancellare i dati del browser le elimina. Il JSON permette backup e trasferimento. Questa prima versione non aggiunge tabelle, record CRM, accettazioni contrattuali o link pubblici. Il file cliente esportato contiene le sole slide visibili, mai il brief privato o le istruzioni dell’agente.

## Configurazione e limiti

Il server usa `OPENAI_API_KEY` oppure `OPENAI_API_KEY_AUDIO`; in assenza usa `OPENROUTER_API_KEY`. Modello predefinito `gpt-5-mini` (OpenRouter: `openai/gpt-5-mini`), configurabile con `OPENAI_AGENCY_DECK_MODEL`. Le chiavi restano sul server. Le informazioni sul cliente vengono inviate al provider configurato.

L’AI non può validare la verità di affermazioni qualitative. La verifica dei fatti resta parte della revisione. Il percorso incluso è esplicitamente una proposta da concordare; il portfolio non è inserito perché non sono disponibili lavori verificati. Nessun listino, risultato, tempo di consegna o dato legale viene inventato.

La verifica con risposte AI simulate non certifica autorizzazione, credito o disponibilità del modello sul provider reale. L’attivazione sul CRM online richiede la pubblicazione di questo codice nel suo ambiente di hosting.

## Revisione editoriale e grafica — 21 ottobre 2026

La base Agency usa titoli diretti e impaginazioni editoriali: copertina, testo su due colonne, righe aperte, sequenza di lavoro e chiusura. Anteprima e HTML usano lo stesso renderer dedicato, separato da Tourism. Il prompt richiede esempi del cliente e rimuove slogan, titoli intercambiabili e formule generiche. Criteri: [SPEAQI-AGENCY-DESIGN.md](./SPEAQI-AGENCY-DESIGN.md).

La nuova proposta Paparo è stata ricostruita in PowerPoint e importata in Google Slides con copertine originali. Esempi di catalogo, scheda libro e acquisto sono marcati come proposte di interfaccia. PDF di otto slide renderizzato e ispezionato; nessun segnaposto commerciale e nessun testo oltre la pagina. Il rifacimento del modulo CRM resta da pubblicare.
