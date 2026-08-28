const ACUMBAMAIL_API_URL = 'https://acumbamail.com/api/1'

type ApiResponse = Record<string, unknown> | unknown[]

function responseId(payload: ApiResponse) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>).id || (payload as Record<string, unknown>).campaign_id
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  throw new Error('Acumbamail non ha restituito l’identificativo dell’operazione.')
}

export async function callAcumbamailMarketing(
  functionName: string,
  authToken: string,
  data: Record<string, unknown> = {}
): Promise<ApiResponse> {
  const response = await fetch(`${ACUMBAMAIL_API_URL}/${functionName}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, auth_token: authToken, response_type: 'json' }),
    cache: 'no-store',
  })
  const raw = await response.text()
  let payload: ApiResponse = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { raw }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' ? JSON.stringify(payload).slice(0, 500) : raw.slice(0, 500)
    throw new Error(`Acumbamail ${functionName} (${response.status}): ${message}`)
  }
  return payload
}

export async function createWineProjectRecipientList(
  authToken: string,
  name: string,
  senderEmail: string
) {
  const payload = await callAcumbamailMarketing('createList', authToken, {
    name,
    sender_email: senderEmail,
    description: 'Destinatari temporanei della sequenza automatica Wine Project. Gestita da Speaqi CRM.',
  })
  const listId = responseId(payload)

  // I tag diventano *|FIRST_NAME|*, *|COMPANY|* e *|WINE_URL|* nel contenuto.
  for (const fieldName of ['first_name', 'company', 'wine_url']) {
    await callAcumbamailMarketing('addMergeTag', authToken, {
      list_id: listId,
      field_name: fieldName,
      field_type: 'char',
    })
  }
  return listId
}

export async function addCampaignRecipients(
  authToken: string,
  listId: string,
  recipients: Array<{ email: string; firstName: string; company: string; wineUrl: string }>
) {
  return callAcumbamailMarketing('batchAddSubscribers', authToken, {
    list_id: listId,
    update_subscriber: 1,
    complete_json: 1,
    subscribers_data: recipients.map((recipient) => ({
      email: recipient.email,
      first_name: recipient.firstName,
      company: recipient.company,
      wine_url: recipient.wineUrl,
    })),
  })
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
  const payload = await callAcumbamailMarketing('createCampaign', authToken, {
    name: input.name,
    from_name: input.fromName,
    from_email: input.fromEmail,
    lists: [Number(input.listId)],
    content: input.html,
    subject: input.subject,
    tracking_urls: 1,
    https: 1,
    complete_json: 1,
  })
  return responseId(payload)
}

export async function configureAcumbamailListWebhook(
  authToken: string,
  listId: string,
  callbackUrl: string
) {
  return callAcumbamailMarketing('configListWebhook', authToken, {
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
