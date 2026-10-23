// Presentazione per destinazione (Tourism Intelligence): modello, segnaposto e guardie.
import { normalizeQuoteTemplate, type QuoteTemplate } from './commercial-proposal'
// Puro, senza accesso a rete o database: lo usano l'agente, le API, la pagina e i test.

export const DECK_TODO = '[DA VERIFICARE]'
/** Ogni segnaposto da completare, anche con la nota ("[DA VERIFICARE per questo ente]"). */
export const DECK_TODO_PATTERN = /\[DA VERIFICARE[^\]]{0,80}\]/g

export const DECK_SLIDE_KINDS = ['cover', 'statement', 'cards', 'steps', 'closing'] as const
export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number]

export const DECK_STATUSES = ['draft', 'generating', 'ready', 'approved', 'failed'] as const
export type DeckStatus = (typeof DECK_STATUSES)[number]

/**
 * Due basi di partenza, due modi di fare partnership:
 * - `destination`: la destinazione (ente del turismo, DMO/DMC, Comune, consorzio) distribuisce le guide e noi le facciamo;
 * - `distribution`: chi porta i visitatori (compagnia di navigazione, tour operator, aeroporto, operatore di trasporto,
 *   rete di vendita) distribuisce il prodotto ai propri clienti, in revenue sharing.
 */
export const DECK_KINDS = ['destination', 'distribution'] as const
export type DeckKind = (typeof DECK_KINDS)[number]
export const DEFAULT_DECK_KIND: DeckKind = 'destination'
export const DECK_KIND_LABELS: Record<DeckKind, string> = {
  destination: 'Partnership destinazioni',
  distribution: 'Partnership distribuzione'
}
export const DECK_KIND_HINTS: Record<DeckKind, string> = {
  destination: 'Per enti del turismo, DMO/DMC, Comuni, consorzi: la mappa è gratuita e loro distribuiscono le guide.',
  distribution: 'Per compagnie di navigazione, tour operator, aeroporti, operatori di trasporto, reti di vendita: noi il prodotto, loro la distribuzione, revenue sharing e pilota di 90 giorni.'
}
export const isDeckKind = (value: unknown): value is DeckKind => typeof value === 'string' && (DECK_KINDS as readonly string[]).includes(value)

export type DeckItem = { title: string; text: string }
export type DeckSlide = {
  id: string
  kind: DeckSlideKind
  title: string
  body: string
  items: DeckItem[]
  /** Riga in fondo alla slide (es. il prezzo). */
  note: string
  /** Foto scelta fra quelle caricate per questo deck; mai un indirizzo esterno. */
  image_asset_id: string | null
  /** Istruzione per l'agente: cosa si personalizza in questa slide. Non si mostra al cliente. */
  hint: string
}
export type DeckTemplate = {
  version: 1
  /** Valori di partenza dei segnaposto {{nome}}. */
  vars: Record<string, string>
  slides: DeckSlide[]
  quote_template?: QuoteTemplate
}

export const DECK_VAR_NAMES = ['destinazione', 'ente', 'paese', 'prezzo', 'contatto'] as const
export type DeckVarName = (typeof DECK_VAR_NAMES)[number]
export type DeckInput = Partial<Record<DeckVarName, string>>

/** Massimo di slide di un modello o di una presentazione (la base destinazioni ne usa 13). */
export const DECK_MAX_SLIDES = 14
const LIMITS = { slides: DECK_MAX_SLIDES, items: 6, title: 160, body: 700, note: 300, itemTitle: 80, itemText: 260, hint: 500, varValue: 300 }

const slide = (s: Partial<DeckSlide> & Pick<DeckSlide, 'id' | 'kind' | 'title'>): DeckSlide => ({
  body: '',
  items: [],
  note: '',
  image_asset_id: null,
  hint: '',
  ...s
})

/**
 * Proposta base per le destinazioni ("Speaqi — Proposta destinazioni", ottobre 2026,
 * allineata alla pagina guides.speaqi.com/destinations): la mappa è gratuita per l'ente,
 * che in cambio distribuisce le guide sui canali concordati. Tredici slide: apertura,
 * territorio, problema, risposta, prova, contenuti, visitatore, modello, requisiti,
 * come funziona, cosa è incluso, servizi opzionali, demo.
 * Nessuna funzione, soglia o condizione che non stia lì: il resto è [DA VERIFICARE].
 */
