# Speaqi Guides — Distribution Opportunities

Stato al 4 novembre 2026. Obiettivo: trasformare Tourism Intelligence, LeadOcean e il CRM in un motore per
trovare, qualificare e gestire chi può comprare, rivendere o distribuire le nove guide (Venezia, Bologna,
Milano, Roma, Firenze, Napoli, Capri, Costiera Amalfitana, Pompei).

Il KPI è partner attivati, guide vendute e fatturato. **Oggi nessuno dei tre è ancora misurabile:** il
sistema è pronto a trovare e gestire i partner, ma nessun partner è stato contattato né attivato.
Nessuna email è partita.

## 1. Audit — cosa c'era già e cosa si è riusato

| Pezzo | Stato | Uso |
|---|---|---|
| `tourism_entities` (4.200+ organizzazioni: DMC, tour operator, OTA, property manager, compagnie, crociere) | già pieno | base dei prospect |
| `tourism_hub_operators` (collegamenti compagnia–scalo, rinnovati da Wikipedia 11/2026) | già pieno | destinazioni certe per compagnie aeree, traghetti, crociere |
| flag `calls_naples` / `calls_civitavecchia` (crociere e traghetti) | già presenti | destinazione Napoli / Roma |
| `tourism_crm_links`, `tourism_promote`, `createLeadFromInput` | già presenti | passaggio al CRM |
| pipeline `distribuzione` delle Opportunità (`deals`) | già presente | pipeline commerciale |
| LeadOcean (ricerca aziende e persone, nessun tetto a record) | già collegato | arricchimento e nuovi prospect |
| punteggio di distribuzione, legame con le nove guide, modello commerciale | **mancava** | creato |
| tabella dei luoghi (`kind='place'`) | quasi vuota (Italia, Venezia, una «Roma» con paese sbagliato) | non usata: le guide si legano per slug |

Il punteggio vecchio della Fiera TTG (`scoreExhibitor`) misura un'altra cosa (somiglianza con un cliente di
Speaqi Maps) e non è stato toccato.

## 2. Cosa è stato costruito

