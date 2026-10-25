// Presentazione per destinazione (Tourism Intelligence): modello, segnaposto e guardie.
import { normalizeQuoteTemplate, type QuoteTemplate } from './commercial-proposal'
// Puro, senza accesso a rete o database: lo usano l'agente, le API, la pagina e i test.

export const DECK_TODO = '[DA VERIFICARE]'
/** Ogni segnaposto da completare, anche con la nota ("[DA VERIFICARE per questo ente]"). */
export const DECK_TODO_PATTERN = /\[DA VERIFICARE[^\]]{0,80}\]/g

export const DECK_SLIDE_KINDS = ['cover', 'statement', 'list', 'cards', 'steps', 'languages', 'showcase', 'figures', 'compare', 'demo', 'media', 'closing'] as const
export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number]

/** Sfondo della slide; vuoto = quello del tipo. */
export const DECK_TONES = ['light', 'dark', 'deep', 'accent'] as const
export type DeckTone = (typeof DECK_TONES)[number]

/** Icone disegnate dalla pagina (tratto, stile lucide): solo queste, mai un indirizzo. */
export const DECK_ICONS = ['star', 'zap', 'clock', 'globe', 'users', 'shield', 'chat', 'send'] as const
export type DeckIcon = (typeof DECK_ICONS)[number]

/**
 * Immagini fisse della proposta destinazioni, ritagliate dalla presentazione di riferimento
 * (ottobre 2026) e servite da public/deck/destinazioni. Una slide le nomina per chiave:
 * nessun indirizzo libero entra nel modello.
 */
export const DECK_ART = {
  cover: '/deck/destinazioni/cover.webp',
  partenza: '/deck/destinazioni/partenza.webp',
  proposta: '/deck/destinazioni/proposta.webp',
  lingue: '/deck/destinazioni/lingue.webp',
  telefoni: '/deck/destinazioni/telefoni.webp',
  azione: '/deck/destinazioni/azione.webp',
  'qr-napoli': '/deck/destinazioni/qr-napoli.png',
  'qr-destinazioni': '/deck/destinazioni/qr-destinazioni.png'
} as const
export type DeckArt = keyof typeof DECK_ART
/** Foto di esempio generate con AI: la pagina lo dice quando non c'è una foto della destinazione. */
export const DECK_AI_ART: readonly DeckArt[] = ['cover']
/** Le immagini fisse che sono foto di un luogo: vanno sostituite con foto della destinazione. */
export const DECK_PHOTO_ART: readonly DeckArt[] = ['cover', 'partenza', 'proposta']

/** Le slide che vogliono una foto della destinazione, nell'ordine in cui la ricevono. */
export const photoSlots = (slides: DeckSlide[]) =>
  slides.filter((s) => (s.art ? DECK_PHOTO_ART.includes(s.art) : s.kind === 'cover'))

/**
 * Una foto della destinazione per ogni slide che ne vuole una, mai la stessa due volte.
 * Una scelta già fatta (dall'agente o a mano) resta, se la foto esiste e non è ripetuta;
 * gli spazi vuoti prendono le foto non ancora usate, nell'ordine dato (prima quelle
 * caricate da chi lavora, poi quelle trovate). Senza foto resta l'immagine di esempio.
 */
export function assignPhotos(slides: DeckSlide[], photoIds: string[]): DeckSlide[] {
  const known = new Set(photoIds)
  const used = new Set<string>()
  const slots = new Set(photoSlots(slides).map((s) => s.id))
  const kept = slides.map((s) => {
    const id = s.image_asset_id
    if (!id || !known.has(id) || used.has(id)) return id ? { ...s, image_asset_id: null } : s
    used.add(id)
    return s
  })
  const free = photoIds.filter((id) => !used.has(id))
  return kept.map((s) => {
    if (!slots.has(s.id) || s.image_asset_id || !free.length) return s
    return { ...s, image_asset_id: free.shift()! }
  })
}

export const DECK_STATUSES = ['draft', 'generating', 'ready', 'approved', 'failed'] as const
export type DeckStatus = (typeof DECK_STATUSES)[number]