export const DESTINATION_DECK_TEMPLATE: DeckTemplate = {
  version: 1,
  vars: {
    prezzo:
      'distribuite le guide Speaqi sui canali concordati: almeno 2 canali di distribuzione attivi, un referente dedicato e un piano continuativo. Durata e perimetro della gratuità sono definiti nell’accordo.',
    contatto: DECK_TODO
  },
  slides: [
    slide({
      id: 'cover',
      kind: 'cover',
      title: 'La mappa perfetta per {{ente}}',
      body: 'Costruita da Speaqi. Distribuita insieme a voi, fino a 50 lingue.',
      hint: 'Il titolo porta il nome dell’ente. Come foto scegli una schermata della mappa o la foto più rappresentativa della destinazione, se ce n’è una.'
    }),
    slide({
      id: 'territorio',
      kind: 'cards',
      title: 'Tutto {{destinazione}} in una mappa sola',
      items: [
        { title: 'Luoghi da vedere', text: '[DA VERIFICARE: quanti] luoghi, dai monumenti ai panorami.' },
        { title: 'Itinerari', text: '[DA VERIFICARE: quanti] itinerari, a piedi, a tema, di mezza giornata o più giorni.' },
        { title: 'Strutture e servizi', text: '[DA VERIFICARE: quanti] fra dove dormire, dove mangiare e servizi utili.' }
      ],
      hint: 'Metti i tre numeri del territorio solo se stanno nei materiali o nei luoghi approvati. Se un numero non è noto, sostituisci il segnaposto con una frase qualitativa sulla destinazione, senza cifre.'
    }),
    slide({
      id: 'problema',
      kind: 'statement',
      title: 'Oggi il visitatore scopre {{destinazione}} a pezzi.',
      body: 'Google Maps, Tripadvisor, Instagram, TikTok, brochure, blog e il sito dell’ente: sette fonti diverse, in lingue diverse, con informazioni che non si parlano. Nessuna parla per voi.',
      hint: 'Puoi adattare l’elenco delle fonti a quelle che i materiali citano per questa destinazione. Chiudi sempre con «Nessuna parla per voi».'
    }),
    slide({
      id: 'soluzione',
      kind: 'statement',
      title: 'Una mappa. Tutto il territorio. Ogni lingua.',
      body: 'Speaqi crea la guida digitale ufficiale di {{destinazione}}: la voce della destinazione, nella lingua di chi la visita, fino a 50 lingue. Si apre da un link o da un QR Code, senza app.',
      hint: 'Mantieni il titolo. Se i materiali dicono da quali paesi arrivano i visitatori, puoi citare le lingue di quei mercati nel corpo. Non promettere quante lingue sono incluse: si definisce nell’accordo.'
    }),
    slide({
      id: 'prova',
      kind: 'cards',
      title: 'Prima del resto, provate una mappa vera',
      body: 'Aprite il link o scansionate il QR. È gratis, senza app.',
      items: [
        { title: 'Napoli', text: 'guides.speaqi.com/napoli' },
        { title: 'Roma', text: 'guides.speaqi.com/roma' },
        { title: 'E altre', text: 'guides.speaqi.com' }
      ],
      hint: 'Lascia le mappe reali di Speaqi così come sono: sono la prova. Non inventare altri link.'
    }),
    slide({
      id: 'contenuti',
      kind: 'cards',
      title: 'Tutto quello che il visitatore cerca, in un posto solo',
      items: [
        { title: 'Luoghi da vedere', text: 'Monumenti, musei, piazze, panorami.' },
        { title: 'Itinerari', text: 'A piedi, a tema, di mezza giornata o più giorni.' },
        { title: 'Esperienze', text: 'Cultura, natura, eventi, enogastronomia.' },
        { title: 'Dove dormire', text: 'Hotel, B&B, agriturismi.' },
        { title: 'Dove mangiare', text: 'Ristoranti, trattorie, prodotti tipici.' },
        { title: 'Servizi utili', text: 'Infopoint, trasporti, parcheggi.' }
      ],
      note: 'Ogni luogo ha la sua audio guida e può avere un video girato sul posto.',
      hint: 'Mantieni le sei categorie. Negli esempi puoi citare luoghi o esperienze di questa destinazione solo se compaiono nei materiali.'
    }),
    slide({
      id: 'visitatore',
      kind: 'steps',
      title: 'Dal QR alla visita, in quattro passi',
      items: [
        { title: 'Scansiona', text: 'Un QR Code o un link. Nessuna app da scaricare.' },
        { title: 'È già nella sua lingua', text: 'La mappa si apre nella lingua del telefono. Nessuna scelta da fare.' },
        { title: 'Esplora', text: '«Sono qui» mostra cosa c’è intorno, a due passi.' },
        { title: 'Ascolta e legge', text: 'Audio, video e testo su ogni luogo, nella sua lingua.' }
      ],
      hint: 'Mantieni i quattro passi così come sono.'
    }),
    slide({
      id: 'modello',
      kind: 'cards',
      title: 'Noi la mappa. Voi la distribuzione.',
      items: [
        { title: 'Speaqi', text: 'Realizza la mappa multilingue, cura gli aggiornamenti nel perimetro concordato e affianca il progetto nel tempo.' },
        { title: '{{ente}}', text: 'Distribuisce le guide sui canali concordati, coinvolge la rete locale e indica un referente.' }
      ],
      note: 'Durata, perimetro e continuità della gratuità sono definiti nell’accordo.',
      hint: 'Mantieni le due colonne. Non aggiungere impegni che non stanno nel modello: responsabilità e frequenza degli aggiornamenti si concordano prima dell’avvio.'
    }),
    slide({
      id: 'requisiti',
      kind: 'cards',
      title: 'Cosa serve per candidarsi',
      items: [
        { title: 'Presenze turistiche', text: 'Almeno 250.000 l’anno, documentabili con dati sui pernottamenti.' },
        { title: 'Un soggetto rappresentativo', text: 'Ente del turismo, DMO o DMC, Comune, consorzio o rete territoriale.' },
        { title: 'Canali di distribuzione', text: 'Almeno 2 canali attivi.' },
        { title: 'Un referente', text: 'Almeno 1 persona dedicata al progetto.' },
        { title: 'Un piano continuativo', text: 'Distribuzione nel tempo, non una tantum.' }
      ],
      note: 'La candidatura non garantisce l’ammissione.',
      hint: 'Mantieni le cinque soglie. Se i materiali citano le presenze della destinazione, puoi aggiungere il dato (con anno e fonte) nella prima voce, senza togliere la soglia. Se una soglia non risulta rispettata, scrivi [DA VERIFICARE: …] invece di nasconderlo.'
    }),
    slide({
      id: 'metodo',
      kind: 'steps',
      title: 'Dalla candidatura alla mappa online, in tre passi',
      items: [
        { title: 'Candidatura', text: 'Presentate territorio, canali e piano di distribuzione. Senza pagamenti né obblighi.' },
        { title: 'Accordo', text: 'Valutiamo la proposta e definiamo distribuzione, contenuti, aggiornamenti, durata e perimetro gratuito. L’attivazione avviene solo dopo l’accordo.' },
        { title: 'Pubblicazione', text: 'Voi attivate i canali, noi realizziamo la mappa, la facciamo approvare a voi e la seguiamo nel tempo.' }
      ],
      hint: 'Non promettere tempi di consegna. Non parlare di white label.'
    }),
    slide({
      id: 'prezzo',
      kind: 'cards',
      title: 'La mappa è gratuita.',
      items: [
        { title: 'Luoghi, percorsi, punti di interesse', text: 'Una mappa digitale di tutto il territorio.' },
        { title: 'Più lingue, una sola guida', text: 'Contenuti accessibili in più lingue, senza guide separate.' },
        { title: 'Aggiornamenti concordati', text: 'Cosa si aggiorna e ogni quanto lo decidiamo insieme.' },
        { title: 'Condivisa da tutti', text: 'Infopoint, strutture e operatori usano la stessa mappa.' },
        { title: 'Link o QR, senza app', text: 'Accesso da browser, su qualsiasi telefono.' },
        { title: 'QR Code pronti', text: 'Per i luoghi, le mappe e i materiali.' }
      ],
      note: 'In cambio: {{prezzo}}',
      hint: 'Non cambiare le condizioni nella nota: usa solo quelle indicate dall’utente. Non aggiungere funzioni o quantità non confermate. Nessun importo in euro.'
    }),
    slide({
      id: 'opzionali',
      kind: 'cards',
      title: 'Per andare oltre, quando vorrete',
      items: [
        { title: 'iConcierge', text: 'Un assistente AI basato sui contenuti della destinazione.' },
        { title: 'Eventi', text: 'Contenuti dedicati a festival e appuntamenti locali.' },
        { title: 'Contenuti multilingue', text: 'Produzioni editoriali, audio e video.' }
      ],
      note: 'Servizi non obbligatori, su proposta economica separata.',
      hint: 'Mantieni le tre voci. Nessun prezzo e nessuna promessa su tempi o volumi.'
    }),
    slide({
      id: 'demo',
      kind: 'closing',
      title: 'Guardate la mappa di {{ente}}',
      body: 'Provate la demo, presentate la candidatura e definiamo insieme canali, perimetro e durata. {{contatto}}',
      hint: 'Chiusura breve. Non inventare link della demo o contatti: usa solo quelli indicati.'
    })
  ]
}