- **Migration** `20261104090000…130000` (tutte applicate in produzione): `tourism_distribution`
  (punteggio, tier, componenti, guide, modello, stato commerciale, note), `tourism_distribution_destinations`
  (le destinazioni che un'azienda vende, con la fonte), `tourism_distribution_recompute()`,
  `tourism_distribution_summary()`.
- **API** `GET|POST /api/tourism/distribution`: elenco filtrato, riepilogo, esportazione, ricalcolo, stato
  e note, passaggio in pipeline CRM (massimo 25 per volta).
- **Interfaccia** scheda «Guides · Distribuzione» in `/tourism`: dashboard con copertura per guida, matrice
  destinazione × categoria, segmenti da esplorare, paesi, modelli e supporto della piattaforma; classifica
  con filtri combinabili (guida, categoria, paese, tier, modello, stato, contatti, volume, punteggio,
  strategici, attivabili subito, ricerca); viste «Top 100» e «Top 20 attivabili»; dettaglio con le sei
  componenti; esportazione CSV; «Porta in pipeline Distribuzione».
- **Test** `tests/tourism-distribution.db.test.ts` (8 test, migration vere su PGlite): il punteggio del database
  coincide con i pesi dichiarati, un dato ignoto non si inventa, lo stato di chi lavora sopravvive al
  ricalcolo, ogni proprietario vede solo i suoi prospect, i filtri scartano ciò che non riconoscono, il CSV
  disinnesca le formule.

## 3. Punteggio 0–100

| Componente | Peso | Da dove viene |
|---|---:|---|
| Compatibilità destinazioni | 20 | città di sede, nome/descrizione, scali e porti serviti, destinazioni vendute (segnali con fonte), flag crociere; regione = legame debole |
| Potenziale distributivo | 25 | dipendenti (LeadOcean) e tipologia; per le compagnie aeree gli scali delle guide serviti |
| Compatibilità commerciale | 20 | tipologia (traghetti, tour operator, property manager, OTA, DMC in alto) |
| Facilità di attivazione | 15 | piccola e italiana, con email/telefono/sito; SNAV e Dimorra come riferimento (traghetti e property manager +10) |
| Accessibilità contatti | 10 | email 55, telefono 25, sito 15, già nel CRM 5 |
| Servizi complementari | 10 | tipologia (marketplace di esperienze, OTA, property manager in alto) |

Tier: **A ≥ 72**, **B ≥ 58**, **C ≥ 44**, **D** sotto. *Strategico* = Tier A/B e grande canale (crociere, OTA,
marketplace, bedbank, network, compagnie aeree su 3+ scali delle guide). *Attivabile subito* = Tier A/B,
email, tipologia che decide in fretta (DMC, tour operator, agenzia, property manager, traghetti, alloggio,
trasporto) e al massimo 200 dipendenti.

**Un dato ignoto vale poco, non zero e non inventato**: l'accessibilità contatti di un'azienda senza email è bassa e
la «completezza dei dati» (0–100) è mostrata accanto a ogni punteggio.

## 4. Numeri (aggiornati il 4/11/2026, sera)

| | |
|---|---:|
| Aziende valutate | 5.447 |
| Tier A / B / C / D | 48 / 787 / 3.008 / 1.604 |
| Prospect qualificati (A+B) | 835 (601 con almeno una guida) |
| Aziende con almeno una guida collegata | 875 (694 Italia, 181 estero in 62 paesi) |
| Con segnale «Italia» ma senza guida precisa | 25 |
| Referenti salvati | 20 persone (5 di Costa Crociere; email non rivelate) |
| Nuove da LeadOcean il 4/11 | 75 (primo giro) + 46 tour operator di USA/CA/UK/DE/FR/AU + 10 DMC europei + 20 operatori nord-europei |

**Come si leggono i numeri.** Le 875 misurano *solo* la domanda di oggi: chi può comprare o distribuire le 9 guide
che esistono. Non sono il mercato: lo stesso bisogno esiste in Francia, Spagna, Portogallo, Grecia e altrove, e quelle
aziende restano fuori finché non c'è una guida o una destinazione di quel paese. Per questo il target «3.000 pertinenti»
va letto in due numeri: **pertinenti per le guide attuali (875)** e **pertinenti per qualunque destinazione (mercato
mondiale per le guide future)**, che oggi non è misurato e va costruito con ricerche per paese e destinazione.

**Target iniziale: 3.000 aziende pertinenti e 500 prospect qualificati.**
- Prospect qualificati (Tier A+B): **835**, di cui 601 con una guida collegata. **Obiettivo raggiunto**, con la
  riserva che parte dei Tier B ha solo una casella generica e non un referente.
- Aziende pertinenti per le guide attuali: **875**. **Obiettivo non raggiunto**; non ho contato le aziende senza prova.
- Ogni giro di ricerca LeadOcean porta tra 10 e 50 aziende davvero pertinenti dopo la pulizia (le categorie NAICS sono
  sporche): arrivare a 3.000 richiede decine di giri per paese e categoria, non uno.

Per guida (aziende collegate · Tier A · Tier B): Roma 359 · 27 · 244; Milano 273 · 8 · 186; Firenze 140 · 10 · 95;
Venezia 134 · 7 · 90; Napoli 127 · 31 · 84; Costiera Amalfitana 87 · 10 · 60; Bologna 69 · 2 · 49; Capri 54 · 4 · 44;
Pompei 49 · 2 · 38.

Per paese (Tier A+B): Italia 644, Stati Uniti 45, Regno Unito 19, Germania 16, Australia 8, Spagna 7, Francia 6.
**L'estero è il segmento più scoperto**: ci sono quasi solo i grandi nomi (crociere, compagnie, OTA) e pochi
tour operator.

## 5. Modelli commerciali e cosa supporta la piattaforma

| Modello | Prospect A+B | Supporto oggi |
|---|---:|---|
| Distribuzione B2B agli ospiti (property manager, alloggi) | 263 | **Sì**: QR del partner `/go/<partner>` con vetrina `/p/<partner>`, vendita attribuita |
| Acquisto e rivendita (DMC, tour operator, agenzie) | 392 | **In parte**: non esistono lotti all'ingrosso (i codici a tempo sono stati ritirati il 28/10/2026); si compra per altri con il regalo e con i codici di sblocco SPQ- |
| Bundle con hotel, trasporti o esperienze (traghetti, crociere, compagnie) | 162 | **In parte**: pass territorio e regalo, ma non un pacchetto con biglietti di terzi: lo compone il partner |
| Affiliazione con commissioni (OTA, marketplace, media) | 4 | **Sì**: Referly e programma partner B2B con `partner_slug` |
| Partnership e revenue sharing | 2 | **Sì**: il programma B2B calcola le commissioni sulle vendite verificate |

**Lacuna principale:** per «acquisto e rivendita» (il modello consigliato a più di un terzo dei prospect) manca un
prodotto a lotti. Va deciso prima di proporlo ai DMC e ai tour operator: o si propone l'affiliazione/B2B agli
ospiti, o si costruisce un pacchetto di codici da rivendere.

## 6. Top 20 opportunità attivabili subito

Tutti con email e telefono nel database, traghetti e DMC di piccole/medie dimensioni.

| # | Azienda | Tipo | Punti | Guide | Modello |
|---:|---|---|---:|---|---|
| 1 | Alilauro | traghetti | 81 | Napoli | bundle |
| 2 | Laziomar | traghetti | 81 | Napoli | bundle |
| 3 | NLG Navigazione Libera del Golfo | traghetti | 81 | Napoli | bundle |
| 4 | Travelmar | traghetti | 81 | Costiera Amalfitana | bundle |
| 5 | Alicost | traghetti | 79 | Napoli | bundle |
| 6 | GNV Grandi Navi Veloci | traghetti | 79 | Napoli, Roma | bundle |
| 7 | SNAV | traghetti | 79 | Napoli, Capri | bundle |
| 8 | Siremar | traghetti | 76 | Napoli | bundle |
| 9 | Misterwhite Travel | DMC | 72 | Capri, Costiera, Napoli | rivendita |
| 10 | Reve SRL | DMC | 72 | Capri, Costiera, Napoli, Pompei | rivendita |
| 11 | Ganimede Viaggi | DMC | 70 | Costiera, Napoli | rivendita |
| 12 | Venice Water Link | DMC | 70 | Venezia | rivendita |
| 13 | Bay of Sun | DMC | 69 | Napoli | rivendita |
| 14 | Ciaoflorence Tours & Travels | DMC | 69 | Firenze | rivendita |
| 15 | Crippa Massimiliano (Italian Exclusive Experience) | DMC | 69 | Milano | rivendita |
| 16 | Michelangelo International Travel | DMC | 69 | Milano | rivendita |
| 17 | Secret Italy | DMC | 69 | Roma | rivendita |
| 18 | Sovi Turismo (Sunland) | DMC | 69 | Costiera Amalfitana | rivendita |
| 19 | Tomorrow Travel | DMC | 69 | Roma | rivendita |
| 20 | Blu Navy | traghetti | 68 | — | bundle |

SNAV è nell'elenco al 7° posto: nel database non aveva né città né descrizione, quindi l'ho legata a Napoli e Capri
citando come fonte la tua indicazione del riferimento (riga in `tourism_distribution_destinations`). Dimorra è Tier B
(69) senza email: resta il modello dei property
manager (Halldis, Brera Apartments, Casa da Suite e Iflat sono Tier A senza email: serve il referente).

## 7. Top 100 partner prioritari (Tier A+B per punteggio)

`S` = strategico, `Q` = attivabile subito, `E` = ha un'email nel database.

| # | Azienda | Tipo | Paese | Punti | Tier | Modello | |
|---:|---|---|---|---:|---|---|---|
| 1 | Alilauro | traghetti | IT | 81 | A | bundle | Q E |
| 2 | Laziomar | traghetti | IT | 81 | A | bundle | Q E |
| 3 | NLG Navigazione Libera del Golfo | traghetti | IT | 81 | A | bundle | Q E |
| 4 | Travelmar | traghetti | IT | 81 | A | bundle | Q E |
| 5 | Alicost | traghetti | IT | 79 | A | bundle | Q E |
| 6 | Costa Crociere | crociere | IT | 79 | A | bundle | S E |
| 7 | GNV Grandi Navi Veloci | traghetti | IT | 79 | A | bundle | Q E |
| 8 | AIDA Cruises | crociere | DE | 76 | A | bundle | S E |
| 9 | Ambassador Cruise Line | crociere | GB | 76 | A | bundle | S E |
| 10 | Atlas Ocean Voyages | crociere | US | 76 | A | bundle | S E |
| 11 | Aurora Expeditions | crociere | AU | 76 | A | bundle | S E |
| 12 | Carnival Cruise Line | crociere | US | 76 | A | bundle | S E |
| 13 | Celebrity Cruises | crociere | US | 76 | A | bundle | S E |
| 14 | Celestyal Cruises | crociere | GR | 76 | A | bundle | S E |
| 15 | CroisiEurope | crociere | FR | 76 | A | bundle | S E |
| 16 | Explora Journeys | crociere | CH | 76 | A | bundle | S E |
| 17 | Hapag-Lloyd Cruises | crociere | DE | 76 | A | bundle | S E |
| 18 | Holland America Line | crociere | US | 76 | A | bundle | S E |
| 19 | nicko cruises | crociere | DE | 76 | A | bundle | S E |
| 20 | Orient Express Sailing Yachts | crociere | FR | 76 | A | bundle | S E |
| 21 | Phoenix Reisen | crociere | DE | 76 | A | bundle | S E |
| 22 | Plantours Kreuzfahrten | crociere | DE | 76 | A | bundle | S E |
| 23 | Princess Cruises | crociere | US | 76 | A | bundle | S E |
| 24 | Seabourn | crociere | US | 76 | A | bundle | S E |
| 25 | SeaDream Yacht Club | crociere | NO | 76 | A | bundle | S E |
| 26 | Silversea Cruises | crociere | MC | 76 | A | bundle | S E |
| 27 | TUI Cruises (Mein Schiff) | crociere | DE | 76 | A | bundle | S E |
| 28 | VidantaWorld Voyages (Elegant) | crociere | MX | 76 | A | bundle | S E |
| 29 | Siremar | traghetti | IT | 76 | A | bundle | Q E |
| 30 | Hostelsclub.com | OTA | IT | 75 | A | affiliazione | S |
| 31 | Uvet | DMC | IT | 74 | A | rivendita | |
| 32 | Alilauro Gruson (Gescab) | traghetti | IT | 74 | A | bundle | |
| 33 | Caremar | traghetti | IT | 74 | A | bundle | |
| 34 | Medmar | traghetti | IT | 74 | A | bundle | |
| 35 | Tirrenia (CIN) | traghetti | IT | 74 | A | bundle | |
| 36 | Halldis by Vita | property manager | IT | 73 | A | B2B ospiti | |
| 37 | Cunard | crociere | GB | 73 | A | bundle | S E |
| 38 | Scenic (Scenic Eclipse) | crociere | AU | 73 | A | bundle | S E |
| 39 | Wonderful Italy | tour operator | IT | 73 | A | rivendita | |
| 40 | Air Dolomiti | compagnia aerea | IT | 73 | A | bundle | S |
| 41 | ITA Airways | compagnia aerea | IT | 73 | A | bundle | S |
| 42 | Brera Apartments | property manager | IT | 72 | A | B2B ospiti | |
| 43 | Casa Da Suite | property manager | IT | 72 | A | B2B ospiti | |
| 44 | Iflat Group | property manager | IT | 72 | A | B2B ospiti | |
| 45 | Misterwhite Travel | DMC | IT | 72 | A | rivendita | Q E |
| 46 | Reve SRL | DMC | IT | 72 | A | rivendita | Q E |
| 47 | Musement | marketplace | IT | 72 | A | affiliazione | S |
| 48 | Alltours.it | tour operator | IT | 71 | B | rivendita | |
| 49 | Azemar | tour operator | IT | 71 | B | rivendita | |
| 50 | Bus2alps | tour operator | IT | 71 | B | rivendita | |
| 51 | Ixpira | tour operator | IT | 71 | B | rivendita | |
| 52 | Origini International | tour operator | IT | 71 | B | rivendita | |
| 53 | Primavera Viaggi | tour operator | IT | 71 | B | rivendita | |
| 54 | Rome And Italy | DMC | IT | 71 | B | rivendita | |
| 55 | Topbike Rental & Tours | tour operator | IT | 71 | B | rivendita | |
| 56 | Trustforce | tour operator | IT | 71 | B | rivendita | |
| 57 | Vamonos Vacanze | tour operator | IT | 71 | B | rivendita | |
| 58 | Viaggiuniversitari.it | tour operator | IT | 71 | B | rivendita | |
| 59 | World Explorer | tour operator | IT | 71 | B | rivendita | |
| 60 | Worldtours | DMC | IT | 71 | B | rivendita | |
| 61 | Access Italy | tour operator | IT | 71 | B | rivendita | |
| 62 | Grimaldi Lines | traghetti | IT | 71 | B | bundle | |
| 63 | Intertravel Luxury DMC | DMC | IT | 71 | B | rivendita | |
| 64 | Palazzi Agency | DMC | IT | 71 | B | rivendita | |
| 65 | Vinarium | tour operator | IT | 71 | B | rivendita | |
| 66 | Navigazione laghi (Maggiore, Como, Garda) | traghetti | IT | 71 | B | bundle | |
| 67–81 | Aegean, Air Cairo, Air France, Air Serbia, Austrian, British Airways, easyJet, Eurowings, Iberia, KLM, Luxair, Neos, Ryanair, Volotea, Wizz Air | compagnie aeree | varie | 71 | B | bundle | S |
| 82 | Ganimede Viaggi | DMC | IT | 70 | B | rivendita | Q E |
| 83 | Venice Water Link | DMC | IT | 70 | B | rivendita | Q E |
| 84–95 | Booking.com, Civitatis, Expedia, Expedia Group, GetYourGuide, KKday, Viator, Airbnb, Headout, Klook, Tiqets, Tripadvisor | OTA/marketplace | varie | 70 | B | affiliazione | S |
| 96–100 | 3L World, Affitti Brevi Italia – Milano, Ag Boutique Journey, Appennino Slow, Atelier Vacanze | tour operator/DMC/property manager | IT | 69 | B | rivendita/B2B ospiti | |

La classifica completa e filtrabile è nella scheda «Guides · Distribuzione» (esportabile in CSV): questo
elenco è una fotografia del 4/11/2026.

## 8. Matrice destinazione × categoria (Tier A+B / totali)

| Categoria | Ve | Bo | Mi | Ro | Fi | Na | Ca | Co | Po |
|---|---|---|---|---|---|---|---|---|---|
| DMC | 14/14 | 3/3 | 15/15 | 32/33 | 12/12 | 11/12 | 6/6 | 9/9 | 4/4 |
| Tour operator | 8/8 | 2/2 | 19/19 | 31/31 | 18/18 | 7/7 | 4/4 | 7/7 | 3/3 |
| Property manager | 4/4 | 3/3 | 21/21 | 13/13 | 5/5 | 5/5 | 1/1 | 1/1 | 1/1 |
| Agenzie di viaggio | 2/4 | 3/9 | 5/5 | 4/5 | 1/4 | 3/3 | 0/1 | 1/2 | 0/1 |
| Alloggi | 13/36 | 7/16 | 64/82 | 81/99 | 28/40 | 13/17 | 4/7 | 6/12 | 1/7 |
| Traghetti | 1/1 | — | 3/3 | 5/5 | — | 9/9 | — | 2/2 | — |
| Crociere | 12/12 | — | — | 40/40 | 18/18 | 36/36 | 2/2 | 12/12 | — |
| Compagnie aeree | 40/40 | 33/33 | 66/80 | 64/74 | 22/23 | 31/32 | 31/32 | 31/32 | 31/32 |
| OTA | 10/10 | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 |
| Marketplace di esperienze | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

**Segmenti inesplorati** (pochi prospect qualificati): le righe OTA e marketplace sono piene solo perché ho
associato i 12 grandi cataloghi globali a tutte le guide (fonte: «verificare sul sito»), non perché si sappia che
vendono ogni guida; agenzie di viaggio a Capri, Pompei, Firenze e Costiera; tour operator esteri in tutte le guide
(Bologna, Pompei, Capri, Costiera Amalfitana più di tutte); property manager a Capri, Costiera e Pompei;
**ogni categoria all'estero** (tour operator americani, britannici, tedeschi, australiani: 45 + 19 + 16 + 8
qualificati in tutto).

