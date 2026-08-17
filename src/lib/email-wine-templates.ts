/**
 * Modelli email per il settore vino.
 *
 * Non sono testi da spedire cosi come sono: sono i modelli di riferimento che
 * l'AI deve seguire per struttura, ritmo, lunghezza e tipo di CTA, riscrivendo
 * il contenuto con i dati reali del contatto. Tutti e quattro tengono la stessa
 * promessa (raccontate la cantina una volta, Speaqi la fa parlare con il mondo)
 * ma cambiano l'angolo di attacco, cosi la stessa lista non riceve quattro volte
 * la stessa email.
 *
 * Le firme non compaiono nei modelli: il CRM aggiunge la firma Gmail reale.
 */
import type { CRMContact } from '@/types'

export type WineEmailTemplateId = 'A' | 'B' | 'C' | 'D'

export type WineEmailTemplate = {
  id: WineEmailTemplateId
  /** Etichetta breve per il selettore in /email. */
  label: string
  /** Quando questo angolo funziona meglio. */
  angle: string
  subject: string
  body: string
}

export const WINE_EMAIL_TEMPLATES: WineEmailTemplate[] = [
  {
    id: 'A',
    label: 'Esempio gratuito',
    angle:
      'Ripresa del contatto che salta la presentazione e propone subito di preparare gratuitamente un esempio su un loro vino. E il modello di riferimento preferito.',
    subject: 'Ti faccio vedere Speaqi su un vostro vino?',
    body: [
      'Buongiorno {{nome}},',
      '',
      'ti avevo già scritto qualche tempo fa per presentarti Speaqi.',
      '',
      'Nel frattempo abbiamo fatto evolvere molto il progetto per il mondo del vino e, invece di mandarti un’altra presentazione, preferisco fartelo vedere direttamente.',
      '',
      'Posso prendere un vino di {{azienda}} e prepararti gratuitamente un esempio: il cliente scansiona il QR sulla bottiglia e scopre vino, cantina e territorio nella propria lingua, attraverso testi, audio e video.',
      '',
      'Stiamo già lavorando con realtà come San Salvatore 1988 e Leonarda Tardi.',
      '',
      'Se vuoi vederlo, rispondimi semplicemente “sì” e lo prepariamo.',
    ].join('\n'),
  },
  {
    id: 'B',
    label: 'Novità dal progetto',
    angle:
      'Il progetto e cresciuto dopo l’ultima email: utile quando la comunicazione precedente e vecchia e serve un motivo credibile per riscrivere.',
    subject: 'Una novità rispetto alla mia ultima email',
    body: [
      'Buongiorno {{nome}},',
      '',
      'qualche tempo fa ti avevo scritto per parlarti di Speaqi.',
      '',
      'Da allora il progetto è cresciuto molto, soprattutto nel settore wine.',
      '',
      'Oggi possiamo prendere ciò che {{azienda}} già racconta — vini, cantina, territorio, schede, testi, audio e video — e renderlo disponibile in oltre 50 lingue, senza dover ricostruire ogni volta contenuti separati.',
      '',
      'Ma preferisco non raccontartelo in un’altra email.',
      '',
      'Se vuoi, preparo gratuitamente un esempio su un vostro vino e te lo mando direttamente.',
      '',
      'Ti va?',
    ].join('\n'),
  },
  {
    id: 'C',
    label: 'Partiamo da una bottiglia',
    angle:
      'Il piu concreto: parte dallo scenario della bottiglia e del cliente straniero. Adatto a chi non ha reagito a un messaggio piu descrittivo.',
    subject: 'Partiamo da una vostra bottiglia?',
    body: [
      'Buongiorno {{nome}},',
      '',
      'riprendo il contatto dopo la mia precedente email su Speaqi con una proposta molto più concreta.',
      '',
      'Dammi una vostra bottiglia e ti faccio vedere cosa può diventare.',
      '',
      'Da un semplice QR, un cliente straniero può scoprire il vino, ascoltarne la storia, conoscere la cantina e il territorio e vedere i vostri contenuti direttamente nella propria lingua.',
      '',
      'Testi, audio e video, senza scaricare alcuna app.',
      '',
      'Se vuoi, scelgo un vino di {{azienda}} e ti preparo gratuitamente un esempio.',
      '',
      'Posso?',
    ].join('\n'),
  },
  {
    id: 'D',
    label: 'Prova sociale',
    angle:
      'Parte dalle cantine con cui stiamo già lavorando: adatto a chi ha bisogno di vedere che il progetto e reale prima di concedere attenzione.',
    subject: 'Cosa stiamo facendo con le cantine',
    body: [
      'Buongiorno {{nome}},',
      '',
      'ti avevo già contattato qualche tempo fa per Speaqi.',
      '',
      'Nel frattempo siamo passati dalla presentazione ai progetti concreti e stiamo lavorando con cantine come San Salvatore 1988 e Leonarda Tardi per raccontare vini, cantina e territorio a un pubblico internazionale.',
      '',
      'L’idea è semplice: la cantina racconta una volta il proprio mondo, Speaqi lo rende fruibile in oltre 50 lingue attraverso web, QR, testi, audio e video.',
      '',
      'Vorrei farti vedere cosa significa direttamente su {{azienda}}.',
      '',
      'Se vuoi, preparo gratuitamente un esempio su un vostro vino.',
    ].join('\n'),
  },
]