/** Compatibilità: il modello di partenza storico è quello delle destinazioni. */
export const DEFAULT_DECK_TEMPLATE = DESTINATION_DECK_TEMPLATE

/**
 * Proposta base di distribuzione ("Speaqi — Partnership", dalla presentazione per Aeroporti
 * di Roma, ottobre 2026): per chi porta i visitatori alla guida e non la riceve per il
 * proprio territorio. Compagnie di navigazione, tour operator, aeroporti, operatori di
 * trasporto, reti di vendita. Noi il prodotto, loro la distribuzione; revenue sharing a
 * scaglioni e un pilota di 90 giorni. Dodici slide.
 * Percentuali, soglie e durata del pilota sono quelle della proposta di riferimento: restano
 * indicative e da concordare. Numeri del partner e contatto: sempre [DA VERIFICARE].
 */
export const DISTRIBUTION_DECK_TEMPLATE: DeckTemplate = {
  version: 1,
  vars: {
    prezzo:
      'Revenue sharing con commissioni progressive sul fatturato netto effettivamente generato, a zero investimento iniziale. Scaglioni indicativi, da concordare.',
    contatto: DECK_TODO
  },
  slides: [
    slide({
      id: 'cover',
      kind: 'cover',
      title: '{{destinazione}}, nella lingua di ogni viaggiatore.',
      body: 'Un servizio in più per i clienti di {{ente}}. Un ricavo in più per {{ente}}.',
      hint: 'Il titolo porta la destinazione (o le destinazioni) dei clienti del partner. Se il partner chiama i clienti «passeggeri», «ospiti» o «turisti», usa la sua parola al posto di «viaggiatore». Come foto scegli un’immagine rappresentativa della destinazione o del partner, se ce n’è una. Nessuna promessa di ricavo con cifre.'
    }),
    slide({
      id: 'opportunita',
      kind: 'statement',
      title: 'Milioni di viaggiatori. Una nuova opportunità.',
      body: 'Ogni anno passano da {{ente}}: [DA VERIFICARE: numero, anno e fonte]. Ognuno arriva in una destinazione che non conosce e ha bisogno di una guida nella sua lingua.',
      hint: 'Sostituisci il segnaposto con il dato del partner (passeggeri, ospiti, prenotazioni) solo se sta nei materiali o nella scheda dell’ente, con anno e fonte. Se non c’è, scrivi una frase qualitativa senza cifre. Mai stime tue.'
    }),
    slide({
      id: 'prodotto',
      kind: 'cards',
      title: 'La guida digitale che accompagna il viaggio.',
      items: [
        { title: 'Luoghi scelti', text: 'Non risultati di ricerca: i luoghi da vedere, scelti da noi.' },
        { title: 'Racconti e itinerari', text: 'Audio, video e testo, luogo per luogo.' },
        { title: 'AI Concierge', text: 'Risponde nella lingua del viaggiatore, solo con contenuti approvati.' },
        { title: 'Nessuna app', text: 'Si apre nel browser, da un link o da un QR Code.' }
      ],
      note: 'Le mappe gratuite dicono dove andare. Speaqi aiuta a vivere {{destinazione}}.',
      hint: 'Mantieni le quattro voci. Nessuna funzione in più.'
    }),
    slide({
      id: 'lingue',
      kind: 'statement',
      title: 'Un’esperienza che parla oltre 50 lingue.',
      body: 'Italiano, inglese, spagnolo, francese, tedesco, portoghese, russo, giapponese, cinese, coreano, arabo, hindi, turco, olandese, polacco e molte altre. L’AI Concierge risponde nella lingua del viaggiatore, solo con contenuti approvati.',
      hint: 'Se i materiali dicono da quali paesi arrivano i clienti del partner, metti per prime le lingue di quei mercati. Non promettere quante lingue sono incluse.'
    }),
    slide({
      id: 'prova',
      kind: 'cards',
      title: 'Prima di tutto, provate una guida vera',
      body: 'Aprite il link o scansionate il QR. Si apre nel browser, senza app. Cambiate lingua e guardate la stessa scheda parlare altre lingue.',
      items: [
        { title: 'Roma', text: 'guides.speaqi.com/roma' },
        { title: 'Napoli', text: 'guides.speaqi.com/napoli' },
        { title: 'Tutte le guide', text: 'guides.speaqi.com' }
      ],
      hint: 'Lascia le guide reali di Speaqi così come sono: sono la prova. Non inventare altri link. Se la guida della destinazione del partner esiste già, puoi aggiungerla solo se il suo link sta nei materiali.'
    }),
    slide({
      id: 'partnership',
      kind: 'cards',
      title: 'Noi il prodotto. Voi la distribuzione.',
      items: [
        { title: 'Speaqi', text: 'Costruisce la guida, la alimenta e la aggiorna, gestisce assistenza e tecnologia.' },
        { title: '{{ente}}', text: 'Pagine e servizi digitali, comunicazioni ai clienti, QR nei punti di contatto.' }
      ],
      note: 'Speaqi Guide · {{destinazione}} in partnership con {{ente}}',
      hint: 'Adatta i canali del partner al suo settore (navigazione: app e programma di bordo, email prima dell’imbarco, kit in cabina; tour operator: voucher, conferma di prenotazione, sito e app; aeroporto: pagine web, QR nei terminal), solo come proposta: non affermare che il partner li abbia o li usi.'
    }),
    slide({
      id: 'distribuzione',
      kind: 'cards',
      title: 'Dove il viaggiatore incontra la guida.',
      items: [
        { title: 'Affissioni e schermi', text: 'Un QR Code nei punti di passaggio del viaggio.' },
        { title: 'Totem con QR', text: 'Nei punti di contatto fisici, tracciabili.' },
        { title: 'Sito, app e Wi-Fi', text: 'Un link nei canali digitali di {{ente}}.' },
        { title: 'Email ai clienti', text: 'Prima della partenza e dopo, con il link alla guida.' }
      ],
      note: 'Esempi di canali: idee da concordare, non materiali approvati da {{ente}}.',
      hint: 'Mantieni quattro voci e adattale ai canali tipici del settore del partner (vedi slide precedente). Sono sempre proposte da concordare, mai canali già attivi. Se usi immagini generate con AI, dillo in nota.'
    }),
    slide({
      id: 'esperienze',
      kind: 'cards',
      title: 'La nostra mappa, con le vostre esperienze dentro.',
      items: [
        { title: 'I vostri servizi', text: 'Accanto ai luoghi di {{destinazione}}.' },
        { title: 'Le vostre offerte', text: 'Nella lingua del viaggiatore.' },
        { title: 'Le vostre esperienze', text: 'Un canale in più per vendere.' }
      ],
      note: 'Esempio illustrativo: contenuti ed esperienze da scegliere con {{ente}}.',
      hint: 'Adatta «servizi, offerte, esperienze» a ciò che il partner vende (escursioni, transfer, biglietti, pacchetti) solo se sta nei materiali; altrimenti lascia le tre voci generiche.'
    }),
    slide({
      id: 'oltre',
      kind: 'cards',
      title: 'Si parte da {{destinazione}}, poi le mete dei vostri clienti.',
      items: [
        { title: 'Pronte', text: 'Roma, Napoli, Capri, Pompei, Lisbona, Costiera Amalfitana.' },
        { title: 'In produzione', text: 'Firenze, Milano, Venezia.' },
        { title: 'Poi', text: 'Le destinazioni estere dei vostri clienti.' }
      ],
      hint: 'Non aggiungere guide che non esistono. Se i materiali citano le mete principali dei clienti del partner, puoi nominarle nella voce «Poi».'
    }),
    slide({
      id: 'modello',
      kind: 'cards',
      title: 'Più vendite. Più valore per entrambi.',
      body: '{{prezzo}}',
      items: [
        { title: '20%', text: 'Fino a 100.000 € di fatturato netto l’anno.' },
        { title: '35%', text: 'Da 100.000 a 500.000 €.' },
        { title: '50%', text: 'Oltre 500.000 €.' }
      ],
      note: 'Commissioni progressive per scaglioni, sulle sole vendite attribuibili a {{ente}}. Soglie annuali indicative, da concordare.',
      hint: 'Non cambiare percentuali né soglie, salvo che l’utente indichi condizioni diverse: in quel caso adatta anche le tre fasce e scrivi [DA VERIFICARE] se non sono chiare. Nessuna previsione di ricavi.'
    }),
    slide({
      id: 'pilota',
      kind: 'steps',
      title: '90 giorni per dimostrare il potenziale di Speaqi.',
      body: 'Speaqi porta tecnologia, guide e vendite. {{ente}}: almeno un canale digitale e un punto di contatto fisico, tracciabili.',
      items: [
        { title: '30 giorni', text: 'Prima verifica.' },
        { title: '60 giorni', text: 'Ottimizzazione.' },
        { title: '90 giorni', text: 'Valutazione ed estensione.' }
      ],
      note: 'Misuriamo viaggiatori, accessi, acquisti e ricavi condivisi. Si parte a canali operativi.',
      hint: 'Mantieni 30, 60 e 90 giorni. Le metriche sono quattro: viaggiatori raggiunti, accessi alla guida, conversioni in acquisti, fatturato e ricavi condivisi; nella nota restano in forma breve (una riga). Non promettere risultati né date di avvio.'
    }),
    slide({
      id: 'chiusura',
      kind: 'closing',
      title: 'Partiamo da {{destinazione}}.',
      body: 'Provate la guida su guides.speaqi.com, poi definiamo insieme canali e scaglioni del pilota. {{contatto}}',
      hint: 'Chiusura breve. Solo il contatto reale indicato dall’utente; nessun link nuovo.'
    })
  ]
}