export type DeckItem = {
  title: string
  text: string
  /** Numero grande (figure, catalogo) o etichetta sopra il titolo (schede). */
  value?: string
  icon?: DeckIcon
  /** Scheda evidenziata (arancione o blu, secondo lo sfondo). */
  highlight?: boolean
}
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
  /** Etichetta maiuscola sopra il titolo. */
  kicker?: string
  /** Riga piccola in basso a sinistra (fonte, condizioni). */
  footnote?: string
  tone?: DeckTone
  /** Immagine fissa del modello; una foto caricata (image_asset_id) la sostituisce. */
  art?: DeckArt
  /** QR fisso del modello. */
  qr?: DeckArt
  /** Testi fissi: l'agente sceglie al più la foto, le parole restano quelle del modello. */
  fixed?: boolean
}
export type DeckTemplate = {
  version: 1
  /** Quale base è: un modello salvato senza base è precedente all'ottobre 2026 e si sostituisce. */
  base?: string
  /** Valori di partenza dei segnaposto {{nome}}. */
  vars: Record<string, string>
  slides: DeckSlide[]
  quote_template?: QuoteTemplate
}

export const DECK_VAR_NAMES = ['destinazione', 'ente', 'paese', 'prezzo', 'contatto'] as const
export type DeckVarName = (typeof DECK_VAR_NAMES)[number]
/** Per chi è la presentazione: un ente (base salvata dal titolare) o un partner che distribuisce le guide. */
export const DECK_MODELS = ['destinazione', 'partner'] as const
export type DeckModel = (typeof DECK_MODELS)[number]
export type DeckInput = Partial<Record<DeckVarName, string>> & { modello?: DeckModel }
export const deckModel = (input: DeckInput | null | undefined): DeckModel => (input?.modello === 'partner' ? 'partner' : 'destinazione')

export const MAX_DECK_SLIDES = 16
const LIMITS = { slides: MAX_DECK_SLIDES, items: 6, kicker: 80, footnote: 200, itemValue: 40, title: 160, body: 700, note: 300, itemTitle: 80, itemText: 260, hint: 500, varValue: 300 }

const slide = (s: Partial<DeckSlide> & Pick<DeckSlide, 'id' | 'kind' | 'title'>): DeckSlide => ({
  body: '',
  items: [],
  note: '',
  image_asset_id: null,
  hint: '',
  ...s
})

/** Base destinazioni: la presentazione «Speaqi Guides · Destinazioni» di ottobre 2026. */
export const DESTINATIONS_BASE = 'destinazioni-2026-10'

/**
 * La presentazione base per le destinazioni («Speaqi Guides · Destinazioni», ottobre 2026):
 * quattordici slide, gli stessi testi del PDF di riferimento. La mappa è gratuita per le
 * destinazioni selezionate; la destinazione distribuisce, Speaqi costruisce e aggiorna.
 * Della destinazione entrano il nome (segnaposto) e le foto: copertina, punto di partenza
 * e proposta. Le altre slide sono fisse (`fixed`): l'agente non può riscriverle.
 */