## 9. Piano a 30 giorni: due prove prima di scalare

**Indirizzo del 4/11/2026 (titolare).** Le «3.000 aziende» non sono un obiettivo. Le guide possono diventare di città, di area
o di paese intero e si lavora paese per paese, partendo dai più visitati (Francia: Parigi, Normandia, Francia intera). Prima si
verifica quale canale funziona:

1. **Strada 1 — guide stile Lonely Planet vendute tramite i tour operator**, con un pilota a codice di accesso (codici `SPQ-` dei posti acquistati).
2. **Strada 2 — accordo con un distributore** (GetYourGuide, Musement, Tiqets, Viator, Klook, Headout, Civitatis).
3. **Accordi di città** con una compagnia aerea o di traghetti (ITA Airways per Roma; SNAV, Alilauro, Caremar per Napoli e Capri).

Nessuna email parte senza il via libera del titolare.

**Settimana 1 — la domanda ai distributori (decide se la strada 2 esiste)**
- Una sola domanda a Musement e Tiqets (poi GetYourGuide): accettate guide digitali a pagamento in catalogo, e a quali condizioni (commissione, formato, integrazione)?
- Esito atteso: sì/no e condizioni. Senza risposta in 10 giorni si sollecita una volta.

**Settimana 2 — pilota con i tour operator**
- Cinque operatori già in Tier A/B che vendono Roma, Firenze o Napoli (es. Ciao Florence, Michelangelo, Caravelle Tours, Hello Italy Tours).
- Offerta: un codice di accesso alla guida della città da includere nei pacchetti; poi chiamata di 15 minuti.