/** Le basi di partenza, una per tipo di presentazione. */
export const DECK_BASE_TEMPLATES: Record<DeckKind, DeckTemplate> = {
  destination: DESTINATION_DECK_TEMPLATE,
  distribution: DISTRIBUTION_DECK_TEMPLATE
}
export const baseTemplateFor = (kind: DeckKind): DeckTemplate => structuredClone(DECK_BASE_TEMPLATES[kind])

/** Base Tourism per aziende: stessi strumenti, senza impegni di partnership impliciti. */
export const TOURISM_COMPANY_TEMPLATE: DeckTemplate = {
  version: 1,
  vars: { contatto: DECK_TODO, prezzo: 'Importi, durata, eventuali servizi e condizioni sono indicati nel preventivo e nel contratto collegati.' },
  slides: [
    slide({ id: 'cover', kind: 'cover', title: '{{ente}}, nella lingua di chi vi sceglie', body: 'Una proposta Speaqi Tourism per {{destinazione}}.', hint: 'Personalizza la promessa sul destinatario e sul suo pubblico. Non promettere risultati numerici.' }),
    slide({ id: 'contesto', kind: 'statement', title: 'Partiamo dall’esperienza dei vostri ospiti', body: '[DA VERIFICARE] Il bisogno emerso dal brief: informazioni, accoglienza, scoperta del territorio o assistenza ai visitatori.', hint: 'Usa il bisogno specifico del cliente e la sua fonte; evita affermazioni negative non verificate sul sito o sul servizio attuale.' }),
    slide({ id: 'obiettivo', kind: 'cards', title: 'Le informazioni giuste, prima e durante la visita', items: [
      { title: 'Prima dell’arrivo', text: 'Presentare l’offerta e aiutare il visitatore a orientarsi.' },
      { title: 'Durante l’esperienza', text: 'Rendere accessibili contenuti e indicazioni nella sua lingua.' },
      { title: 'Per il vostro team', text: 'Aggiornare le informazioni da una base condivisa.' }
    ], hint: 'Adatta i benefici all’attività e al pubblico citati nei materiali. Nessuna previsione economica senza dati.' }),
    slide({ id: 'soluzione', kind: 'statement', title: 'Una base di conoscenza. Più punti di contatto.', body: 'Le informazioni approvate di {{ente}} alimentano pagine web, QR dinamici, testi, audio multilingua e AI Concierge.', hint: 'Spiega il caso d’uso concreto; non aggiungere integrazioni, prenotazioni o funzionalità non confermate.' }),
    slide({ id: 'esperienza', kind: 'steps', title: 'Dal primo accesso alle risposte utili', items: [
      { title: 'Accede', text: 'Da un link o da un QR Code, senza scaricare un’app.' },
      { title: 'Scopre', text: 'Consulta le informazioni del progetto in più lingue.' },
      { title: 'Ascolta', text: 'Usa i contenuti audio multilingua.' },
      { title: 'Chiede', text: 'L’AI Concierge risponde sulla conoscenza approvata.' }
    ], hint: 'Personalizza i punti di accesso su quelli concordati per il cliente.' }),
    slide({ id: 'perimetro', kind: 'cards', title: 'Cosa attiviamo per il vostro progetto', items: [
      { title: 'Contenuti', text: '[DA VERIFICARE] Materiali iniziali, argomenti e responsabilità editoriali.' },
      { title: 'Lingue e audio', text: '[DA VERIFICARE] Lingue iniziali in base al pubblico e ai materiali.' },
      { title: 'Distribuzione', text: '[DA VERIFICARE] Link, QR e canali effettivamente concordati.' }
    ], note: 'Tutta la piattaforma è inclusa nel piano per progetto. La produzione video AI è separata, in minuti.', hint: 'Non inventare quantità, lingue, impegni di accessi o deliverable. Usa solo il perimetro concordato.' }),
    slide({ id: 'prova', kind: 'cards', title: 'Provate un’esperienza Speaqi reale', body: 'Esempi del prodotto, da esplorare prima di definire il vostro progetto.', items: [
      { title: 'Napoli', text: 'guides.speaqi.com/napoli' }, { title: 'Roma', text: 'guides.speaqi.com/roma' }
    ], hint: 'Sono demo del prodotto, non casi studio o risultati commerciali del settore del destinatario.' }),
    slide({ id: 'metodo', kind: 'steps', title: 'Prepariamo il progetto e lo provate quando è pronto', items: [
      { title: 'Costruzione', text: 'Raccogliamo e organizziamo i contenuti del progetto.' },
      { title: 'Validazione', text: 'Speaqi verifica il progetto prima dell’attivazione pubblica.' },
      { title: 'Prova', text: 'Trial pubblico di 30 giorni, attivato manualmente dopo la validazione.' },
      { title: 'Attivazione', text: 'Confermiamo l’abbonamento o l’accordo commerciale del progetto.' }
    ], hint: 'La durata del trial viene dal modello commerciale Speaqi. Non promettere tempi di produzione.' }),
    slide({ id: 'responsabilita', kind: 'cards', title: 'Un referente e un percorso condiviso', items: [
      { title: 'Il vostro team', text: 'Fornisce i materiali e approva i contenuti prima della pubblicazione.' },
      { title: 'Speaqi', text: '[DA VERIFICARE] Servizi operativi, consegne e assistenza compresi nell’offerta.' },
      { title: 'Verifica', text: '[DA VERIFICARE] Referenti, tempi e criteri di approvazione concordati.' }
    ], hint: 'Non dedurre assistenza gestita, aggiornamenti editoriali o SLA dal solo abbonamento.' }),
    slide({ id: 'condizioni', kind: 'statement', title: 'Perimetro e condizioni, definiti prima di partire', body: '{{prezzo}}', note: 'Un progetto ha il proprio accordo e il proprio ciclo di vita.', hint: 'Usa il preventivo per i prezzi. Non applicare automaticamente gratuità, soglie di accessi o condizioni delle partnership destinazioni.' }),
    slide({ id: 'prossimi-passi', kind: 'steps', title: 'Confermiamo il progetto più utile per voi', items: [
      { title: 'Allineamento', text: 'Rivediamo obiettivi, perimetro e materiali.' },
      { title: 'Proposta', text: 'Confermiamo preventivo e contratto del progetto.' },
      { title: 'Avvio', text: 'Concordiamo il primo passaggio operativo.' }
    ], hint: 'Aggiungi una demo personalizzata solo se il suo link esiste nei materiali.' }),
    slide({ id: 'chiusura', kind: 'closing', title: 'Prepariamo il prossimo passo per {{ente}}', body: '{{contatto}}', hint: 'Solo il contatto reale inserito dall’utente.' })
  ]
}

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '')