export const DEFAULT_DECK_TEMPLATE: DeckTemplate = {
  version: 1,
  base: DESTINATIONS_BASE,
  vars: {},
  slides: [
    slide({
      id: 'cover',
      kind: 'cover',
      kicker: 'Speaqi Guides per {{destinazione}}',
      title: 'Il tuo territorio.\nUna mappa.\nMolto più da vivere.',
      body: 'Una mappa digitale multilingua del tuo territorio, gratuita per le destinazioni selezionate.',
      art: 'cover',
      fixed: true,
      hint: 'Scegli come foto la più rappresentativa della destinazione (un panorama, il centro storico), se ce n’è una. I testi non cambiano.'
    }),
    slide({
      id: 'partenza',
      kind: 'list',
      tone: 'light',
      kicker: 'Il punto di partenza',
      title: 'I visitatori arrivano.\nLe informazioni sono sparse.',
      items: [
        { title: 'Tante lingue', text: 'visitatori da tutto il mondo, ognuno con la sua' },
        { title: 'Tanti canali', text: 'sito, infopoint, strutture ricettive, operatori' },
        { title: 'Nessuna mappa comune', text: 'ognuno racconta il territorio a modo suo' }
      ],
      art: 'partenza',
      hint: 'Tieni i tre titoli. Nel testo sotto puoi dire da dove arrivano i visitatori di {{destinazione}} e quali canali ha l’ente, solo se lo dicono i materiali o la scheda dell’ente; altrimenti lascia il testo com’è. Come foto, una via o una piazza della destinazione con visitatori, se c’è.'
    }),
    slide({
      id: 'proposta',
      kind: 'list',
      tone: 'dark',
      kicker: 'La proposta',
      title: 'Una mappa del tuo territorio, nel telefono di ogni visitatore.',
      items: [
        { title: 'Luoghi, percorsi, punti di interesse', text: 'in un’unica esperienza digitale', icon: 'star' },
        { title: 'Si apre da link o QR', text: 'nessuna app da scaricare', icon: 'zap' },
        { title: 'Prima e durante il soggiorno', text: 'sul telefono del visitatore', icon: 'clock' }
      ],
      art: 'proposta',
      fixed: true,
      hint: 'Testi fissi. Come foto, un luogo simbolo della destinazione, se c’è.'
    }),
    slide({
      id: 'cosa-ottieni',
      kind: 'cards',
      kicker: 'Cosa ottieni',
      title: 'Cosa ottiene {{destinazione}}.',
      items: [
        { title: 'Una mappa del territorio', text: 'luoghi, percorsi e punti di interesse', icon: 'star' },
        { title: 'Accoglienza multilingua', text: 'senza una guida per ogni lingua', icon: 'globe' },
        { title: 'Aggiornamenti curati insieme', text: 'con modalità concordate', icon: 'clock' },
        { title: 'Un riferimento per la rete', text: 'infopoint, strutture e operatori', icon: 'users' },
        { title: 'Dal telefono, senza app', text: 'con link o QR Code', icon: 'zap' },
        { title: 'Una collaborazione continuativa', text: 'nel perimetro concordato', icon: 'shield', highlight: true }
      ],
      fixed: true
    }),
    slide({
      id: 'lingue',
      kind: 'languages',
      kicker: 'Multilingua',
      title: 'Una sola mappa, nella lingua di ogni visitatore.',
      note: 'Accoglienza multilingua',
      body: 'Per i visitatori dall’estero, senza una guida separata per ogni lingua.',
      art: 'lingue',
      fixed: true
    }),
    slide({
      id: 'catalogo',
      kind: 'showcase',
      kicker: 'Esempi dal catalogo Speaqi',
      title: 'Le mappe sono già online.',
      items: [
        { title: 'Napoli', value: '488', text: 'luoghi da esplorare', highlight: true },
        { title: 'Roma', value: '441', text: 'luoghi da esplorare' },
        { title: 'Lisbona', value: '116', text: 'luoghi da esplorare' },
        { title: 'Pompei', value: '112', text: 'luoghi da esplorare' },
        { title: 'Capri', value: '104', text: 'luoghi da esplorare' }
      ],
      footnote: 'Fonte: guides.speaqi.com, ottobre 2026.',
      fixed: true
    }),
    slide({
      id: 'provala',
      kind: 'demo',
      tone: 'accent',
      kicker: 'Provala adesso',
      title: 'Apri la mappa\ndi Napoli.',
      body: 'Inquadra il QR dal telefono',
      note: 'guides.speaqi.com/maps/napolimap',
      art: 'telefoni',
      qr: 'qr-napoli',
      fixed: true
    }),
    slide({
      id: 'in-azione',
      kind: 'media',
      kicker: 'Speaqi Guides in azione',
      title: 'Speaqi Guides in azione',
      art: 'azione',
      fixed: true
    }),
    slide({
      id: 'collaborazione',
      kind: 'compare',
      kicker: 'Il modello di collaborazione',
      title: 'Tu distribuisci. Noi costruiamo la mappa.',
      items: [
        { title: 'La destinazione', text: 'Distribuisce le guide Speaqi nei canali concordati\nCoinvolge la rete locale\nIndica un referente e fornisce le informazioni sul territorio' },
        { title: 'Speaqi', text: 'Realizza la mappa multilingua\nLa aggiorna nel perimetro concordato\nAccompagna l’evoluzione del progetto', highlight: true }
      ],
      note: 'Per le destinazioni selezionate, la mappa è gratuita.',
      footnote: 'Durata, perimetro e continuità dell’offerta gratuita sono definiti nell’accordo.',
      fixed: true
    }),
    slide({
      id: 'requisiti',
      kind: 'figures',
      tone: 'deep',
      kicker: 'I requisiti minimi',
      title: 'Chi può candidarsi.',
      items: [
        { value: '250.000', title: 'presenze turistiche all’anno', text: 'pernottamenti documentabili' },
        { value: '2', title: 'canali di distribuzione attivi', text: 'per esempio sito e infopoint' },
        { value: '1', title: 'referente dedicato', text: 'per tutta la collaborazione' }
      ],
      note: 'In più: un ente che rappresenta il territorio (ente del turismo, DMO, DMC, comune, consorzio o rete territoriale) e un piano di distribuzione continuativo.',
      fixed: true
    }),
    slide({
      id: 'come-si-parte',
      kind: 'steps',
      kicker: 'Come si parte',
      title: 'Tre passi. Candidarsi non costa nulla.',
      items: [
        { title: 'Candidi la destinazione', text: 'Destinazione, canali e piano di distribuzione. Nessun pagamento, nessun obbligo di acquisto.' },
        { title: 'Definiamo la collaborazione', text: 'Distribuzione, contenuti, aggiornamenti, durata e perimetro gratuito.' },
        { title: 'La mappa va online e cresce', text: 'Tu attivi i canali. Noi costruiamo e aggiorniamo la mappa con il tuo referente.', highlight: true }
      ],
      fixed: true
    }),
    slide({
      id: 'servizi',
      kind: 'cards',
      tone: 'dark',
      kicker: 'Servizi opzionali',
      title: 'Se vuoi andare oltre la mappa.',
      items: [
        { value: 'Assistente AI', title: 'iConcierge', text: 'Risponde ai visitatori usando i contenuti della destinazione.', highlight: true },
        { value: 'Eventi', title: 'Festival ed eventi', text: 'Contenuti dedicati agli eventi del territorio.' },
        { value: 'Contenuti', title: 'Testi, audio e video', text: 'Contenuti editoriali multilingua, perimetro definito per progetto.' }
      ],
      note: 'Su proposta separata. Non servono per ricevere la mappa gratuita.',
      fixed: true
    }),
    slide({
      id: 'domande',
      kind: 'cards',
      kicker: 'Domande frequenti',
      title: 'Le risposte che ci chiedono più spesso.',
      items: [
        { title: 'La mappa è davvero gratuita?', text: 'Sì, per le destinazioni selezionate, con l’accordo di collaborazione. Candidarsi non garantisce l’ammissione.' },
        { title: 'Dobbiamo vendere le guide?', text: 'No. Il tuo ruolo è distribuire e promuovere le guide Speaqi nei canali concordati.' },
        { title: 'Quali guide distribuiamo?', text: 'Le definiamo insieme nell’accordo, in base ai tuoi visitatori e ai tuoi canali.' },
        { title: 'Chi cura contenuti e aggiornamenti?', text: 'Speaqi crea e aggiorna la mappa; il tuo referente fornisce le informazioni locali.' }
      ],
      fixed: true
    }),
    slide({
      id: 'chiusura',
      kind: 'closing',
      title: 'Hai il territorio. Hai i canali.\nFacciamo la mappa di {{destinazione}}.',
      body: 'Massimo Morgante',
      note: 'Founder & CEO, Speaqi',
      items: [
        { title: '389 6868 162', text: '', icon: 'chat' },
        { title: 'info@speaqi.com', text: '', icon: 'send' },
        { title: 'guides.speaqi.com/destinations', text: '', icon: 'globe' }
      ],
      qr: 'qr-destinazioni',
      footnote: 'Candida la tua destinazione',
      fixed: true
    })
  ]
}

