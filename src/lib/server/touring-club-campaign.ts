/**
 * Campagna Touring Club Italia: due righe di `commercial_campaigns` che
 * condividono la lista sorgente ma non la lingua — `touring-club` (it) e
 * `touring-club-en` (en). Il motore ha una sola sequenza per campagna e sceglie
 * lo step per numero, quindi due lingue = due campagne.
 *
 * Il pubblico e volutamente eterogeneo (hotel, ristoranti, musei, negozi,
 * visite guidate): i testi non nominano mai un tipo di struttura, parlano di
 * "attivita" e di "visitatori".
 */

export const TOURING_CLUB_LIST_NAME = 'Touring Club Italia'
export const TOURING_CLUB_SOURCE = 'touring-club-italia'
export const TOURING_CLUB_EVENT_TAG = 'touring-club'
export const TOURING_CLUB_EVENT_TAG_EN = 'touring-club-en'
export const TOURING_CLUB_LANDING_URL = 'https://speaqi.com/demo/touring-club'

type StepSeed = {
  step_number: number
  day_offset: number
  only_without_engagement: boolean
  subject_template: string
  body: string
}

const SIGNATURE_IT = 'Cordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com'
const SIGNATURE_EN = 'Kind regards,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com'

const STEPS_IT: StepSeed[] = [
  {
    step_number: 1,
    day_offset: 1,
    only_without_engagement: false,
    subject_template: '{{azienda}}: una demo gratuita per i vostri visitatori stranieri',
    body: `{{saluto}}\n\nsono Massimo Morgante, fondatore di Speaqi.\n\nChi arriva da {{azienda}} spesso non parla italiano, e le informazioni che vi riguardano sono sparse fra sito, social, cartelli e persone allo sportello.\n\nSpeaqi raccoglie una volta sola quello che raccontate gia — orari, servizi, come arrivare, cosa vedere intorno — e lo rende consultabile da un QR in qualunque lingua, con un assistente che risponde usando soltanto le vostre informazioni.\n\nHo preparato una demo gratuita partendo da quello che e gia pubblico: {{demo_url}}\n\n${SIGNATURE_IT}`,
  },
  {
    step_number: 2,
    day_offset: 4,
    only_without_engagement: true,
    subject_template: '{{azienda}} — un QR che risponde in ogni lingua',
    body: `{{saluto}}\n\nsono Massimo Morgante, fondatore di Speaqi.\n\nLe riscrivo con l'esempio piu concreto che ho: un visitatore straniero inquadra un QR all'ingresso e trova subito orari, come raggiungervi, cosa offrite e cosa c'e da vedere nei dintorni — nella sua lingua, senza scaricare niente e senza che nessuno debba rispondere al telefono.\n\nLe informazioni le prendiamo da quelle che avete gia pubblicato, quindi la prima versione non vi costa lavoro.\n\nPuo vederla qui: {{demo_url}}\n\n${SIGNATURE_IT}`,
  },
  {
    step_number: 3,
    day_offset: 9,
    only_without_engagement: false,
    subject_template: 'Chi tiene aggiornate le informazioni di {{azienda}}?',
    body: `{{saluto}}\n\nsono Massimo Morgante, fondatore di Speaqi.\n\nLa domanda che ci fanno piu spesso e chi debba tenere tutto aggiornato. La risposta e: un posto solo.\n\nCon Speaqi {{azienda}} mantiene una sola base di informazioni, e quella stessa base alimenta la pagina web, il QR e l'assistente che risponde ai visitatori 24 ore su 24. Cambiate un orario una volta e cambia ovunque, in tutte le lingue.\n\nLa demo gratuita e sempre qui: {{demo_url}}\n\n${SIGNATURE_IT}`,
  },
  {
    step_number: 4,
    day_offset: 16,
    only_without_engagement: false,
    subject_template: '{{azienda}} e i visitatori che non parlano italiano',
    body: `{{saluto}}\n\nsono Massimo Morgante, fondatore di Speaqi.\n\nUn visitatore che capisce cosa ha davanti si ferma di piu, chiede di piu e torna piu volentieri. Il contrario vale allo stesso modo: quando l'informazione non si trova, la visita si accorcia.\n\nSpeaqi nasce per questo — rendere comprensibile in ogni lingua quello che un luogo ha gia da dire. Rai 3 ha dedicato al progetto un servizio sull'innovazione nel turismo.\n\nPuo vedere come funzionerebbe per {{azienda}}: {{demo_url}}\n\n${SIGNATURE_IT}`,
  },
  {
    step_number: 5,
    day_offset: 28,
    only_without_engagement: false,
    subject_template: 'Ultimo messaggio — la demo di {{azienda}} resta disponibile',
    body: `{{saluto}}\n\nsono Massimo Morgante, fondatore di Speaqi.\n\nChiudo qui i miei messaggi, non le scrivero altre volte.\n\nSe un giorno vorra vedere come apparirebbe {{azienda}} a un visitatore che non parla italiano, la demo resta gratuita e disponibile: {{demo_url}}\n\nGrazie per l'attenzione e buon lavoro.\n\n${SIGNATURE_IT}`,
  },
]