const slugId = (value: unknown, fallback: string) => {
  const id = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return id || fallback
}

export function normalizeSlide(raw: unknown, index: number): DeckSlide {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = DECK_SLIDE_KINDS.includes(r.kind as DeckSlideKind) ? (r.kind as DeckSlideKind) : 'statement'
  const items = (Array.isArray(r.items) ? r.items : [])
    .slice(0, LIMITS.items)
    .map((item) => {
      const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return { title: clip(i.title, LIMITS.itemTitle), text: clip(i.text, LIMITS.itemText) }
    })
    .filter((item) => item.title || item.text)
  return {
    id: slugId(r.id, `slide-${index + 1}`),
    kind,
    title: clip(r.title, LIMITS.title),
    body: clip(r.body, LIMITS.body),
    items,
    note: clip(r.note, LIMITS.note),
    image_asset_id: typeof r.image_asset_id === 'string' && /^[0-9a-f-]{36}$/i.test(r.image_asset_id) ? r.image_asset_id : null,
    hint: clip(r.hint, LIMITS.hint)
  }
}

/** Legge un modello o un deck da JSON: scarta il superfluo, rende unici gli id, non lancia. */
export function normalizeTemplate(raw: unknown, kind: DeckKind = DEFAULT_DECK_KIND): DeckTemplate {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const seen = new Set<string>()
  const slides = (Array.isArray(r.slides) ? r.slides : []).slice(0, LIMITS.slides).map((s, i) => {
    const n = normalizeSlide(s, i)
    let id = n.id
    for (let k = 2; seen.has(id); k++) id = `${n.id}-${k}`
    seen.add(id)
    return { ...n, id }
  })
  const vars: Record<string, string> = {}
  if (r.vars && typeof r.vars === 'object') {
    for (const name of DECK_VAR_NAMES) {
      const value = clip((r.vars as Record<string, unknown>)[name], LIMITS.varValue)
      if (value) vars[name] = value
    }
  }
  if (!slides.length) return baseTemplateFor(kind)
  return { version: 1, vars, slides, quote_template: normalizeQuoteTemplate(r.quote_template, 'tourism') }
}

