/**
 * Pulsanti di Telegram: approvare una presentazione o decidere una proposta con un tocco.
 * Un tocco su un pulsante è un clic del titolare (arriva dalla sua chat, verificata dal
 * webhook), non un «sì» scritto in chat. Puro e testato: niente rete, niente database.
 */

export type TelegramButton = { text: string; callback_data?: string; url?: string }
export type TelegramKeyboard = TelegramButton[][]

export type QueueView = 'safe' | 'emails' | 'decisions'

export type TelegramAction =
  | { kind: 'deck_approve'; id: string }
  | { kind: 'deck_pdf'; id: string }
  | { kind: 'output'; id: string; status: 'approved' | 'rejected' }
  /** Bozza email dell'Ufficio: approvarla vuol dire mandarla, con un tocco. */
  | { kind: 'output_send'; id: string }
  /** I pulsanti di /coda: approva le sicure, mostra le email, mostra le decisioni. */
  | { kind: 'queue'; view: QueueView }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Il dato di un pulsante: al massimo 64 byte, quindi sigle corte e l'id. */
export const deckApproveData = (id: string) => `d:a:${id}`
export const deckPdfData = (id: string) => `d:p:${id}`
export const outputData = (id: string, status: 'approved' | 'rejected') => `o:${status === 'approved' ? 'a' : 'r'}:${id}`
export const outputSendData = (id: string) => `o:s:${id}`
export const queueData = (view: QueueView) => `q:${view === 'safe' ? 'a' : view === 'emails' ? 'e' : 'd'}`

/** Solo le forme note, con un UUID vero: qualunque altro dato si ignora. */
export function parseTelegramAction(data: unknown): TelegramAction | null {
  const value = typeof data === 'string' ? data.trim().toLowerCase() : ''
  const queue = /^q:([aed])$/.exec(value)
  if (queue) return { kind: 'queue', view: queue[1] === 'a' ? 'safe' : queue[1] === 'e' ? 'emails' : 'decisions' }
  const match = new RegExp(`^([do]):([aprs]):(${UUID})$`).exec(value)
  if (!match) return null
  const [, scope, verb, id] = match
  if (scope === 'd' && verb === 'a') return { kind: 'deck_approve', id }
  if (scope === 'd' && verb === 'p') return { kind: 'deck_pdf', id }
  if (scope === 'o' && verb === 'a') return { kind: 'output', id, status: 'approved' }
  if (scope === 'o' && verb === 'r') return { kind: 'output', id, status: 'rejected' }
  if (scope === 'o' && verb === 's') return { kind: 'output_send', id }
  return null
}

/** Sotto una bozza email: si manda, si scarta, o si corregge nel CRM. */
export function draftEmailKeyboard(input: { id: string; editLink: string }): TelegramKeyboard {
  return [
    [{ text: '📨 Approva e invia', callback_data: outputSendData(input.id) }, { text: '✖️ Scarta', callback_data: outputData(input.id, 'rejected') }],
    [{ text: '✏️ Correggi nel CRM', url: input.editLink }],
  ]
}

/** Sotto il riepilogo di /coda. Ogni pulsante compare solo se ha qualcosa da fare. */
export function queueKeyboard(counts: { auto: number; safe: number; send: number; manual: number }): TelegramKeyboard {
  const rows: TelegramKeyboard = []
  if (counts.auto + counts.safe) rows.push([{ text: `✅ Approva le sicure (${counts.auto + counts.safe})`, callback_data: queueData('safe') }])
  if (counts.send) rows.push([{ text: `📨 Mostrami le email (${counts.send})`, callback_data: queueData('emails') }])
  if (counts.manual) rows.push([{ text: `✋ Mostrami le decisioni (${counts.manual})`, callback_data: queueData('decisions') }])
  return rows
}

/** Didascalia del PDF di una presentazione: cos'è, cosa manca, dove si modifica (Telegram: max 1024). */
export function deckCaption(input: { title: string; status: string; todo: number; link: string; note?: string | null }) {
  const state = input.status === 'approved' ? 'approvata'
    : input.status === 'failed' ? 'in bozza: l’ultima generazione non è riuscita, controllala nell’editor'
    : input.todo > 0 ? `bozza: restano ${input.todo} [DA VERIFICARE] da completare nell’editor`
    : 'bozza pronta da approvare'
  return [`*${input.title.slice(0, 200)}*`, `Presentazione ${state}.`, input.note ? input.note.slice(0, 300) : '', input.link]
    .filter(Boolean).join('\n').slice(0, 1000)
}

/** Si approva da Telegram solo una bozza pronta, senza niente da completare. */
export function deckApprovable(input: { status: string; todo: number }) {
  return input.status !== 'approved' && input.status !== 'generating' && input.status !== 'failed' && input.todo === 0
}

/** I pulsanti sotto il PDF: approvare solo se non resta niente da completare; modificare sempre. */
export function deckKeyboard(input: { id: string; status: string; todo: number; link: string }): TelegramKeyboard {
  const row: TelegramButton[] = []
  if (deckApprovable(input)) row.push({ text: '✅ Approva', callback_data: deckApproveData(input.id) })
  row.push({ text: '✏️ Modifica nel CRM', url: input.link })
  return [row]
}

/** Una proposta da decidere: titolo, le righe che servono e i due pulsanti. */
export function proposalMessage(input: { id: string; title: string; lines: string[]; link: string }): { text: string; keyboard: TelegramKeyboard } {
  const text = [`*${input.title.slice(0, 200)}*`, ...input.lines.filter(Boolean).map((line) => line.slice(0, 300)).slice(0, 8)].join('\n')
  return {
    text: text.slice(0, 3500),
    keyboard: [
      [{ text: '✅ Approva', callback_data: outputData(input.id, 'approved') }, { text: '✖️ Rifiuta', callback_data: outputData(input.id, 'rejected') }],
      [{ text: 'Apri nell’Ufficio', url: input.link }],
    ],
  }
}

/** Le righe utili di una proposta del Direttore (nuovo contatto o partner), senza il JSON. */
export function proposalLines(body: Record<string, any> | null | undefined): string[] {
  if (!body || typeof body !== 'object') return []
  if (body.action === 'create_contact') {
    const c = body.contact || {}
    return [
      [c.name, c.company].filter(Boolean).join(' · '),
      [c.email, c.phone].filter(Boolean).join(' · '),
      c.website || '',
      body.tipo ? `Tipo: ${String(body.tipo).split(' (')[0]}` : '',
      body.perche ? String(body.perche) : '',
      Array.isArray(body.possibili_doppioni) && body.possibili_doppioni.length ? `Attenzione, simili nel CRM: ${body.possibili_doppioni.slice(0, 2).join('; ')}` : '',
    ]
  }
  return [typeof body.message === 'string' ? body.message : '', typeof body.note === 'string' ? body.note : '']
}
