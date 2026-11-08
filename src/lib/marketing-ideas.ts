// Idee per vendere le guide Speaqi ai partner (promozione B2B), dentro l'area
// Marketing del CRM. Modulo puro: le idee di partenza stanno qui (si aggiungono
// con una riga), lo stato di lavoro (stato, responsabile, scadenza, note) sta nella
// tabella `marketing_ideas`. Le idee scritte a mano dall'interfaccia vivono
// solo nella tabella (`title` valorizzato).

export const IDEA_STATUSES = ['Backlog', 'Da validare', 'Pianificata', 'In corso', 'Bloccata', 'Completata'] as const
export type IdeaStatus = (typeof IDEA_STATUSES)[number]

export const IDEA_BUDGETS = ['< €500', '€500–€5k', '€5k+', 'Partnership'] as const
export type IdeaBudget = (typeof IDEA_BUDGETS)[number]

export type IdeaSeed = {
  key: string
  title: string
  category: string
  budget: IdeaBudget
  description: string
  nextAction: string
  /** Da cui partire: nasce «Da validare» invece di «Backlog». */
  start?: boolean
}

export type IdeaRow = {
  idea_key: string
  status?: string | null
  owner?: string | null
  deadline?: string | null
  progress?: number | null
  notes?: string | null
  title?: string | null
  category?: string | null
  budget?: string | null
  description?: string | null
  next_action?: string | null
}

export type Idea = IdeaSeed & {
  custom: boolean
  status: IdeaStatus
  owner: string
  deadline: string
  progress: number
  notes: string
  score: number
}