/** Valori dei segnaposto: input dell'utente, poi i valori di partenza del modello, poi [DA VERIFICARE]. */
export function resolveVars(template: DeckTemplate, input: DeckInput): Record<DeckVarName, string> {
  const out = {} as Record<DeckVarName, string>
  for (const name of DECK_VAR_NAMES) {
    out[name] = clip(input[name], LIMITS.varValue) || template.vars[name] || DECK_TODO
  }
  return out
}

export function fillPlaceholders(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, name: string) => vars[name.toLowerCase()] || DECK_TODO)
}

/** Il modello con i segnaposto riempiti: il punto di partenza dell'agente e il ripiego se l'agente non risponde. */
export function applyVars(template: DeckTemplate, input: DeckInput): DeckSlide[] {
  const vars = resolveVars(template, input)
  const fill = (s: string) => fillPlaceholders(s, vars)
  return template.slides.map((s) => ({
    ...s,
    title: fill(s.title),
    body: fill(s.body),
    note: fill(s.note),
    items: s.items.map((i) => ({ title: fill(i.title), text: fill(i.text) }))
  }))
}

const slideStrings = (s: DeckSlide) => [s.title, s.body, s.note, ...s.items.flatMap((i) => [i.title, i.text])]

export function countTodo(slides: DeckSlide[]) {
  return slides.reduce((sum, s) => sum + slideStrings(s).reduce((n, text) => n + (text.match(DECK_TODO_PATTERN)?.length || 0), 0), 0)
}

