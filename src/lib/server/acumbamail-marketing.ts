/**
 * Wrapper specifici di Speaqi sopra il client Acumbamail.
 *
 * Il trasporto e le primitive vivono in `@/lib/acumbamail`, che non dipende da
 * questo progetto ed è pensato per essere riusato altrove. Qui restano solo i
 * nomi dei campi e le descrizioni delle sequenze Wine e Hospitality.
 */
import {
  addSubscribers,
  callAcumbamail,
  configureListWebhook,
  createCampaign,
  createRecipientList,
  type AcumbamailResponse,
} from '@/lib/acumbamail'

export type { AcumbamailResponse }

/** @deprecated Usa `callAcumbamail` da `@/lib/acumbamail`. */
export const callAcumbamailMarketing = callAcumbamail

const WINE_MERGE_TAGS = ['first_name', 'full_name', 'greeting', 'company', 'wine_url']
const HOSPITALITY_MERGE_TAGS = ['first_name', 'full_name', 'greeting', 'company', 'demo_url']

export async function createWineProjectRecipientList(
  authToken: string,
  name: string,
  senderEmail: string
) {
  return createRecipientList(authToken, {
    name,
    senderEmail,
    description: 'Destinatari temporanei della sequenza automatica Wine Project. Gestita da Speaqi CRM.',
    mergeTags: WINE_MERGE_TAGS,
  })
}

export async function createHospitalityRecipientList(authToken: string, name: string, senderEmail: string) {
  return createRecipientList(authToken, {
    name,
    senderEmail,
    description: 'Lotto isolato della sequenza Hospitality Speaqi. Gestito automaticamente dal CRM.',
    mergeTags: HOSPITALITY_MERGE_TAGS,
  })
}

export async function addCampaignRecipients(
  authToken: string,
  listId: string,
  recipients: Array<{ email: string; firstName: string; fullName: string; greeting: string; company: string; wineUrl: string }>
) {
  return addSubscribers(
    authToken,
    listId,
    recipients.map((recipient) => ({
      email: recipient.email,
      first_name: recipient.firstName,
      full_name: recipient.fullName,
      greeting: recipient.greeting,
      company: recipient.company,
      wine_url: recipient.wineUrl,
    }))
  )
}

export async function addHospitalityCampaignRecipients(
  authToken: string,
  listId: string,
  recipients: Array<{ email: string; firstName: string; fullName: string; greeting: string; company: string; demoUrl: string }>
) {
  return addSubscribers(
    authToken,
    listId,
    recipients.map((recipient) => ({
      email: recipient.email,
      first_name: recipient.firstName,
      full_name: recipient.fullName,
      greeting: recipient.greeting,
      company: recipient.company,
      demo_url: recipient.demoUrl,
    }))
  )
}

export async function createWineProjectCampaign(
  authToken: string,
  input: {
    name: string
    subject: string
    html: string
    listId: string
    fromName: string
    fromEmail: string
  }
) {
  return createCampaign(authToken, input)
}

export async function configureAcumbamailListWebhook(
  authToken: string,
  listId: string,
  callbackUrl: string
) {
  return configureListWebhook(authToken, listId, callbackUrl)
}