export function isWineEmailTemplateId(value: unknown): value is WineEmailTemplateId {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D'
}

export function findWineEmailTemplate(id?: string | null) {
  return WINE_EMAIL_TEMPLATES.find((template) => template.id === id) || null
}

/** A e il modello preferito: pesa il doppio degli altri nella rotazione. */
const TEMPLATE_ROTATION: WineEmailTemplateId[] = ['A', 'B', 'A', 'C', 'A', 'D', 'A', 'B', 'C', 'D']

/**
 * Senza scelta esplicita il modello e stabile per contatto: rigenerare una bozza
 * non cambia angolo a sorpresa, ma contatti diversi della stessa lista ricevono
 * email diverse.
 */
export function pickWineEmailTemplate(
  contact: Pick<CRMContact, 'id'>,
  explicitId?: string | null
): WineEmailTemplate {
  const explicit = findWineEmailTemplate(explicitId)
  if (explicit) return explicit

  const key = String(contact.id || '')
  let hash = 0
  for (let index = 0; index < key.length; index++) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100000
  }
  const id = TEMPLATE_ROTATION[hash % TEMPLATE_ROTATION.length]
  return findWineEmailTemplate(id) || WINE_EMAIL_TEMPLATES[0]
}

/**
 * Il modello entra nel prompt come riferimento, non come testo da copiare:
 * `hasPreviousContact` decide se il richiamo alla email precedente e legittimo.
 */
export function formatWineEmailTemplateGuidance(
  template: WineEmailTemplate,
  options: { hasPreviousContact: boolean }
) {
  return [
    `Modello di riferimento per questa email — variante ${template.id} (${template.label}).`,
    `Quando si usa: ${template.angle}`,
    '',
    `Oggetto del modello: ${template.subject}`,
    'Testo del modello:',
    template.body,
    '',
    'Come usare il modello:',
    '- Segui struttura, ritmo, lunghezza e tipo di CTA del modello: paragrafi brevissimi, una sola idea per paragrafo, chiusura con una domanda semplice a cui si risponde in una parola.',
    '- Riscrivi il testo con i dati reali del contatto: {{nome}} e {{azienda}} sono segnaposto, vanno sostituiti con nome e cantina reali (se il nome non e affidabile usa solo “Buongiorno,”). Non lasciare mai un segnaposto nell’email.',
    '- Non copiare il modello parola per parola: cambia la formulazione mantenendo il senso, e adatta l’esempio se hai informazioni reali su un vino o sulla cantina.',
    '- Il modello ha la precedenza sulle indicazioni generiche di struttura e di CTA: qui la CTA e offrire un esempio gratuito, non una call di 15 minuti.',
    '- Non aggiungere il blocco firma finale (nome e ruolo): lo aggiunge il CRM con la firma Gmail.',
    '- Cita come prova sociale solo cantine reali gia indicate nel contesto (San Salvatore, Dalibra, Leonarda Tardi) e non attribuire loro numeri o risultati.',
    options.hasPreviousContact
      ? '- Il richiamo a una comunicazione precedente e corretto: c’e gia stato un contatto scritto. Restane generico (“ti avevo scritto qualche tempo fa”), senza citare aperture, click o date precise che non hai.'
      : '- ATTENZIONE: con questo contatto non risulta nessuna comunicazione precedente. Elimina ogni riferimento a email passate (“ti avevo già scritto”, “riprendo il contatto”) e apri presentandoti in una riga; tutto il resto del modello resta valido.',
  ].join('\n')
}