// ---- Guardie sui fatti ----------------------------------------------------

const AMOUNT = /(?:€\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|euro\b))/gi
const NUMBER = /\d[\d.,]*/g

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '')

/** Cifre (senza separatori) di tutti i numeri presenti in un testo. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.match(NUMBER) || []) {
    const d = digitsOnly(m)
    if (d) out.add(d)
  }
  return out
}

const isYear = (digits: string) => /^(19|20)\d{2}$/.test(digits)

export type DeckWarning = { slide: string; message: string }

/**
 * Controlla l'output dell'agente contro ciò che esiste davvero.
 * - Un importo in euro che non sta nel modello, nei valori inseriti o nei materiali diventa [DA VERIFICARE].
 * - Un altro numero senza riscontro nei materiali non si tocca ma si segnala.
 * - Una foto che non è fra quelle del deck si toglie.
 */
export function guardGenerated(
  slides: DeckSlide[],
  corpus: string,
  assetIds: string[]
): { slides: DeckSlide[]; warnings: DeckWarning[] } {
  const known = numbersIn(corpus)
  const warnings: DeckWarning[] = []
  const guard = (text: string, slideId: string) => {
    const out = text.replace(AMOUNT, (match) => {
      const d = digitsOnly(match)
      if (known.has(d)) return match
      warnings.push({ slide: slideId, message: `Importo non presente nei materiali sostituito: ${match.trim()}` })
      return DECK_TODO
    })
    for (const m of out.match(NUMBER) || []) {
      const d = digitsOnly(m)
      if (d.length >= 2 && !isYear(d) && !known.has(d)) {
        warnings.push({ slide: slideId, message: `Numero senza riscontro nei materiali: ${m}` })
      }
    }
    return out
  }
  const result = slides.map((s) => ({
    ...s,
    title: guard(s.title, s.id),
    body: guard(s.body, s.id),
    note: guard(s.note, s.id),
    items: s.items.map((i) => ({ title: guard(i.title, s.id), text: guard(i.text, s.id) })),
    image_asset_id: s.image_asset_id && assetIds.includes(s.image_asset_id) ? s.image_asset_id : null
  }))
  return { slides: result, warnings }
}