/** Base partner: hotel, agenzie, compagnie e chi porta le guide Speaqi ai propri ospiti. */
export const PARTNER_BASE = 'partner-2026-10'

/**
 * La presentazione per un potenziale partner (ottobre 2026). Usa solo ciò che il programma
 * partner di Speaqi offre già: QR col nome del partner (guides.speaqi.com/go/…), codici a
 * tempo per gli ospiti pagati a consumo, vetrina col marchio del partner e portale con i
 * numeri aggregati. Commissione e prezzi non si scrivono qui: stanno in {{prezzo}}, che
 * resta [DA VERIFICARE] finché non li scrive il titolare, quindi non si approva senza.
 */
export const PARTNER_DECK_TEMPLATE: DeckTemplate = {
  version: 1,
  base: PARTNER_BASE,
  vars: {},
  slides: [
    slide({
      id: 'cover',
      kind: 'cover',
      kicker: 'Speaqi Guides per {{ente}}',
      title: 'La guida della città,\nofferta ai vostri ospiti.',
      body: 'Una mappa digitale multilingua di {{destinazione}}, da dare a chi arriva da voi. Con il vostro nome.',
      art: 'cover',
      hint: 'Adatta «ospiti» a chi serve il partner: ospiti per un hotel, passeggeri per una compagnia di navigazione o di trasporto, clienti per un’agenzia o un tour operator. Come foto, la più rappresentativa di {{destinazione}}.'
    }),
    slide({
      id: 'partenza',
      kind: 'list',
      tone: 'light',
      kicker: 'Il punto di partenza',
      title: 'Chi arriva chiede sempre\nla stessa cosa: cosa vedere?',
      items: [
        { title: 'Tante lingue', text: 'ospiti da tutto il mondo, ognuno con la sua' },
        { title: 'Poco tempo', text: 'una giornata o un pomeriggio per scoprire la città' },
        { title: 'Tante domande', text: 'alla reception, in agenzia, a bordo' }
      ],
      art: 'partenza',
      hint: 'Tieni i tre titoli. Adatta i testi al tipo di partner (reception, banco, bordo, agenzia) solo con ciò che dicono la scheda o i materiali. Come foto, una via o una piazza di {{destinazione}}.'
    }),
    slide({
      id: 'proposta',
      kind: 'list',
      tone: 'dark',
      kicker: 'La proposta',
      title: 'Una guida di {{destinazione}} nel telefono di ogni ospite.',
      items: [
        { title: 'Luoghi, percorsi e racconti audio', text: 'in un’unica mappa', icon: 'star' },
        { title: 'Si apre da QR o link', text: 'nessuna app da scaricare', icon: 'zap' },
        { title: 'Con il vostro nome', text: '«Offerto da {{ente}}» quando l’ospite apre la guida', icon: 'shield' }
      ],
      art: 'proposta',
      fixed: true,
      hint: 'Testi fissi. Come foto, un luogo simbolo di {{destinazione}}.'
    }),
    slide({
      id: 'lingue',
      kind: 'languages',
      kicker: 'Multilingua',
      title: 'Una sola guida, nella lingua di ogni ospite.',
      note: 'Accoglienza multilingua',
      body: 'Ognuno la apre nella sua lingua, senza chiedere a nessuno.',
      art: 'lingue',
      fixed: true
    }),
    slide({
      id: 'catalogo',
      kind: 'showcase',
      kicker: 'Esempi dal catalogo Speaqi',
      title: 'Le guide sono già online.',
      items: [
        { title: 'Napoli', value: '488', text: 'luoghi da esplorare', highlight: true },
        { title: 'Roma', value: '441', text: 'luoghi da esplorare' },
        { title: 'Lisbona', value: '116', text: 'luoghi da esplorare' },
        { title: 'Pompei', value: '112', text: 'luoghi da esplorare' },
        { title: 'Capri', value: '104', text: 'luoghi da esplorare' }
      ],
      footnote: 'Fonte: guides.speaqi.com, ottobre 2026.',
      fixed: true
    }),
    slide({
      id: 'modi',
      kind: 'cards',
      kicker: 'Come collaboriamo',
      title: 'Tre modi di lavorare insieme.\nScegliete il vostro.',
      items: [
        { value: 'QR e link', title: 'Il vostro QR', text: 'In reception, in camera, al banco o a bordo. Chi compra la guida dal vostro QR genera una commissione per voi.', icon: 'zap' },
        { value: 'Codici', title: 'Codici per i vostri ospiti', text: 'Lotti di codici che aprono le guide per le ore che decidete. Si paga solo quello che viene attivato.', icon: 'users', highlight: true },
        { value: 'Vetrina', title: 'Il vostro catalogo', text: 'Le guide Speaqi con il vostro marchio: «{{ente}} by Speaqi».', icon: 'globe' }
      ],
      fixed: true,
      hint: 'Testi fissi: sono i tre modi che Speaqi offre oggi.'
    }),
    slide({
      id: 'ospite',
      kind: 'steps',
      kicker: 'Per l’ospite',
      title: 'Dal QR alla città, in pochi secondi.',
      items: [
        { title: 'Inquadra il QR', text: 'O apre il link che gli date. Nessuna app da scaricare.' },
        { title: 'Sceglie la lingua', text: 'La guida si apre nella sua lingua, con il vostro nome.' },
        { title: 'Esplora', text: 'Luoghi, percorsi e racconti audio, prima e durante la visita.', highlight: true }
      ],
      fixed: true
    }),
    slide({
      id: 'numeri',
      kind: 'cards',
      tone: 'dark',
      kicker: 'I vostri numeri',
      title: 'Vedete quello che succede.',
      items: [
        { title: 'Scansioni e aperture', text: 'quante persone arrivano alla guida dal vostro QR o dai vostri codici', icon: 'zap' },
        { title: 'Acquisti e attivazioni', text: 'quello su cui si calcolano commissioni e fatture', icon: 'shield' },
        { title: 'Lingue e orari', text: 'chi sono i vostri ospiti e quando escono a visitare', icon: 'globe' }
      ],
      note: 'In un portale riservato, con un link che vi diamo noi. Esportabile in PDF e CSV.',
      footnote: 'Solo numeri aggregati: nessun dato personale dei vostri ospiti.',
      fixed: true
    }),
    slide({
      id: 'provala',
      kind: 'demo',
      tone: 'accent',
      kicker: 'Provala adesso',
      title: 'Apri la guida\ndi Napoli.',
      body: 'Inquadra il QR dal telefono',
      note: 'guides.speaqi.com/maps/napolimap',
      art: 'telefoni',
      qr: 'qr-napoli',
      fixed: true
    }),
    slide({
      id: 'condizioni',
      kind: 'statement',
      kicker: 'Le condizioni',
      title: 'Condizioni chiare, scritte prima di partire.',
      body: '{{prezzo}}',
      note: 'Commissione, prezzo dei codici e durata sono definiti nell’accordo.',
      hint: 'Solo le condizioni scritte dal titolare nel campo prezzo o nei materiali. Mai una percentuale o un prezzo dedotti.'
    }),
    slide({
      id: 'come-si-parte',
      kind: 'steps',
      kicker: 'Come si parte',
      title: 'Tre passi, e la guida è dai vostri ospiti.',
      items: [
        { title: 'Scegliamo il modo', text: 'QR, codici, vetrina o più di uno, secondo i vostri ospiti.' },
        { title: 'Prepariamo tutto', text: 'Il QR col vostro nome, i codici da stampare o mandare, la vetrina.' },
        { title: 'Guardate i numeri', text: 'Nel vostro portale, dal primo giorno.', highlight: true }
      ],
      fixed: true
    }),
    slide({
      id: 'chiusura',
      kind: 'closing',
      title: 'Avete gli ospiti.\nNoi la guida di {{destinazione}}.',
      body: 'Massimo Morgante',
      note: 'Founder & CEO, Speaqi',
      items: [
        { title: '389 6868 162', text: '', icon: 'chat' },
        { title: 'info@speaqi.com', text: '', icon: 'send' },
        { title: 'guides.speaqi.com', text: '', icon: 'globe' }
      ],
      fixed: true
    })
  ]
}

