# Ufficio — dalle opportunità alla distribuzione (piano, 24 ottobre 2026)

Obiettivo nuovo dell'ufficio: **trovare opportunità, trasformarle in accordi, attivare la distribuzione delle guide.**

```
Direttore → Tourism / Distribuzione → opportunità qualificata → proposta e follow-up
          → accordo firmato → produzione e attivazione → partner attivo → risultati al Direttore
```

## Cosa dicono i dati di oggi (produzione, 24/10/2026)

| Fatto | Numero | Cosa vuol dire |
|---|---|---|
| Trattative aperte | 1.060 (New 409, Interested 311, Contacted 249, Waiting 53, Quote 20, Call booked 18) | La pipeline c'è ma è quasi tutta fredda: il Direttore deve scegliere, non elencare |
| Enti nel catalogo Tourism | 5.192 (verificati 2, da rivedere 149, non verificati 5.041) | Il collo di bottiglia **non è la scoperta, è la verifica**: gli enti ci sono, nessuno li ha qualificati |
| Enti collegati a un contatto CRM | 0 | Tourism e CRM oggi non si parlano |
| Partner nel CRM (`is_partner`) | 9 | La distribuzione non ha ancora una pipeline |
| Mappe collegate a contatti | 0 | Nessuna opportunità sa a quale guida si riferisce |
| Bozze email in attesa | 265, quasi tutte del vecchio generatore (`source = auto`) | La sovrapposizione col Commerciale è reale: va chiusa |

## L'ordine di costruzione

L'ordine di **importanza** resta quello indicato: 1 Direttore, 2 Tourism, 3 Distribuzione, 4 percorso unico, 5 dopo l'accordo. L'ordine di **costruzione** cambia per una ragione tecnica: Direttore, Tourism, Distribuzione e post-accordo scrivono e leggono tutti la stessa cosa, cioè l'opportunità. Se il percorso unico (punto 4) non c'è, ognuno se ne inventa uno e poi vanno riconciliati. Quindi:

| Fase | Contenuto | Punti | Chi |
|---|---|---|---|
| **A** | Percorso unico delle opportunità + un solo responsabile per comunicazione | 4 | Claude |
| **B** | Direttore sulle opportunità (piano del giorno) | 1 | Claude |
| **C** | Distribuzione: orchestratore + partner su Speaqi con link/QR attribuibili | 3 | Claude (CRM + API Speaqi) |
| **D** | Flusso Tourism completo (scoperta → verifica → qualifica → proposta) | 2 | Claude o ChatGPT, sul percorso della fase A |
| **E** | Dopo l'accordo: produzione, consegna, attivazione, risultati | 5 | Claude |

A e B insieme sono il minimo per cambiare il modo di lavorare; C è il pezzo nuovo; D ed E si appoggiano su A.

---

## Fase A — Un solo percorso per le opportunità (punto 4)

**Decisione: si estende `deals`, non si crea una seconda tabella.** Il CRM ha già una trattativa per contatto con la sua storia, i preventivi la agganciano (`quotes.deal_id`) e Agency la usa. Una tabella `opportunities` accanto sarebbe il secondo CRM che CLAUDE.md vieta.

Colonne nuove su `deals` (migration additiva, nulla di esistente cambia significato):

| Colonna | Cosa |
|---|---|
| `pipeline` | `vendite` (tutte le 1.060 di oggi, default) · `tourism` · `distribuzione` · `agency` |
| `entity_id` | L'organizzazione nel catalogo Tourism (`tourism_entities`), quando c'è |
| `role` | Che cosa è per noi: `destinazione`, `distributore`, `cliente_agenzia`, `cliente_mappe` |
| `map_ref` / `agency_project_id` | La guida o il progetto collegato (slug o id della mappa Speaqi; progetto Agency) |
| `owner` | Il responsabile: un membro del team **o** un agente (`agent:sales_followup`). Uno solo |
| `next_step` + `next_step_due` | Prossimo passo con scadenza: senza, l'opportunità è «ferma» e il Direttore la vede |
| `evidence` jsonb | Perché è un'opportunità: fonti, frasi, numeri con anno (stessa regola «il codice decide») |
| `potential_value` | Valore stimato con la sua origine (listino, preventivo, dimensione del partner) |
| `signed_at` / `activated_at` | **Accordo firmato e partner attivo sono due date diverse** (punto 5) |

Fasi delle nuove pipeline (le `vendite` restano quelle di oggi e restano lo specchio di `contacts.status`):

```
scoperta → qualificata → proposta → trattativa → accordo firmato → in attivazione → attiva
                                                       ↘ persa (con motivo)   ↘ ferma (attivazione fallita)
```