export const IDEA_SEEDS: IdeaSeed[] = [
  { key: 'pass-del-golfo-di-napoli', title: 'Pass del Golfo di Napoli', category: 'Prodotto', budget: '< €500', description: 'Un pass unico per Napoli, Pompei, Capri e Costiera Amalfitana a un prezzo più basso della somma: sono quattro guide sullo stesso territorio e chi viene qui le visita quasi sempre tutte in una settimana. È il pacchetto che partner e tour operator vendono o regalano con un solo codice.', nextAction: 'Creare il pass da Pass territorio in Speaqi e fissare il prezzo.', start: true },
  { key: 'pass-grand-tour-italia', title: 'Pass Grand Tour Italia', category: 'Prodotto', budget: '< €500', description: 'Roma, Firenze, Venezia, Milano e Bologna in un solo pass: è il primo viaggio in Italia di americani, asiatici e australiani, tutto in treno. Il pass è il prodotto per tour operator e agenzie estere.', nextAction: 'Creare il pass da Pass territorio e fissare il prezzo.', start: true },
  { key: 'prezzo-uniforme-di-roma-e-venezia', title: 'Prezzo uniforme di Roma e Venezia', category: 'Decisione', budget: '< €500', description: 'Roma costa 19,90 € e Venezia 12,90 € mentre le altre guide 9,90 €. In una vetrina con dieci città il partner deve spiegare perché: o si allinea il prezzo, o la differenza si assorbe nei pass.', nextAction: 'Decidere il listino prima di scrivere ai partner.' },
  { key: 'top-20-attivabili-traghetti-e-dmc', title: 'Top 20 attivabili: traghetti e DMC', category: 'Prospecting', budget: '< €500', description: 'Il motore di distribuzione di Tourism Intelligence ha già la classifica: otto compagnie di traghetti e undici DMC con email e telefono. Si parte da lì, non da una lista nuova: un messaggio a testa, con la vetrina già pronta.', nextAction: 'Aprire «Top 20 attivabili» e portarli in pipeline Distribuzione.', start: true },
  { key: 'tour-operator-esteri-per-l-italia', title: 'Tour operator esteri per l’Italia', category: 'Estero', budget: '€500–€5k', description: 'L’estero è il segmento più scoperto: ci sono quasi solo i grandi nomi. Un giro per paese di tour operator che vendono l’Italia (USA, UK, Germania, Australia), con codici prepagati del pass Grand Tour.', nextAction: 'Un giro LeadOcean per paese e un primo messaggio in inglese.' },
  { key: 'deposito-bagagli-esim-e-assicurazioni-viaggio', title: 'Deposito bagagli, eSIM e assicurazioni viaggio', category: 'Canali', budget: '€500–€5k', description: 'Chi compra questi servizi prima di partire è lo stesso cliente della guida: il link entra nella loro email di conferma con la commissione, valido per tutte le città insieme.', nextAction: 'Elencare cinque servizi e provare il link partner in una loro conferma.' },
  { key: 'kit-reception-in-10-minuti', title: 'Kit reception in 10 minuti', category: 'Ospitalità', budget: '< €500', description: 'Display da banco A5 con il QR del partner e una frase sola: «La guida della città nella tua lingua, audio e offline». Il receptionist lo indica al check-in; ogni vendita è attribuita al partner con la sua commissione.', nextAction: 'Stampare un display per ogni partner già attivo, con il QR preso dalla sua scheda in Partner.', start: true },
  { key: 'la-guida-nel-messaggio-pre-arrivo', title: 'La guida nel messaggio pre-arrivo', category: 'Ospitalità', budget: '< €500', description: 'Testo pronto da incollare nell’email o nel WhatsApp che hotel e host mandano prima dell’arrivo, con il link alla vetrina del partner. L’ospite compra quando pianifica, non quando è già in strada.', nextAction: 'Scrivere il messaggio in it/en/es/fr/de e la guida per inserirlo nei messaggi automatici di Booking e Airbnb.' },
  { key: 'cartoncino-in-camera', title: 'Cartoncino in camera', category: 'Ospitalità', budget: '< €500', description: 'Biglietto sul comodino o nella welcome letter con il QR della vetrina: l’ospite apre la guida la sera prima del giro, con calma, ed è lì che compra.', nextAction: 'Impaginare il cartoncino in quattro lingue e proporlo a 10 B&B del centro.' },
  { key: 'poster-della-mappa-per-la-hall', title: 'Poster della mappa per la hall', category: 'Materiali', budget: '< €500', description: 'La stampa mappa (PDF A2) della guida con i luoghi numerati e il QR del partner in basso: è arredo per la hall e insieme punto vendita.', nextAction: 'Stampare il poster di Napoli con il QR partner e provarlo in tre hall per un mese.' },
  { key: 'il-concierge-la-usa-gratis', title: 'Il concierge la usa gratis', category: 'Sales kit', budget: '< €500', description: 'Accesso omaggio alla guida per il personale di reception e concierge: chi la conosce la consiglia con convinzione, e risponde meglio anche alle domande degli ospiti.', nextAction: 'Creare accessi omaggio per lo staff dei primi 15 hotel target.' },
  { key: 'tre-frasi-per-lo-staff', title: 'Tre frasi per lo staff', category: 'Sales kit', budget: '< €500', description: 'Formazione di 15 minuti (call o video) con le tre frasi da dire al banco, in quattro lingue, e le risposte alle obiezioni («c’è Google Maps», «costa»).', nextAction: 'Registrare il video e allegarlo all’email di benvenuto del partner.' },
  { key: 'vetrina-pronta-prima-dell-incontro', title: 'Vetrina pronta prima dell’incontro', category: 'ABM', budget: '< €500', description: 'Prima di ogni appuntamento si crea la vetrina con logo e colori della struttura e la si mostra funzionante sul telefono del direttore: non si vende un’idea, si consegna un prodotto.', nextAction: 'Checklist da 15 minuti: partner in bozza, logo, città in vetrina, QR stampato.', start: true },
  { key: 'presentazione-partner-dopo-ogni-chiamata', title: 'Presentazione partner dopo ogni chiamata', category: 'Sales kit', budget: '< €500', description: 'La presentazione partner generata dal Direttore (QR, commissione, vetrina, portale) parte subito dopo la telefonata, in PDF e su Telegram.', nextAction: 'Fissare nel modello partner le condizioni standard (20%) così nessuna presentazione resta con [DA VERIFICARE].' },
  { key: 'calcolatore-guadagno-partner', title: 'Calcolatore guadagno partner', category: 'Calculator', budget: '< €500', description: 'Pagina che stima l’incasso annuo di un partner: camere × occupazione × quota di ospiti stranieri × conversione × prezzo guida × commissione. Il numero apre la conversazione.', nextAction: 'Definire formule e tre scenari: B&B da 6 camere, hotel da 60, tour operator da 2.000 passeggeri.' },
  { key: 'napoli-e-roma-per-prime', title: 'Napoli e Roma per prime', category: 'Prospecting', budget: '< €500', description: 'Con dieci città il rischio è fare un poco di tutto. Napoli e Roma hanno più luoghi e più clienti: trenta partner in ciascuna danno numeri veri, e il primo caso da raccontare per replicare nelle altre.', nextAction: 'Scegliere i 30 obiettivi di ciascuna dalla classifica di Tourism Intelligence.' },
  { key: 'strutture-vicine-ai-luoghi-della-guida', title: 'Strutture vicine ai luoghi della guida', category: 'Prospecting', budget: '< €500', description: 'Priorità alle strutture a pochi passi dai luoghi più aperti della guida: i loro ospiti escono a piedi proprio verso quei posti.', nextAction: 'Incrociare i luoghi più aperti con hotel e B&B entro 500 metri e importarli come enti.' },
  { key: 'property-manager-in-piu-citta', title: 'Property manager in più città', category: 'Ospitalità', budget: '< €500', description: 'Un property manager con appartamenti a Roma, Firenze, Venezia e Milano vale un accordo solo: il QR va nel manuale digitale della casa e nel messaggio di check-in automatico, e vende la guida giusta per ogni città.', nextAction: 'Dalla scheda «Guides · Distribuzione» di Tourism Intelligence, filtro «Distribuzione B2B agli ospiti»: scegliere i primi 20.' },
  { key: 'ncc-e-transfer-dall-aeroporto', title: 'NCC e transfer dall’aeroporto', category: 'Trasporti', budget: '< €500', description: 'QR sul poggiatesta di NCC e transfer: il tragitto dall’aeroporto è il momento in cui il viaggiatore si chiede cosa vedere.', nextAction: 'Contattare tre consorzi NCC con l’offerta partner e il calcolatore.' },
  { key: 'noleggio-scooter-bici-e-auto', title: 'Noleggio scooter, bici e auto', category: 'Trasporti', budget: '< €500', description: 'Link alla vetrina nella conferma di noleggio e QR sul mezzo: chi noleggia vuole andare in giro, la guida gli dice dove.', nextAction: 'Proporre la partnership a cinque noleggiatori del centro.' },
  { key: 'report-mensile-al-partner', title: 'Report mensile al partner', category: 'Retention', budget: '< €500', description: 'Ogni mese un’email al partner con aperture, acquisti e commissione maturata, presi dal portale partner. Un partner che vede i numeri continua a esporre il QR.', nextAction: 'Scrivere il modello dell’email e la regola di invio dal portale.' },
  { key: 'il-primo-caso-in-60-secondi', title: 'Il primo caso in 60 secondi', category: 'Contenuti', budget: '< €500', description: 'Video breve con un partner vero: quante guide ha venduto, cosa dice al banco, quanto ha incassato. Diventa la prova per tutti gli altri.', nextAction: 'Scegliere il partner con più vendite e girare il video.' },
  { key: 'offerta-partner-fondatori', title: 'Offerta partner fondatori', category: 'Offer', budget: '< €500', description: 'I primi 20 partner di una città hanno la commissione maggiorata per tre mesi e il nome nella vetrina «consigliata da». Crea urgenza senza abbassare il prezzo al viaggiatore.', nextAction: 'Decidere percentuale e durata e scriverle come nuova versione dell’accordo B2B.' },
  { key: 'procacciatori-di-quartiere', title: 'Procacciatori di quartiere', category: 'Procacciatori', budget: '< €500', description: 'Persone del settore (ex receptionist, guide, agenti) portano strutture e prendono il 10% delle vendite dei partner portati per 12 mesi, più il bonus a 1.000 € venduti.', nextAction: 'Pubblicare l’annuncio e attivare tre procacciatori su Napoli in prova.' },
  { key: 'partner-che-porta-partner', title: 'Partner che porta partner', category: 'Procacciatori', budget: '< €500', description: 'Il partner soddisfatto presenta il collega dell’hotel accanto e diventa suo procacciatore: il passaparola fra albergatori vale più di qualsiasi email.', nextAction: 'Aggiungere al report mensile la riga «presentaci un collega».' },
  { key: 'kit-stampa-scaricabile-dal-portale', title: 'Kit stampa scaricabile dal portale', category: 'Materiali', budget: '< €500', description: 'Dal portale il partner scarica da solo display, cartoncino, poster e testo pre-arrivo già con il suo QR: zero attesa, zero lavoro per noi.', nextAction: 'Elencare i materiali e decidere dove metterli nel portale partner.' },
  { key: 'guida-in-regalo-nei-pacchetti', title: 'Guida in regalo nei pacchetti', category: 'Prepagati', budget: '€500–€5k', description: 'L’hotel compra codici prepagati a prezzo partner e li regala con suite, pacchetti romantici o soggiorni lunghi: per lui è un benefit che costa poco, per noi un lotto pagato in anticipo.', nextAction: 'Listino lotti (10/50/200 codici) e biglietto stampato di esempio.' },
  { key: 'tour-operator-incoming', title: 'Tour operator incoming', category: 'Tour operator', budget: '€500–€5k', description: 'La guida inclusa nel pacchetto: un codice prepagato per ogni partecipante, consegnato con i documenti di viaggio, per il tempo libero fra un’escursione e l’altra.', nextAction: 'Dieci tour operator incoming in Campania e Lazio con proposta a lotto.' },
  { key: 'agenzie-outbound-italiane', title: 'Agenzie outbound italiane', category: 'Agenzie', budget: '€500–€5k', description: 'Le agenzie che vendono viaggi a Lisbona, Londra o Barcellona aggiungono la guida al kit di viaggio, rivendendola o regalandola: margine per loro, cliente più soddisfatto.', nextAction: 'Lista di 20 agenzie che vendono le città già pronte, con offerta a lotto.' },
  { key: 'aliscafi-e-traghetti-il-pass-sul-biglietto', title: 'Aliscafi e traghetti: il pass sul biglietto', category: 'Trasporti', budget: '€500–€5k', description: 'Alilauro, SNAV, Laziomar, NLG, Travelmar, Alicost: chi sale verso Capri o la Costiera è già un turista in giro. Il pass del Golfo si vende con il biglietto o con il QR a bordo, e la compagnia prende la commissione.', nextAction: 'Proposta unica ai traghetti del Top 20, con pass del Golfo, QR a bordo e vetrina con il loro marchio.' },
  { key: 'crociere-tre-citta-un-accordo', title: 'Crociere: tre città, un accordo', category: 'Crociere', budget: '€500–€5k', description: 'Una nave tocca Napoli, Civitavecchia (Roma) e Venezia: tre delle nostre guide in un solo accordo. Per chi scende senza escursione, percorsi a tempo con codici per la compagnia o venduti dalle agenzie portuali.', nextAction: 'Dossier per tre compagnie dalla scheda Navigazione del CRM (flag Napoli/Civitavecchia).' },
  { key: 'congressi-e-viaggi-d-affari', title: 'Congressi e viaggi d’affari', category: 'Eventi', budget: '€500–€5k', description: 'Gli organizzatori di congressi (PCO) danno la guida ai partecipanti stranieri: la sera libera dopo i lavori è il momento esatto in cui serve.', nextAction: 'Contattare cinque PCO con eventi internazionali nel prossimo semestre.' },
  { key: 'matrimoni-con-ospiti-stranieri', title: 'Matrimoni con ospiti stranieri', category: 'Eventi', budget: '€500–€5k', description: 'Il wedding planner include la guida nel welcome kit degli invitati che arrivano da fuori: sono giorni in città senza programma.', nextAction: 'Proposta a dieci wedding planner di Costiera e Roma.' },
  { key: 'scuole-di-lingua-e-universita', title: 'Scuole di lingua e università', category: 'Education', budget: '€500–€5k', description: 'Studenti Erasmus e corsi di lingua: guida della città con codici prepagati per l’accoglienza, o vendita a prezzo studenti tramite la scuola.', nextAction: 'Contattare tre scuole di italiano per stranieri e un ufficio relazioni internazionali.' },
  { key: 'ttg-e-bit-con-la-vetrina-pronta', title: 'TTG e BIT con la vetrina pronta', category: 'Fiere', budget: '€500–€5k', description: 'Prima della fiera si preparano le vetrine degli espositori con il punteggio più alto nella scheda Fiere; allo stand si mostra la loro, non una demo generica.', nextAction: 'Prendere i primi 30 espositori per punteggio e preparare le vetrine.' },
  { key: 'webinar-vendi-le-guide', title: 'Webinar «Vendi le guide»', category: 'Sales enablement', budget: '€500–€5k', description: 'Ogni mese 30 minuti online per albergatori e host: come funziona, quanto si guadagna, un partner che racconta. Si chiude con l’attivazione dal vivo.', nextAction: 'Fissare data, scaletta e lista inviti.' },
  { key: 'campagna-ai-revenue-manager', title: 'Campagna ai revenue manager', category: 'LinkedIn', budget: '€500–€5k', description: 'Messaggi e post per revenue e guest experience manager: la guida come ricavo extra per camera, con il numero del calcolatore nel primo messaggio.', nextAction: 'Lista di 100 revenue manager e sequenza di tre messaggi.' },
  { key: 'guide-turistiche-abilitate', title: 'Guide turistiche abilitate', category: 'Tour operator', budget: '€500–€5k', description: 'Le guide in carne e ossa propongono la guida digitale come «prima e dopo il tour»: non le sostituisce, prolunga il loro lavoro, e prendono la commissione.', nextAction: 'Proporre l’accordo a un’associazione di guide di Napoli.' },
  { key: 'catena-alberghiera-in-un-accordo', title: 'Catena alberghiera in un accordo', category: 'Enterprise', budget: '€5k+', description: 'Una catena attiva tutte le strutture insieme: vetrina con il suo marchio, QR per ogni hotel, report per struttura e un referente unico.', nextAction: 'Scegliere tre catene presenti nelle città pronte e preparare il caso.' },
  { key: 'guida-nella-conferma-del-volo', title: 'Guida nella conferma del volo', category: 'Trasporti', budget: '€5k+', description: 'Compagnia aerea o aeroporto inviano il link alla guida della destinazione nella conferma o nell’app prima dell’atterraggio, nella lingua del passeggero.', nextAction: 'Demo su una rotta e proposta di revenue share.' },
  { key: 'marketplace-di-esperienze', title: 'Marketplace di esperienze', category: 'Canali', budget: '€5k+', description: 'La guida come prodotto su Civitatis, GetYourGuide o Viator: chi cerca un tour trova anche l’alternativa da fare in autonomia.', nextAction: 'Verificare condizioni d’ingresso e commissioni di due marketplace.' },
  { key: 'guest-app-e-pms', title: 'Guest app e PMS', category: 'Integrazioni', budget: '€5k+', description: 'Il link della vetrina nei messaggi automatici di PMS e guest app (check-in online, manuali digitali): ogni struttura che li usa diventa partner senza stampare niente.', nextAction: 'Scegliere la guest app più diffusa fra i partner e scrivere la proposta di integrazione.' },
  { key: 'edizione-firmata-da-un-media-di-viaggio', title: 'Edizione firmata da un media di viaggio', category: 'Co-marketing', budget: '€5k+', description: 'Un blog o una rivista di viaggio firma un’edizione della guida e la vende al suo pubblico con il suo link partner.', nextAction: 'Selezionare cinque media fra i «Blog e media di viaggio» del CRM.' },
  { key: 'associazioni-di-albergatori', title: 'Associazioni di albergatori', category: 'Partnership', budget: 'Partnership', description: 'Accordo con l’associazione locale degli albergatori: condizioni dedicate per gli associati, presentazione in assemblea, kit pronto per tutti.', nextAction: 'Preparare l’offerta associativa e chiedere un incontro a quella di Napoli.' },
  { key: 'card-turistiche-della-citta', title: 'Card turistiche della città', category: 'Partnership', budget: 'Partnership', description: 'La guida in bundle con la card musei e trasporti della città: chi compra la card riceve la guida per usarla bene.', nextAction: 'Proposta all’ente che gestisce la card della prima città.' },
  { key: 'enti-del-turismo-che-aprono-le-porte', title: 'Enti del turismo che aprono le porte', category: 'Enti e DMO', budget: 'Partnership', description: 'La DMO che ha già la sua mappa Speaqi presenta la guida agli operatori del territorio e alle loro associazioni: è lei a fare da porta.', nextAction: 'Chiedere alle prime DMO attive un elenco di operatori da presentare.' },
  { key: 'pass-territorio-per-un-consorzio', title: 'Pass territorio per un consorzio', category: 'Partnership', budget: 'Partnership', description: 'Un consorzio turistico (Costiera, isole) compra codici del pass territorio e li distribuisce ai suoi operatori, che li rivendono o li regalano.', nextAction: 'Individuare due consorzi e preparare la proposta a lotto.' },
  { key: 'itinerario-per-itinerario-il-pacchetto-giusto', title: 'Itinerario per itinerario: il pacchetto giusto', category: 'Crociere', budget: '< €500', description: 'La scheda Navigazione ha già gli itinerari con le tappe. Per ogni itinerario che tocca Napoli, Civitavecchia, Venezia, La Spezia o Livorno si prepara una proposta di una pagina: quali guide servono a chi scende a terra (Napoli, Roma, Venezia, Firenze) e con quale pass. La compagnia vede la sua rotta, non un catalogo.', nextAction: 'Scegliere cinque itinerari e preparare la pagina di ciascuno dalla scheda della compagnia.' },
  { key: 'cinque-referenti-di-costa-due-da-scegliere', title: 'Cinque referenti di Costa, due da scegliere', category: 'Crociere', budget: '< €500', description: 'Tourism Intelligence ha già cinque persone di Costa Crociere con le email non rivelate. Ogni rivelazione costa un record su LeadOcean: se ne scelgono due (esperienza ospite ed escursioni a terra) e si scrive a quelle, con la proposta dell’itinerario già pronta.', nextAction: 'Aprire i cinque referenti, scegliere i due ruoli giusti e rivelare solo quelle email.' },
  { key: 'chi-si-imbarca-resta-uno-o-due-giorni', title: 'Chi si imbarca resta uno o due giorni', category: 'Crociere', budget: '< €500', description: 'Venezia e Civitavecchia (Roma) sono porti d’imbarco: molti arrivano il giorno prima e ripartono il giorno dopo. Per loro la guida della città vale più che per chi scende per sei ore. Il messaggio pre-crociera della compagnia o dell’agenzia la propone con la vetrina del partner.', nextAction: 'Scrivere il testo pre-imbarco in cinque lingue e proporlo a due agenzie che vendono crociere da Venezia e Roma.' },
  { key: 'il-terminal-crociere-come-punto-vendita', title: 'Il terminal crociere come punto vendita', category: 'Crociere', budget: '€500–€5k', description: 'Poster della mappa e QR nei terminal di Napoli, Civitavecchia e Venezia, con il gestore del terminal o l’Autorità portuale come partner: i passeggeri aspettano il bus o l’escursione e hanno il telefono in mano.', nextAction: 'Capire chi gestisce gli spazi di ciascun terminal e chiedere un incontro al primo.' },
  { key: 'agenti-marittimi-e-escursioni-a-terra', title: 'Agenti marittimi e escursioni a terra', category: 'Crociere', budget: '€500–€5k', description: 'Chi vende le escursioni a terra (agenzie incoming, agenti portuali) ha clienti che non hanno comprato l’escursione intera: la guida è l’alternativa economica, e l’agenzia incassa la commissione senza fare altro.', nextAction: 'Prendere le prime cinque agenzie della classifica DMC di Tourism Intelligence che servono Napoli e Civitavecchia.' },
  { key: 'guida-a-bordo-un-codice-per-cabina', title: 'Guida a bordo: un codice per cabina', category: 'Crociere', budget: '€5k+', description: 'La compagnia compra codici prepagati e li mette nel programma di bordo o nel messaggio pre-crociera: un codice per cabina (due dispositivi inclusi). Per la compagnia è un servizio in più; per noi un lotto pagato in anticipo e una guida aperta in tutti i porti toccati.', nextAction: 'Preparare un lotto di prova da 200 codici e la proposta da portare a una compagnia.' },
  { key: 'accordo-di-una-pagina', title: 'Accordo di una pagina', category: 'Partner', budget: '< €500', description: 'Le condizioni standard (20% sulle vendite attribuite, attribuzione 30 giorni dal QR e dalla vetrina, portale con i numeri) scritte in una pagina sola, da firmare nello stesso incontro. Meno attrito di una proposta lunga.', nextAction: 'Scrivere la pagina e caricarla come versione dell’accordo B2B.' },
  { key: 'onboarding-partner-in-7-giorni', title: 'Onboarding partner in 7 giorni', category: 'Partner', budget: '< €500', description: 'Un percorso uguale per tutti: giorno 0 vetrina e QR, giorno 1 materiali stampati, giorno 3 le tre frasi allo staff, giorno 7 prima verifica delle scansioni. Il partner che non vede niente nella prima settimana smette di crederci.', nextAction: 'Scrivere la checklist e provarla con i prossimi tre partner.' },
  { key: 'partner-fermo-richiamo-a-30-giorni', title: 'Partner fermo: richiamo a 30 giorni', category: 'Partner', budget: '< €500', description: 'Un partner senza scansioni dopo 30 giorni non è un partner perso: spesso il QR è in un posto sbagliato. Una chiamata, il cambio di posizione e un secondo mese di prova valgono più di un nuovo contatto.', nextAction: 'Elencare dal portale i partner senza scansioni e chiamarli.' },
  { key: 'classifica-e-bonus-del-trimestre', title: 'Classifica e bonus del trimestre', category: 'Partner', budget: '€500–€5k', description: 'Ogni trimestre una classifica dei partner per guide vendute e un bonus ai primi (extra commissione o poster firmato). Si basa sul registro delle vendite, non su stime.', nextAction: 'Decidere bonus e soglie e annunciarli all’inizio del trimestre.' },
  { key: 'kit-social-e-newsletter-per-il-partner', title: 'Kit social e newsletter per il partner', category: 'Partner', budget: '< €500', description: 'Tre post e un testo per newsletter già pronti, nelle lingue dei suoi ospiti, con la vetrina e il QR del partner. Chi ha un pubblico lo usa solo se non deve scrivere niente.', nextAction: 'Scrivere il kit una volta per città e metterlo nel portale.' },
  { key: 'una-porta-sola-per-partner', title: 'Una porta sola per partner', category: 'Decisione', budget: '< €500', description: 'Chi ha un banco o un ospite davanti passa dal programma B2B (QR, vetrina, 20%); chi ha solo un pubblico online passa da Referly. Un partner non deve avere tutte e due: le vendite si contano due volte e le commissioni rischiano di essere pagate due volte.', nextAction: 'Mettere la domanda «hai un punto fisico?» all’inizio dell’onboarding.' },
]

