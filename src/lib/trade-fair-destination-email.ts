import { isForeignDestination, isItalianDestination, isTourOperator, type FairExhibitor } from './trade-fair'

export type FairEmailAudience = 'italiane' | 'estere' | 'operatori'
export type FairEmailCopy = { subject: string; body: string; lang: 'it' | 'en' }

export const ITALIAN_DESTINATION_EMAIL: FairEmailCopy = {
  lang: 'it',
  subject: 'Il vostro territorio, da scoprire nella lingua dei visitatori',
  body: `Buongiorno,

vi riscriviamo perché ci siamo accorti solo ora che l’email che vi avevamo inviato qualche giorno fa ci era tornata indietro.

Ci piacerebbe far vivere il vostro territorio dal telefono di chi lo visita: trovare i luoghi, ascoltarne le storie e scegliere un itinerario nella propria lingua, con un semplice link o QR code.

È quello che facciamo con Speaqi: la mappa diventa una guida che accompagna il visitatore e dà voce alle esperienze, ai percorsi e alle particolarità della destinazione.

Sappiamo che arriviamo un po’ tardi e che le giornate di fiera sono fitte di impegni. Riusciamo a ritagliarci dieci minuti in questi giorni al TTG? Possiamo passare dal vostro stand nell’orario che vi è più comodo.

Un cordiale saluto,`,
}

export const FOREIGN_DESTINATION_EMAIL: FairEmailCopy = {
  lang: 'en',
  subject: 'Bring your destination to life in your visitors’ language',
  body: `Hello,

We’re writing again because we have only just realised that the email we sent you a few days ago bounced back.

We would love to bring your destination to life on visitors’ phones: finding places, listening to their stories and choosing an itinerary in their own language, through a simple link or QR code.

That is what we do with Speaqi: an interactive map becomes a guide that accompanies travellers and shares the experiences, routes and distinctive character of your destination.

We know we are reaching out late and that your days at the fair are busy. Could we find ten minutes at TTG? We would be happy to stop by your stand at a time that suits you.

Kind regards,`,
}

export const TOUR_OPERATOR_EMAIL: FairEmailCopy = {
  lang: 'it',
  subject: 'Una guida da portare in viaggio, un’opportunità per i vostri pacchetti',
  body: `Buongiorno,

vi riscriviamo perché ci siamo accorti solo ora che l’email che vi avevamo inviato qualche giorno fa ci era tornata indietro.

Ci piacerebbe aggiungere qualcosa di utile all’esperienza dei vostri viaggiatori: una guida sul telefono che li aiuti a orientarsi, scegliere cosa visitare e ascoltare le storie dei luoghi nella propria lingua.

Con Speaqi possiamo valutare due strade: proporre le mappe e guide ai vostri clienti come servizio aggiuntivo, oppure una fornitura in blocco da includere nei vostri pacchetti e circuiti.

Partendo dalle destinazioni che trattate e dai volumi di viaggiatori, possiamo costruire una proposta adatta al vostro modo di vendere e organizzare i viaggi.

Sappiamo che arriviamo un po’ tardi: riusciamo a ritagliarci dieci minuti al TTG per capire quale collaborazione avrebbe più senso per voi?

Un cordiale saluto,`,
}

export const FAIR_EMAIL_COPIES: Record<FairEmailAudience, FairEmailCopy> = {
  italiane: ITALIAN_DESTINATION_EMAIL,
  estere: FOREIGN_DESTINATION_EMAIL,
  operatori: TOUR_OPERATOR_EMAIL,
}

export function fairEmailAudience(row: FairExhibitor): FairEmailAudience | null {
  if (isItalianDestination(row)) return 'italiane'
  if (isForeignDestination(row)) return 'estere'
  if (isTourOperator(row)) return 'operatori'
  return null
}

export const DESTINATION_EMAIL_FOOTER = 'Se preferite non ricevere altre comunicazioni da Speaqi, rispondete «no grazie» e non vi contatteremo più.'

export function fairEmailFooter(lang: 'it' | 'en') {
  return lang === 'it' ? DESTINATION_EMAIL_FOOTER : 'If you would rather not receive further messages from Speaqi, reply “no thanks” and we will not contact you again.'
}