/** Base Tourism per aziende: stessi strumenti, senza impegni di partnership impliciti. */
export const TOURISM_COMPANY_TEMPLATE: DeckTemplate = {
  version: 1,
  base: 'aziende-2026-10',
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

const pick = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  list.includes(value as T) ? (value as T) : undefined

export function normalizeItem(raw: unknown): DeckItem {
  const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const item: DeckItem = { title: clip(i.title, LIMITS.itemTitle), text: clip(i.text, LIMITS.itemText) }
  const value = clip(i.value, LIMITS.itemValue)
  if (value) item.value = value
  const icon = pick(DECK_ICONS, i.icon)
  if (icon) item.icon = icon
  if (i.highlight === true) item.highlight = true
  return item
}

export function normalizeSlide(raw: unknown, index: number): DeckSlide {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = DECK_SLIDE_KINDS.includes(r.kind as DeckSlideKind) ? (r.kind as DeckSlideKind) : 'statement'
  const items = (Array.isArray(r.items) ? r.items : [])
    .slice(0, LIMITS.items)
    .map(normalizeItem)
    .filter((item) => item.title || item.text || item.value)
  const out: DeckSlide = {
    id: slugId(r.id, `slide-${index + 1}`),
    kind,
    title: clip(r.title, LIMITS.title),
    body: clip(r.body, LIMITS.body),
    items,
    note: clip(r.note, LIMITS.note),
    image_asset_id: typeof r.image_asset_id === 'string' && /^[0-9a-f-]{36}$/i.test(r.image_asset_id) ? r.image_asset_id : null,
    hint: clip(r.hint, LIMITS.hint)
  }
  const kicker = clip(r.kicker, LIMITS.kicker)
  if (kicker) out.kicker = kicker
  const footnote = clip(r.footnote, LIMITS.footnote)
  if (footnote) out.footnote = footnote
  const tone = pick(DECK_TONES, r.tone)
  if (tone) out.tone = tone
  const art = Object.hasOwn(DECK_ART, String(r.art)) ? (r.art as DeckArt) : undefined
  if (art) out.art = art
  const qr = Object.hasOwn(DECK_ART, String(r.qr)) ? (r.qr as DeckArt) : undefined
  if (qr) out.qr = qr
  if (r.fixed === true) out.fixed = true
  return out
}

/** Legge un modello o un deck da JSON: scarta il superfluo, rende unici gli id, non lancia. */
export function normalizeTemplate(raw: unknown): DeckTemplate {
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
  if (!slides.length) return structuredClone(DEFAULT_DECK_TEMPLATE)
  const base = typeof r.base === 'string' && /^[a-z0-9-]{1,40}$/.test(r.base) ? r.base : undefined
  return { version: 1, ...(base ? { base } : {}), vars, slides, quote_template: normalizeQuoteTemplate(r.quote_template, 'tourism') }
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
    ...(s.kicker ? { kicker: fill(s.kicker) } : {}),
    ...(s.footnote ? { footnote: fill(s.footnote) } : {}),
    items: s.items.map((i) => ({ ...i, title: fill(i.title), text: fill(i.text) }))
  }))
}

const slideStrings = (s: DeckSlide) => [
  s.kicker || '',
  s.title,
  s.body,
  s.note,
  s.footnote || '',
  ...s.items.flatMap((i) => [i.value || '', i.title, i.text])
]

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
    items: s.items.map((i) => ({ ...i, title: guard(i.title, s.id), text: guard(i.text, s.id) })),
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
    const image_asset_id = typeof g.image_asset_id === 'string' ? g.image_asset_id : b.image_asset_id
    // Una slide fissa resta parola per parola quella del modello: l'agente sceglie al più la foto.
    if (b.fixed) return { ...b, image_asset_id }
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
      items: b.items.length ? b.items.map((bi, idx) => ({ ...bi, title: items[idx]?.title || bi.title, text: items[idx]?.text || bi.text })) : [],
      image_asset_id
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
