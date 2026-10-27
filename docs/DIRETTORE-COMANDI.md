# Cosa puoi chiedere al Direttore

Si scrive nella casella «Scrivi al Direttore» dell’Ufficio o su Telegram (un messaggio che comincia con «Direttore» o `/direttore`, una foto, oppure tutto se il bot è in modalità Direttore). Anche a voce.
Scrivendo «cosa posso chiederti?» il Direttore risponde con questo elenco.

Le proposte da decidere (nuovi contatti, partner trovati) arrivano su Telegram una per una con **«✅ Approva» e «✖️ Rifiuta»**: il tocco vale come il clic nell’Ufficio, con le stesse regole. Scrivere «sì» in chat non approva niente.

**Quando ti fa una domanda, rispondi e basta.** Se gli manca un dato (il sito, la città o il paese di un ente) te lo chiede, e la tua risposta («ecco il sito venezuela.com.ve», «Caracas», «Romania») riprende l’ordine da dove si era fermato. Su Telegram arriva al Direttore anche senza scrivere «Direttore». Vale per un giorno, e solo per l’ultima domanda: se nel frattempo gli hai mandato un altro ordine, ripeti la richiesta intera.

## Comandi slash su Telegram

Toccando **/** nel bot compare il menu. Ogni comando diventa la stessa frase che scriveresti a mano e passa dal Direttore con le sue regole:

| Comando | Equivale a |
|---|---|
| `/presentazione Visit Bergamo` (con foto: le mette nelle slide) | «Prepara la presentazione per Visit Bergamo» |
| `/presentazioni 5` | «Preparami 5 presentazioni di destinazioni» |
| `/presentazione_partner Hotel Laguna, guida di Venezia` | presentazione con la base Partner |
| `/manda Bibione` | «Mandami la presentazione di Bibione» (PDF) |
| `/contatto Mario Rossi, …` (o solo la foto del bigliettino) | «Nuovo contatto: …» |
| `/ente Venezuela Tourism` | «Aggiungi … a Tourism Intelligence e ai contatti» |
| `/partner Venezia 5` | «Trovami 5 partner per la mappa di Venezia» |
| `/rinomina X in Y` | «Rinomina X in Y» |
| `/mappa Marsiglia https://www.google.com/maps/d/…` | «Costruisci la mappa di Marsiglia, …» |
| `/controlla Barcellona` | «Controlla la mappa di Barcellona» |
| `/fattura PREV-…` · `/approvato PREV-…` | bozza di fattura · preventivo accettato + bozza |
| `/stato` · `/fiere` | «Come stiamo?» · «Quali sono le prossime fiere?» |
| `/ricorda venerdì alle 10 chiamare SNAV` | promemoria nel To Do e in Calendar |
| `/todo …` | va al To Do anche con il bot in modalità Direttore |
| `/scheda SNAV` | **non chiama il Direttore**: cerca contatti, enti e mappe e risponde con i link alle schede |
| `/coda` | cosa aspetta te: «Approva le sicure», le email da mandare, le decisioni |
| `/direttore …` · `/aiuto` | qualsiasi altra richiesta · questo elenco |

Un comando senza il pezzo che serve risponde con l’esempio, senza spendere. Il menu si aggiorna da solo a ogni deploy (`setMyCommands`). Logica in `src/lib/office/telegram-commands.ts`.

## Cosa si approva da solo

Ogni 10 minuti l'Ufficio approva **da solo**, 30 minuti dopo che sono nate (il tempo per rifiutarle da Telegram), le proposte interne e reversibili: lavori accodati agli agenti (mappe, lingue, controllo qualità), To Do per gli eventi, enti verificati portati nel CRM, contatti senza possibili doppioni. Te lo dice in un messaggio.

Restano a te: le **email** (arrivano con «📨 Approva e invia»: parte dal Gmail collegato, mai a chi ha risposto o si è disiscritto, al massimo 30 al giorno), le **unioni** di contatti, i contatti con possibili doppioni e ciò che spende fuori budget. Si spegne dal Direttore (`settings.autonomy.enabled = false`) o per un agente (`settings.auto_approve = false`).

Regola fissa: il Direttore **non invia** email, fatture allo SDI o pubblicazioni, e **non lavora su Napoli**. Quando serve un tuo clic te lo dice, con il link.

## Contatti e partner

| Scrivi | Cosa succede |
|---|---|
| «Nuovo contatto: Mario Rossi, Hotel Laguna, info@hotellaguna.it» o la foto di un bigliettino | Proposta in «Aspetta te» con i dati letti, la riga da cui vengono e i possibili doppioni. Approvando entra nei contatti con l’opportunità giusta. |
| «Trovami 5 partner per la mappa di Venezia» | Cerca prima nel catalogo Tourism (DMC, tour operator, agenzie, hotel, compagnie che nominano la città), poi sul web per quelli che mancano: vale solo un sito letto che nomina l’azienda, email solo del suo dominio. Ognuno è una proposta «Nuovo contatto» di tipo partner. Salta chi è già nei contatti o già proposto. Massimo 10. |
| «Aggiungi Venezuela Tourism a Tourism Intelligence e ai contatti» | Ritrova l’ente o lo crea (paese e tipo letti dall’ordine), cerca il sito, scrive le prove, lo verifica e lo porta nel CRM. Se non trova il sito te lo chiede. Con «…e poi fammi la presentazione» prepara anche quella. Dal bigliettino di una persona prende l’ente, non il nome della persona. |
| «Rinomina Gustavo Cardenas Tourism Ministry Venezuela in Tourism Ministry Venezuela» | Cambia il nome dell’ente in Tourism Intelligence; il vecchio resta come alias, così lo ritrovi ancora. Con «…e fammi la presentazione, sito …» prepara anche quella. Se l’ente era verificato torna da rivedere (lo riattiva la presentazione). Napoli no. |

## Presentazioni

| Scrivi | Cosa succede |
|---|---|
| «Prepara la presentazione per Visit Bergamo» | Se l’ente non è attivo lo attiva (sito, email, contatto), poi lo passa all’agente Presentazioni. |
| «Presentazione di Sibiu, il contatto è Simina Manea, Sibiu County Tourism Association» | Se l’ente non è in Tourism Intelligence lo aggiunge (paese dall’ordine, dal contatto o dal dominio dell’email), lo attiva, lo collega al contatto che hai già (Simina) e poi prepara la presentazione. |
| «Presentazioni per Visit Bergamo, Bibione e Asiago» | Una per nome, al massimo cinque per ordine. |
| «Preparami 5 presentazioni di destinazioni» | Sceglie lui fra gli enti del turismo con un sito e senza presentazione, prima quelli con priorità e con una città leggibile dal nome. |
| «Presentazione partner per Hotel Laguna, guida di Venezia» | Base **Partner** (QR e link con commissione, codici a tempo, vetrina, numeri nel portale). La prepara subito; le condizioni restano `[DA VERIFICARE]` finché non le scrivi nell’editor. |
| Foto con «foto per la presentazione di Bibione» | Finiscono nelle slide al posto di quelle di esempio. |

Ogni presentazione pronta (dall’agente Presentazioni o dal Direttore) **arriva su Telegram in PDF**, anche in bozza, con «✅ Approva» se non resta niente da completare e «✏️ Modifica nel CRM». Se la chiedi e c’è già, te la rimanda invece di rifarla.

La base Partner si sceglie anche a mano: Tourism → Presentazioni → «Crea la presentazione» → «Per chi è: un partner».

## Mappe

| Scrivi | Cosa succede |
|---|---|
| «Costruisci la mappa di West of Sicily, https://www.google.com/maps/d/…» | Il Costruttore My Maps importa i luoghi. Senza link usa solo una fonte già collegata in StudioMap, altrimenti si ferma e lo dice. |
| «Controlla la mappa di Barcellona» | Il Controllo qualità prepara il rapporto. |

## Soldi

| Scrivi | Cosa succede |
|---|---|
| «Fammi la fattura per PREV-2026-0012» | Bozza pronta in Fatture con quello che manca per lo SDI. Non la invia. |
| «SNAV ha approvato PREV-…, fai la fattura» | Segna il preventivo accettato e prepara la bozza. |

## Situazione e agenda

| Scrivi | Cosa succede |
|---|---|
| «Come stiamo?» | Piano di oggi, trattative, preventivi in attesa, agenti e spesa della settimana. |
| «Quali sono le prossime fiere?» | Eventi e bandi trovati dal Ricercatore eventi. |
| «Ricordami di chiamare Rossi venerdì» | Attività nel To Do con la data, e in Google Calendar come evento di tutto il giorno. |
| «Domani alle 15 chiamo Rossi, giovedì alle 10 riunione con SNAV per un'ora, e devo mandare il preventivo a Bibione» | Tre attività nel To Do (al massimo 10 per messaggio). Quelle con un giorno vanno anche in Google Calendar: all'ora detta, con la durata detta (altrimenti 30 minuti), o tutto il giorno se l'ora non c'è. Quella senza giorno resta solo nel To Do. |
