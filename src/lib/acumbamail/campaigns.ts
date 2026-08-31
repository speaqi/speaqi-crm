import { callAcumbamail, acumbamailResponseId, ACUMBAMAIL_API_URL } from './client'

export type CreateCampaignInput = {
  name: string
  subject: string
  /** HTML completo del messaggio. I segnaposto usano i merge tag della lista. */
  html: string
  listId: string
  fromName: string
  fromEmail: string
  /** Riscrive i link per tracciare i click. Default: attivo. */
  trackUrls?: boolean
}

/**
 * Crea una campagna e la INVIA.
 *
 * Non esiste uno stato di bozza in questa chiamata: al ritorno le email sono
 * già in consegna. Ogni controllo — destinatari giusti, testo giusto, lista
 * non vuota — va fatto prima, perché dopo non c'è modo di fermarla.
 */
export async function createCampaign(authToken: string, input: CreateCampaignInput): Promise<string> {
  const payload = await callAcumbamail('createCampaign', authToken, {
    name: input.name,
    from_name: input.fromName,
    from_email: input.fromEmail,
    lists: [Number(input.listId)],
    content: input.html,
    subject: input.subject,
    tracking_urls: input.trackUrls === false ? 0 : 1,
    https: 1,
    complete_json: 1,
  })
  return acumbamailResponseId('createCampaign', payload)
}

export async function getCampaigns(authToken: string) {
  return callAcumbamail('getCampaigns', authToken, { complete_json: 1 })
}

/**
 * Legge una funzione di statistica per campagna: `getCampaignTotalInformation`,
 * `getCampaignOpeners`, `getCampaignClicks` e simili condividono la stessa
 * firma `campaign_id`.
 */
export async function fetchCampaignStats(functionName: string, authToken: string, campaignId: string) {
  const params = new URLSearchParams()
  params.set('auth_token', authToken)
  params.set('campaign_id', campaignId)
  params.set('response_type', 'json')

  const response = await fetch(`${ACUMBAMAIL_API_URL}/${functionName}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    cache: 'no-store',
  })

  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    throw new Error(`Acumbamail ${functionName} failed (${response.status})`)
  }

  return payload
}