**Settimana 3 — accordi di città**
- Traghetti del Golfo (stessa famiglia di SNAV): bundle con il biglietto o QR a bordo.
- ITA Airways per Roma: proposta di guida inclusa o venduta a bordo/online.

**Settimana 4 — misura e decisione sui paesi**
- Leggere i risultati: contatti fatti, risposte, pilota attivo, guide vendute per `partner_slug`.
- Decidere quali guide estere costruire per prime (Francia, Spagna, Regno Unito, Grecia) in base a quale strada ha risposto.

**Condizioni economiche ancora da fissare** (non scritte in nessun punto del CRM): commissione per i distributori e prezzo dei codici
per i tour operator. Le bozze di contatto non le citano.

## 10. Criticità e limiti (da leggere prima di fidarsi dei numeri)

1. **Il punteggio è un ordinamento, non una previsione.** Nessuna componente misura un fatturato reale: il
   «potenziale distributivo» deriva da dipendenti e tipologia.
2. **Pochi dati ricchi.** Solo circa 1.250 enti hanno dipendenti e sede (LeadOcean); gran parte degli altri ha
   solo nome e sito. Le email sono 855 su 5.447 e quasi tutte appartengono a crociere, traghetti e DMC.
3. **Contatti = caselle d'ufficio, non referenti.** Per i Tier A senza email serve un passaggio di
   ricerca persone (LeadOcean) che non è stato fatto in questa sessione. Gli attuali «attivabili subito» hanno
   email generiche (`info@`, `customer@`).