const SEED_KEYS = new Set(IDEA_SEEDS.map((seed) => seed.key))

export function isSeedKey(key: string) {
  return SEED_KEYS.has(key)
}

export function isIdeaStatus(value: unknown): value is IdeaStatus {
  return typeof value === 'string' && (IDEA_STATUSES as readonly string[]).includes(value)
}

export function isIdeaBudget(value: unknown): value is IdeaBudget {
  return typeof value === 'string' && (IDEA_BUDGETS as readonly string[]).includes(value)
}

// Categorie che portano direttamente a un accordo o a un lotto venduto.
const HIGH_IMPACT = new Set([
  'Prodotto', 'Prospecting', 'Partner', 'Prepagati', 'Tour operator', 'Agenzie', 'Enterprise', 'Procacciatori', 'Crociere', 'Estero',
])

/** ICE: impatto × confidenza × facilità, su scala 0-100 come nella vecchia war room. */
export function ideaScore(seed: Pick<IdeaSeed, 'category' | 'budget'>) {
  const impact = HIGH_IMPACT.has(seed.category) ? 9 : 7
  const confidence = seed.budget === '< €500' ? 8 : seed.budget === '€500–€5k' ? 7 : 6
  const ease = seed.budget === '< €500' ? 9 : seed.budget === '€500–€5k' ? 7 : seed.budget === 'Partnership' ? 5 : 4
  return Math.round((impact * confidence * ease) / 10)
}

