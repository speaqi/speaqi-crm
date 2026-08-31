import { callAcumbamail, acumbamailResponseId } from './client'

/**
 * Tipo di campo accettato da `addMergeTag`.
 *
 * Vale solo `text` per le stringhe. `char`, `string` e `varchar` sembrano
 * plausibili e sono tutti rifiutati con 400 "<tipo> is not a valid data type":
 * poiché una risposta non 2xx interrompe la creazione della lista, un tipo
 * sbagliato qui blocca l'intera campagna prima ancora dei destinatari.
 */
export type AcumbamailMergeTagType = 'text' | 'number' | 'date' | 'boolean'

export type CreateRecipientListInput = {
  name: string
  senderEmail: string
  description?: string
  /** Campi personalizzati usati dai segnaposto del template. */
  mergeTags?: string[]
  mergeTagType?: AcumbamailMergeTagType
}

/**
 * Crea una lista e vi registra i campi personalizzati.
 *
 * I merge tag vanno creati PRIMA di aggiungere i destinatari: i valori
 * inviati per campi inesistenti vengono scartati in silenzio, e la campagna
 * parte con i segnaposto vuoti.
 */
export async function createRecipientList(authToken: string, input: CreateRecipientListInput): Promise<string> {
  const payload = await callAcumbamail('createList', authToken, {
    name: input.name,
    sender_email: input.senderEmail,
    description: input.description || '',
  })
  const listId = acumbamailResponseId('createList', payload)

  for (const fieldName of input.mergeTags || []) {
    await callAcumbamail('addMergeTag', authToken, {
      list_id: listId,
      field_name: fieldName,
      field_type: input.mergeTagType || 'text',
    })
  }

  return listId
}

export type AcumbamailSubscriber = {
  email: string
  /** Chiavi corrispondenti ai merge tag della lista. */
  [field: string]: string | number | null | undefined
}

/**
 * Aggiunge o aggiorna destinatari in blocco.
 *
 * Restituisce un array `[{ email, id }]`: non passa da
 * `acumbamailResponseId`, che qui fallirebbe. Il controllo di stato è già in
 * `callAcumbamail`.
 */
export async function addSubscribers(
  authToken: string,
  listId: string,
  subscribers: AcumbamailSubscriber[]
) {
  return callAcumbamail('batchAddSubscribers', authToken, {
    list_id: listId,
    update_subscriber: 1,
    complete_json: 1,
    subscribers_data: subscribers,
  })
}

export async function getListStats(authToken: string, listId: string) {
  return callAcumbamail('getListStats', authToken, { list_id: listId })
}

export async function getLists(authToken: string) {
  return callAcumbamail('getLists', authToken)
}

export async function deleteList(authToken: string, listId: string) {
  return callAcumbamail('deleteList', authToken, { list_id: listId })
}

/** Abilita il callback su tutti gli eventi della lista. */
export async function configureListWebhook(authToken: string, listId: string, callbackUrl: string) {
  return callAcumbamail('configListWebhook', authToken, {
    list_id: listId,
    callback_url: callbackUrl,
    subscribes: 1,
    unsubscribes: 1,
    hard_bounce: 1,
    soft_bounce: 1,
    complain: 1,
    opens: 1,
    click: 1,
    active: 1,
  })
}