4. **Compagnie aeree e crociere sono ovunque.** Hanno punteggio alto per aver scali/porti nelle città, ma sono
   i partner meno semplici da attivare: per questo il Tier non basta e si guarda anche «strategico» e «attivabile».
5. **Destinazioni degli OTA/marketplace non provate.** Ho associato Viator, GetYourGuide, Civitatis, Tiqets, Musement,
   Klook, KKday, Headout, Tripadvisor, Booking, Airbnb ed Expedia a tutte le nove guide perché hanno cataloghi globali;
   la fonte dice «verificare sul sito».
6. **Il rumore di LeadOcean.** Le ricerche per parola chiave portano molti falsi positivi («Naples, Florida», «Sorrento,
   Australia»): per questo ho importato solo i risultati selezionati a mano da una ricerca per nome (61 su 100 pagine
   lette) e ho scartato il resto. I codici NAICS sono sporchi (721110 vale «hotel» per quasi tutti).
7. **Rete e rate limit.** Wikipedia ha risposto con 429 durante la raccolta; la lista ufficiale dei codici
   compagnia non era raggiungibile. LeadOcean non ha dato limiti, ma ogni pagina letta costa contesto.
8. **Rivendita senza prodotto.** Vedi sezione 5: il modello consigliato a più prospect non ha un pacchetto di
   codici all'ingrosso.
9. **Non verificato su un browser.** Il tipo e i test passano, ma la scheda non è stata aperta in un browser
   (la sessione non ha un'istanza dell'app) e il codice non è ancora in produzione: è sul ramo
   `ccr-14643bef-sdpquc`. Le migration sono invece già applicate in produzione.
10. **Ordine di deploy:** prima le migration (già fatte), poi il codice. La scheda legge `tourism_distribution`,
    senza la quale risponde 503.

## 11. Come rilanciare

- **Ricalcolare i punteggi:** pulsante «Ricalcola punteggi» nella scheda, oppure `POST /api/tourism/distribution`
  `{ "action": "recompute" }`. Va fatto dopo ogni importazione.
- **Aggiungere destinazioni vendute:** riga in `tourism_distribution_destinations` (guida, azienda, fonte).
  Lo slug `italia` indica uno specialista dell'Italia senza città certa (pesa 60 invece di 80–95).
- **Cambiare i pesi o le soglie:** `src/lib/tourism-distribution.ts` (etichette e pesi dichiarati) **e** la funzione
  SQL; il test controlla che combacino.