export function mergeIdeas(rows: IdeaRow[]): Idea[] {
  const byKey = new Map(rows.map((row) => [row.idea_key, row]))
  const toIdea = (seed: IdeaSeed, row: IdeaRow | undefined, custom: boolean): Idea => ({
    ...seed,
    custom,
    status: isIdeaStatus(row?.status) ? row.status : seed.start ? 'Da validare' : 'Backlog',
    owner: row?.owner || '',
    deadline: row?.deadline || '',
    progress: Math.max(0, Math.min(100, Math.round(Number(row?.progress) || 0))),
    notes: row?.notes || '',
    score: ideaScore(seed),
  })

  const ideas = IDEA_SEEDS.map((seed) => toIdea(seed, byKey.get(seed.key), false))
  for (const row of rows) {
    if (SEED_KEYS.has(row.idea_key) || !row.title) continue
    ideas.push(
      toIdea(
        {
          key: row.idea_key,
          title: row.title,
          category: row.category || 'Altro',
          budget: isIdeaBudget(row.budget) ? row.budget : '< €500',
          description: row.description || '',
          nextAction: row.next_action || '',
        },
        row,
        true
      )
    )
  }
  return ideas
}

export type IdeaPatch = {
  status?: IdeaStatus
  owner?: string
  deadline?: string | null
  progress?: number
  notes?: string
}