const STEPS_EN: StepSeed[] = [
  {
    step_number: 1,
    day_offset: 1,
    only_without_engagement: false,
    subject_template: '{{azienda}}: a free demo for your international visitors',
    body: `{{saluto}}\n\nI am Massimo Morgante, founder of Speaqi.\n\nMost people arriving at {{azienda}} do not speak the local language, and the information about you is scattered across a website, social media, printed signs and whoever happens to be at the desk.\n\nSpeaqi collects what you already publish — opening hours, services, how to get there, what to see nearby — and makes it readable from a single QR code in any language, with an assistant that answers using only your own information.\n\nI have prepared a free demo built from what is already public: {{demo_url}}\n\n${SIGNATURE_EN}`,
  },
  {
    step_number: 2,
    day_offset: 4,
    only_without_engagement: true,
    subject_template: '{{azienda}} — a QR code that answers in every language',
    body: `{{saluto}}\n\nI am Massimo Morgante, founder of Speaqi.\n\nHere is the clearest example I can give: a visitor scans a QR code at your entrance and immediately finds opening hours, directions, what you offer and what is worth seeing nearby — in their own language, with nothing to download and without anyone having to answer the phone.\n\nWe build it from information you have already published, so the first version costs you no work.\n\nYou can see it here: {{demo_url}}\n\n${SIGNATURE_EN}`,
  },
  {
    step_number: 3,
    day_offset: 9,
    only_without_engagement: false,
    subject_template: 'Who keeps the information about {{azienda}} up to date?',
    body: `{{saluto}}\n\nI am Massimo Morgante, founder of Speaqi.\n\nThe question we get most often is who has to keep it all up to date. The answer is: one place only.\n\nWith Speaqi, {{azienda}} maintains a single body of information, and that same source feeds the web page, the QR code and the assistant answering visitors around the clock. Change an opening time once and it changes everywhere, in every language.\n\nThe free demo is still here: {{demo_url}}\n\n${SIGNATURE_EN}`,
  },
  {
    step_number: 4,
    day_offset: 16,
    only_without_engagement: false,
    subject_template: '{{azienda}} and the visitors who don\'t speak the local language',
    body: `{{saluto}}\n\nI am Massimo Morgante, founder of Speaqi.\n\nA visitor who understands what is in front of them stays longer, asks more and is more likely to come back. The opposite is just as true: when information cannot be found, the visit gets shorter.\n\nThat is why Speaqi exists — to make what a place already has to say understandable in every language. Italian national television covered the project in a report on innovation in tourism.\n\nYou can see how it would work for {{azienda}}: {{demo_url}}\n\n${SIGNATURE_EN}`,
  },
  {
    step_number: 5,
    day_offset: 28,
    only_without_engagement: false,
    subject_template: 'Last message — the demo for {{azienda}} stays available',
    body: `{{saluto}}\n\nI am Massimo Morgante, founder of Speaqi.\n\nThis is my last message — I will not write again.\n\nIf one day you would like to see how {{azienda}} looks to a visitor who does not speak the local language, the demo stays free and available: {{demo_url}}\n\nThank you for your time.\n\n${SIGNATURE_EN}`,
  },
]

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textToHtml(value: string) {
  return `<div style="font-family:Arial,sans-serif;color:#101828;line-height:1.55;text-align:left;background:#fff;">${value
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`
}

export function touringClubStepTemplates(locale: 'it' | 'en') {
  return (locale === 'en' ? STEPS_EN : STEPS_IT).map(({ body, ...step }) => ({
    ...step,
    body_text_template: body,
    body_html_template: textToHtml(body),
  }))
}