/**
 * Fonde la risposta dell'agente nelle slide di base: conta solo cosa è stato chiesto.
 * Id sconosciuti si scartano, tipo e istruzione restano quelli del modello, un campo
 * vuoto o mancante resta il testo di base (mai una slide svuotata).
 */
export function mergeGenerated(base: DeckSlide[], generated: unknown): DeckSlide[] {
  const list = Array.isArray((generated as { slides?: unknown })?.slides) ? ((generated as { slides: unknown[] }).slides) : []
  const byId = new Map<string, Record<string, unknown>>()
  for (const g of list) {
    if (g && typeof g === 'object' && typeof (g as { id?: unknown }).id === 'string') byId.set((g as { id: string }).id, g as Record<string, unknown>)
  }
  return base.map((b) => {
    const g = byId.get(b.id)
    if (!g) return b
    const title = clip(g.title, LIMITS.title)
    const body = clip(g.body, LIMITS.body)
    const note = clip(g.note, LIMITS.note)
    const items = Array.isArray(g.items)
      ? normalizeSlide({ items: g.items }, 0).items
      : []
    return {
      ...b,
      title: title || b.title,
      body: b.body ? body || b.body : body,
      note: b.note ? note || b.note : note,
      // Il numero delle voci lo decide il modello della slide, non l'agente.
      items: b.items.length ? b.items.map((bi, idx) => ({ title: items[idx]?.title || bi.title, text: items[idx]?.text || bi.text })) : [],
      image_asset_id: typeof g.image_asset_id === 'string' ? g.image_asset_id : b.image_asset_id
    }
  })
}

/** Testo da cui l'agente può prendere numeri e importi: modello, valori inseriti e materiali. */
export function buildCorpus(template: DeckTemplate, input: DeckInput, materials: string[]) {
  return [
    ...template.slides.flatMap(slideStrings),
    ...Object.values(template.vars),
    ...Object.values(input),
    ...materials
  ].join('\n')
}

export function deckSummary(slides: DeckSlide[]) {
  return { slides: slides.length, todo: countTodo(slides) }
}

// ---- Quale base usare ------------------------------------------------------

/** Tipi di ente (`TOURISM_TYPES`) che ricevono la proposta destinazioni: chi governa o rappresenta un territorio. */
export const DESTINATION_ENTITY_TYPES = [
  'ministry', 'nto', 'rto', 'dmo', 'dmc', 'cvb', 'gal', 'municipal_union', 'consortium', 'wine_route', 'foundation',
  'association', 'park', 'district', 'chamber', 'local_office', 'network', 'development_authority', 'municipality'
] as const
/** Tipi che ricevono la proposta di distribuzione: chi vende o porta i visitatori. */
export const DISTRIBUTION_ENTITY_TYPES = [
  'ota', 'tour_operator', 'wholesaler', 'travel_agency', 'bedbank', 'experience_marketplace', 'property_manager',
  'cruise_line', 'ferry_operator', 'airline', 'rail_operator', 'bus_operator'
] as const

// Aeroporti, porti e terminal non hanno un tipo dedicato (stanno in `other`): si riconoscono dal nome.
const DISTRIBUTION_NAME =
  /\b(aeropor\w*|airports?|airlines?|compagnia\s+aerea|crocier\w*|cruises?|traghett\w*|ferry|ferries|tour\s*operator\w*|shipping|compagnia\s+di\s+navigazione|autorit[àa]\s+(?:di\s+sistema\s+)?portuale|port\s+authority|ferrovi\w*|railways?|bus\s+operator\w*)\b/i

export type DeckKindSuggestion = { kind: DeckKind; reason: string }

/**
 * Quale base proporre per un ente: dal tipo (certo) e, se il tipo non dice nulla, dal nome.
 * `null` = non si capisce: la scelta resta a chi crea la presentazione, non si indovina.
 */
export function suggestDeckKind(entity: { type_code?: string | null; name?: string | null }, typeLabel?: string): DeckKindSuggestion | null {
  const type = entity.type_code || ''
  const label = typeLabel ? `«${typeLabel}»` : 'del suo tipo'
  if ((DESTINATION_ENTITY_TYPES as readonly string[]).includes(type)) return { kind: 'destination', reason: `L’ente è ${label}: rappresenta un territorio.` }
  if ((DISTRIBUTION_ENTITY_TYPES as readonly string[]).includes(type)) return { kind: 'distribution', reason: `L’ente è ${label}: porta o vende ai visitatori.` }
  if (entity.name && DISTRIBUTION_NAME.test(entity.name)) return { kind: 'distribution', reason: 'Il nome indica un operatore di trasporto o di viaggi.' }
  return null
}