/** AAAA-MM-GG che esiste davvero: `Date.parse` sposta il 31 febbraio a marzo, qui no. */
function isRealDate(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const date = new Date(`${raw}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw
}

/** Valida le modifiche allo stato di un'idea. Un campo assente non si tocca. */
export function normalizeIdeaPatch(body: Record<string, unknown>): { patch: IdeaPatch } | { error: string } {
  const patch: IdeaPatch = {}
  if (body.status !== undefined) {
    if (!isIdeaStatus(body.status)) return { error: 'Stato non valido' }
    patch.status = body.status
  }
  if (body.owner !== undefined) {
    const owner = String(body.owner ?? '').trim()
    if (owner.length > 80) return { error: 'Il nome del responsabile è troppo lungo' }
    patch.owner = owner
  }
  if (body.deadline !== undefined) {
    const raw = String(body.deadline ?? '').trim()
    if (raw === '') patch.deadline = null
    else if (isRealDate(raw)) patch.deadline = raw
    else return { error: 'Scadenza non valida' }
  }
  if (body.progress !== undefined) {
    const progress = Number(body.progress)
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) return { error: 'Avanzamento non valido' }
    patch.progress = Math.round(progress)
  }
  if (body.notes !== undefined) {
    const notes = String(body.notes ?? '')
    if (notes.length > 4000) return { error: 'Le note sono troppo lunghe' }
    patch.notes = notes
  }
  // Chiusa vuol dire chiusa: la barra non resta a metà.
  if (patch.status === 'Completata' && patch.progress === undefined) patch.progress = 100
  return { patch }
}

export type NewIdeaInput = {
  title: string
  category: string
  budget: IdeaBudget
  description: string
  nextAction: string
}

export function normalizeNewIdea(body: Record<string, unknown>): { idea: NewIdeaInput } | { error: string } {
  const title = String(body.title ?? '').trim()
  if (!title) return { error: 'Scrivi un titolo' }
  if (title.length > 120) return { error: 'Il titolo è troppo lungo' }
  const budget = body.budget === undefined || body.budget === '' ? '< €500' : body.budget
  if (!isIdeaBudget(budget)) return { error: 'Budget non valido' }
  const category = String(body.category ?? '').trim().slice(0, 40) || 'Altro'
  const description = String(body.description ?? '').trim().slice(0, 1500)
  const nextAction = String(body.nextAction ?? '').trim().slice(0, 500)
  return { idea: { title, category, budget, description, nextAction } }
}