- L'indice «una trattativa aperta per contatto» diventa **una per contatto e pipeline**: lo stesso ente può avere aperta la proposta della guida (tourism) e quella della distribuzione.
- `syncDealWithContactStatus` tocca solo la pipeline `vendite`: le altre hanno fasi proprie e non cambiano lo stato del contatto.
- **Un solo responsabile per comunicazione**: ogni bozza email nasce legata a un'opportunità (`email_drafts.deal_id`) e solo l'`owner` dell'opportunità può prepararla. Una bozza in attesa blocca le altre sullo stesso contatto, chiunque le chieda (lo fa già la RPC del Commerciale: la regola diventa unica).
- **Chiudere la sovrapposizione email**: il vecchio generatore (`/api/ai/generate-drafts` e l'orchestratore delle 8, `source = auto`) diventa il **servizio** che scrive le bozze, chiamato solo dall'agente Commerciale (o da un umano con un clic). L'orchestratore smette di generare da solo. Le 265 bozze in attesa si possono archiviare in blocco dopo averle guardate.
- **Presentazioni e follow-up diventano servizi condivisi**: Tourism, Distribuzione e Agency chiedono una presentazione o un follow-up passando l'id dell'opportunità; chi la produce (Presentazioni, Commerciale) non decide il destinatario.
- Pagina: `/opportunita` (o una vista nuova di `/kanban`) con le quattro pipeline, filtro per responsabile, «ferme» e «scadute» in testa.

## Fase B — Il Direttore sceglie le opportunità del giorno (punto 1)

- Diventa **giornaliero** (feriali 7:30), non settimanale. Il piano mappe del lunedì resta, ma solo come input.
- Punteggio deterministico per ogni opportunità aperta (`src/lib/office/director-plan.ts`, puro):
  **evidenza** (quante prove verificate) × **valore potenziale** × **urgenza** (scadenza del prossimo passo, bando, stagione, preventivo in attesa) ÷ **lavoro necessario** (cosa manca: contatto verificato, presentazione, guida, preventivo).
- Uscita: «Oggi» con tre liste corte — **da lavorare** (max 5), **da sbloccare** (trattative ferme oltre la soglia, con il passo che manca), **partner da attivare** (accordi firmati non ancora attivi). Per ognuna: perché, prossimo passo, chi lo fa. Le azioni sono proposte nella coda «Aspetta te», come oggi.
- **Le mappe entrano solo se servono a un'opportunità**: «costruire Marsiglia» compare quando c'è una proposta, un pilota o una consegna che la richiede (`deals.map_ref` senza mappa pronta). Il piano mappe senza opportunità scende in fondo come «investimento».
- Il modello scrive solo le frasi; numeri, ordine e azioni restano del codice (come oggi).

## Fase C — Orchestratore Distribuzione (punto 3)

Nuovo agente `distribution`, reparto Commerciale (o reparto nuovo `distribuzione` nella scena).

1. **Chi cercare, per ogni guida online o in arrivo**: hotel e property manager della città, compagnie di crociera e traghetti che toccano il porto (già in `/navigazione` e `tourism_hub_operators`), tour operator e DMC, reti (consorzi, catene, associazioni albergatori), uffici turistici. Fonti: catalogo Tourism, compagnie di navigazione, contatti CRM, e scoperta web a budget per quello che manca.
2. **Qualifica** (regole scritte): quanta gente porta (camere, passeggeri, clienti), quanto è vicino alla guida, se ha già un canale verso il turista (email pre-arrivo, app, cartellonistica), se l'abbiamo già sentito.
3. **Modalità concreta + pilota** per ognuno, da un elenco chiuso: QR in camera/reception, link nella mail pre-arrivo, codici a tempo per i passeggeri (lotto + kit già esistenti su Speaqi), vetrina co-branded, commissione Referly. Il pilota ha durata, obiettivo misurabile (scansioni, aperture) e materiali.
4. **Opportunità `distribuzione`** nel percorso unico, con presentazione e follow-up chiesti ai servizi condivisi.
5. **Attribuzione**: su Speaqi esistono già partner, `/go/<slug>`, vetrine, lotti di codici e portale con statistiche (`map_distribution_partners`, `getStatsForOwner`). Manca solo l'accesso dal CRM: oggi quelle rotte vogliono il login web. Serve un controller con `x-api-key` (come quello di StudioMap) per **creare il partner, ottenere link/QR e leggere le statistiche**. Una guida → molti partner, ognuno col suo slug: è già il modello di Speaqi.

## Fase D — Flusso Tourism completo (punto 2)

```
scoperta (ricerca web a budget) → verifica (Arricchimento) → esigenza (qualifica) → opportunità tourism
→ presentazione (servizio) → follow-up (servizio) → trattativa
```

- **Il limite vero non è il catalogo, è la verifica**: ci sono già 5.041 enti non verificati. L'Arricchimento oggi parte solo dalle città con superguida prioritaria e da enti con sito: si allarga a **qualunque ente scelto dal Direttore** (opportunità in fase `scoperta`) e agli enti appena trovati dalla scoperta.
- **Scoperta**: si riusa `runTourismDiscovery` (ricerca web già nel CRM) ma passando dal ledger dell'ufficio (riserva prima, saldo dopo, prezzo dello strumento di ricerca nel listino). Trova enti mancanti per una città o una regione, li scrive come non verificati.
- **Qualifica dell'esigenza** con prove: bandi aperti, piano turistico che cita guide/digitale, assenza di una guida multilingue, flussi crocieristici misurati. Senza almeno una prova la fase non avanza.
- Esito: opportunità `tourism` con `entity_id`, `role = destinazione`, prossimo passo «presentazione», owner.

## Fase E — Dopo l'accordo (punto 5)

- `accordo firmato` (preventivo firmato/pagato, o a mano) crea in automatico, una volta sola:
  - **produzione**: accoda la guida a Costruttore My Maps / Lingue e voce se non è pronta (con Napoli sempre esclusa);
  - **consegna**: partner su Speaqi, link/QR, kit (biglietti, istruzioni), materiali al partner — bozza email, mai invio;
  - **attivazione**: un controllo dopo 7 e 21 giorni sulle statistiche del partner. Passa a **`attiva`** solo con scansioni/aperture reali; altrimenti `ferma` e torna al Direttore come «da sbloccare».
- **Risultati al Direttore**: per ogni accordo, aperture, persone, acquisti, costo di produzione. Il piano del giorno pesa di più i partner e le città che rendono.

## Cosa non si fa adesso

Gli altri agenti specialistici (social, osservatorio, eventi) restano come sono. Nessun invio automatico: proposte, bozze e code, sempre con il clic del titolare. Napoli resta intoccabile.
