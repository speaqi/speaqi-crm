# Speaqi Agency e Tourism: due basi commerciali riutilizzabili

Analisi del 21 ottobre 2026, sul CRM aggiornato a `67d5fbb` (PR #39).

## Esito

La base tecnica esiste già ed è consistente: non serve costruire un altro generatore di slide. Agency e Tourism devono mantenere contenuti e condizioni separati, riutilizzando lo stesso motore preventivi, pagamenti e firma. La velocità arriva da due basi commerciali configurate una volta, ciascuna con presentazione, voci d'offerta e contratto.

L'analisi copre il codice, le migrazioni, i test e i documenti disponibili su GitHub. Non è una verifica delle configurazioni e delle presentazioni dei singoli clienti salvate sul database di produzione: in questa sessione non è disponibile una sessione CRM autenticata per leggerle. Le prove usano dati sintetici; nessuna email commerciale è stata inviata e nessun contratto è stato sottoscritto.

## PR verificate

| Riferimento | Stato verificato | Contenuto e limite |
| --- | --- | --- |
| [CRM #39](https://github.com/speaqi/speaqi-crm/pull/39) | Unita il 21 ottobre | Nuovo disegno Agency «colour chapters», stessa sequenza di campi colore su web/PDF/PPTX; titoli e cifre grandi, foto a metà slide, tipografia Heuvel Grotesk/Inter anche Tourism. Migliora il disegno, non crea basi commerciali o contratti distinti. |
| [Design #1](https://github.com/speaqi/speaqidesign/pull/1) | Unita il 21 ottobre | Font installabili, profilo Agency, sistema grafico, PDF/PPTX Editori Paparo. Il testo di `agency/design-system.md` descrive ancora schede, filetti e fondi uniformi: precede il disegno successivo della #39. Va riallineato per evitare di riprodurre il vecchio stile. |
| CRM #35–38 e storia precedente | Presenti nella base analizzata | Flusso Agency dal brief alla proposta, revisione, precompilazione con `?edit=`, investimento, acconto/saldo, righe incluse, prezzi di listino barrati e numerazione degli interventi. |

## Cosa è già stato realizzato

### Speaqi Agency

- Area riservata al proprietario: dashboard, opportunità, clienti, Presentation Studio, preventivi, documenti e template.
- Cliente CRM e trattativa aperta collegati all'opportunità; brief, sito, foto, logo e documenti come materiali.
- Analisi e generazione AI; distinzione di fatti verificati, ipotesi e informazioni mancanti; revisione mirata senza riscrivere tutte le slide.
- Venti layout, tre direzioni cromatiche, colore e logo del cliente; una struttura adattabile al progetto.
- Studio con modifica manuale, riordino, duplicazione, storico, approvazione e link pubblico. Una modifica riporta la proposta in revisione.
- PDF e PowerPoint; investimento ricavato dal preventivo collegato, comprensivo di sconto, IVA, acconto e saldo.

Fonti principali: `src/lib/agency.ts`, `src/lib/server/agency*.ts`, `src/components/agency/`, migration `20261020130000_agency.sql`.

### Tourism

- Presentazioni collegate alle organizzazioni di Tourism Intelligence; contesto da organizzazione, sito e luoghi approvati, oltre ai materiali caricati.
- Un modello di contenuto già modificabile e salvato per proprietario; cinque layout e dodici slide nella proposta destinazioni.
- Segnaposto per destinazione, ente, paese, condizioni e contatto; generazione assistita con guardie su fatti e numeri.
- Editor, controllo dei dati mancanti, approvazione, link pubblico e PDF conservato per versione. Il PowerPoint Tourism non è implementato.

Fonti principali: `src/lib/tourism-deck.ts`, `src/lib/server/tourism-decks.ts`, `src/lib/server/tourism-deck-agent.ts`, `src/components/tourism/deck/`, migration `20261019190000_tourism_decks.sql`.

### Preventivi e contratto

Esistono già righe d'offerta, alternative selezionabili, IVA e sconti, condizioni di pagamento, coordinate, link pubblico, richiesta di firma via email o in presenza e registrazione della firma. Il contratto è già parte del preventivo e viene accettato nello stesso percorso; non serve una seconda anagrafica o una seconda firma indipendente per il documento contrattuale di base.

Il testo iniziale era però unico e descriveva un servizio SaaS annuale. Non è una base adeguata indistintamente per un sito su misura, una consulenza Agency e una partnership di distribuzione Tourism.

## Interventi di questa modifica

| Lacuna | Intervento |
| --- | --- |
| Agency aveva esempi dei layout, ma non una base di contenuto configurabile | Base di dodici moduli, modificabili in Agency → Template; segnaposto cliente/progetto/servizi/contatto; usata anche dalla generazione AI. |
| Righe e condizioni dovevano essere ricostruite | Voci, quantità, prezzi, acconto, note e testo contrattuale riutilizzabili, salvati separatamente nei due modelli esistenti. |
| Tourism ereditava sempre la proposta partnership | Aggiunta una base Tourism per aziende di dodici slide, caricabile nel medesimo modello salvato: nessuna gratuità o soglia di accessi implicita. La partnership destinazioni esistente resta disponibile. |
| Tourism non aveva un legame con i preventivi | Preparazione dal deck, legame `quotes.tourism_deck_id`, ritorno al deck, elenco offerte e accesso al preventivo/contratto dal link pubblico. Si mostra il preventivo inviato più recente; una bozza rimane interna. |
| Il contratto non era modificabile nel costruttore | Campo completo nel preventivo; ogni offerta conserva la propria copia. La modifica del testo di un contratto già accettato è bloccata anche dall’API: per nuove condizioni si duplica l’offerta. Le modifiche successive al modello non riscrivono i contratti già creati. |
| Dati mancanti potevano arrivare alla firma | Bozza consentita; invio, cambio di stato e richiesta di firma bloccati in presenza di `[DA VERIFICARE]` o segnaposto irrisolti nelle parti selezionate. Prezzo assente distinto da zero esplicito. |
| Agency collegava il preventivo dopo averlo creato | Riferimento inserito nello stesso INSERT del preventivo, eliminando quella finestra di errore parziale. |
| Il testo da condividere Agency poteva citare un'altra offerta | Usa il preventivo effettivamente collegato alla presentazione approvata. |
| Compilazione Edge dei pianificatori Node | Import racchiusi nel ramo esplicito `NEXT_RUNTIME === 'nodejs'`, evitando l'inclusione di `undici` nella compilazione Edge. |

## Base Agency: struttura consigliata

1. Copertina: promessa specifica e destinatario.
2. Punto di partenza: esigenza del cliente e relativa fonte.
3. Obiettivi: che cosa deve cambiare e come verificarlo.
4. Soluzione: direzione proposta e motivazione.
5. Perimetro: servizi selezionati, quantità, inclusioni ed esclusioni.
6. Consegne: cosa riceve il cliente e come lo approva.
7. Metodo: allineamento, produzione, verifica e consegna.
8. Tempi e responsabilità: dipendenze, referenti e date concordate.
9. Condizioni: revisioni, assistenza e costi di terzi.
10. Investimento: letto dal preventivo, senza cifre riscritte nelle slide.
11. Prossimi passi: confronto, accettazione e avvio.
12. Chiusura: referente e contatto.

Questa è una base, non un numero obbligatorio di slide: per un incarico semplice si eliminano moduli; per un progetto articolato si aggiungono approfondimenti. Casi studio e testimonianze entrano solo quando esistono materiali pubblicabili. I campi da completare non sono promesse da inventare.

## Base Tourism: distinzione commerciale da risolvere

La base attuale è una **partnership per destinazioni**, non un listino generico per tutte le aziende turistiche. Offre una mappa senza canone in cambio di almeno 100.000 accessi annui e distribuzione, con quantità esplicite di luoghi, lingue e itinerari.

Questa struttura può essere riusata per enti e destinazioni con quel modello. Per hotel, attività, compagnie, operatori o altri destinatari è ora disponibile **Carica la base Tourism per aziende** nell’editor del modello: dodici slide su bisogno, benefici, soluzione, esperienza, perimetro, prova, metodo, responsabilità e condizioni, senza riprendere le soglie della partnership. È sempre lo stesso modello Tourism salvato, non una terza linea commerciale. Il nuovo collegamento a preventivo e contratto non cambia automaticamente il testo economico delle slide Tourism: quelle condizioni devono essere coerenti con il contratto prima dell'approvazione. Non c'è sincronizzazione automatica degli importi Tourism equivalente alla slide investimento Agency.

La nuova base aziende mantiene una sola linea Tourism con moduli adattabili: destinatario → opportunità specifica → esperienza per il visitatore → prova reale → contenuti e lingue → distribuzione → ruoli operativi → condizioni economiche → prossimi passi. Il modulo partnership entra solo quando concordato.

Decisioni mancanti:

- cosa conta come accesso, finestra di misurazione, deduplicazione, esclusione del traffico artificiale e report condiviso;
- responsabilità di distribuzione e conseguenze del mancato raggiungimento della soglia;
- durata, rinnovo, uscita, proprietà dei dati, manutenzione e assistenza;
- relazione tra la partnership e il piano standard per progetto da 99 €/mese o 990 €/anno;
- distinzione tra AI Concierge incluso e servizi di personalizzazione, senza introdurre livelli di funzionalità;
- condizioni degli eventuali video separati, in minuti, secondo il modello commerciale canonico.

Sono decisioni da registrare una volta nel modello, non da riscrivere in ogni presentazione. Non sono state inventate o attivate condizioni nuove per i clienti esistenti.

## Uso operativo

**Una volta per linea:** completare identità e contatto; rifinire la base delle slide; salvare le voci ricorrenti con prezzi confermati; inserire il contratto approvato e le condizioni standard. I testi forniti nel codice sono tracce contrattuali da completare: non attestano una revisione legale.

**Per ogni cliente:** scegliere il destinatario; aggiungere brief, obiettivo, servizi e materiali; generare o adattare la presentazione; aprire il preventivo precompilato; verificare quantità, importi, condizioni e dati fiscali; salvare, collegare il preventivo mostrato nello Studio Agency, approvare e condividere. Le voci extra si aggiungono solo all'offerta specifica.

Brief minimo riutilizzabile:

```text
Cliente/progetto:
Esigenza emersa e fonte:
Obiettivo:
Servizi e consegne richiesti:
Vincoli, tempi e referente:
Eccezioni rispetto alle condizioni standard:
```

Non è stato misurato un tempo medio di preparazione: il percorso è più corto, ma non è ancora dimostrato un tempo di produzione in minuti su casi reali.

## Rilascio e verifiche

La migration `20261021150547_commercial_proposal_templates.sql` aggiunge solo il collegamento Tourism, con indice, esclusione del doppio legame Agency/Tourism e controllo del proprietario. Non crea nuove tabelle pubbliche, non amplia le policy e non modifica i preventivi esistenti. La cancellazione di un deck lascia il preventivo nello storico.

Prima del rilascio applicare questa migration sul database target. I JSON delle basi commerciali usano le tabelle esistenti. Con lo schema precedente le presentazioni Tourism restano consultabili, ma la creazione di un preventivo collegato richiede la migration.

Verifiche riproducibili:

- `tests/commercial-proposal*.test.ts`: modelli separati, isolamento fra clienti, prezzo mancante/zero, segnaposto, alternative selezionate, INSERT unico e vincoli SQL reali in PGlite.
- Regressioni Agency, Tourism, agenti, PDF e abbonamenti.
- `tests/agency-proposals.browser.ts` e `tests/tourism-decks.browser.ts`: modelli modificabili, generazione Tourism simulata, approvazione e percorsi fino al preventivo/contratto precompilato; API intercettate.
- TypeScript e build di produzione; risultati del run registrati nella descrizione della PR.

Restano da verificare sul target autenticato i modelli effettivamente salvati, le proposte OGGI/Paparo correnti, la migrazione reale, le email e il flusso di firma/pagamento. Le prove locali non certificano questi passaggi in produzione.
