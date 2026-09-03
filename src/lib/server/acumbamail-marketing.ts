const ACUMBAMAIL_API_URL = 'https://acumbamail.com/api/1'

type ApiResponse = Record<string, unknown> | unknown[] | string | number

function responseId(payload: ApiResponse) {
  if (typeof payload === 'string' || typeof payload === 'number') {
    const value = String(payload).trim()
    if (value) return value
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const value = record.id || record.campaign_id || record.list_id
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
    for (const key of ['data', 'result', 'response']) {
      const nested = record[key]
      if (nested && (typeof nested === 'object' || typeof nested === 'string' || typeof nested === 'number')) {
        try { return responseId(nested as ApiResponse) } catch {}
      }
    }
    const keys = Object.keys(record)
    if (keys.length === 1 && /^\d+$/.test(keys[0])) return keys[0]
  }
  if (Array.isArray(payload) && payload.length === 1) {
    try { return responseId(payload[0] as ApiResponse) } catch {}
  }
  throw new Error('Acumbamail non ha restituito l’identificativo dell’operazione.')
}

export async function callAcumbamailMarketing(
  functionName: string,
  authToken: string,
  data: Record<string, unknown> = {}
): Promise<ApiResponse> {
  const form = new URLSearchParams()
  const inputPayload = { ...data, auth_token: authToken, response_type: 'json' }
  for (const [key, value] of Object.entries(inputPayload)) {
    form.set(key, value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))
  }
  const response = await fetch(`${ACUMBAMAIL_API_URL}/${functionName}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
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

  // I tag vengono usati per saluto, oggetto e CTA senza dipendere da campi
  // preesistenti nella lista Acumbamail.
  for (const fieldName of ['first_name', 'full_name', 'greeting', 'company', 'wine_url']) {
    await callAcumbamailMarketing('addMergeTag', authToken, {
      list_id: listId,
      field_name: fieldName,
      field_type: 'text',
    })
  }
  return listId
}

export async function createHospitalityRecipientList(authToken: string, name: string, senderEmail: string) {
  const payload = await callAcumbamailMarketing('createList', authToken, {
    name,
    sender_email: senderEmail,
    description: 'Lotto isolato della sequenza Hospitality Speaqi. Gestito automaticamente dal CRM.',
  })
  const listId = responseId(payload)
  for (const fieldName of ['first_name', 'full_name', 'greeting', 'company', 'demo_url']) {
    await callAcumbamailMarketing('addMergeTag', authToken, {
      list_id: listId,
      field_name: fieldName,
      field_type: 'text',
    })
  }
  return listId
}

export async function addCampaignRecipients(
  authToken: string,
  listId: string,
  recipients: Array<{ email: string; firstName: string; fullName: string; greeting: string; company: string; wineUrl: string }>
) {
  return addRecipientsAndWait(authToken, listId, recipients.map((recipient) => ({
      email: recipient.email,
      first_name: recipient.firstName,
      full_name: recipient.fullName,
      greeting: recipient.greeting,
      company: recipient.company,
      wine_url: recipient.wineUrl,
    })))
}

export async function addHospitalityCampaignRecipients(
  authToken: string,
  listId: string,
  recipients: Array<{ email: string; firstName: string; fullName: string; greeting: string; company: string; demoUrl: string }>
) {
  return addRecipientsAndWait(authToken, listId, recipients.map((recipient) => ({
      email: recipient.email,
      first_name: recipient.firstName,
      full_name: recipient.fullName,
      greeting: recipient.greeting,
      company: recipient.company,
      demo_url: recipient.demoUrl,
    })))
}

function subscriberCount(payload: ApiResponse) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0
  const value = (payload as Record<string, unknown>).total_subscribers
  const count = Number(value)
  return Number.isFinite(count) ? count : 0
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function addRecipientsAndWait(
  authToken: string,
  listId: string,
  subscribers: Array<Record<string, string>>
) {
  const add = () => callAcumbamailMarketing('batchAddSubscribers', authToken, {
    list_id: listId,
    update_subscriber: 1,
    complete_json: 1,
    subscribers_data: subscribers,
  })

  let result = await add()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const stats = await callAcumbamailMarketing('getListStats', authToken, { list_id: listId })
    if (subscriberCount(stats) >= subscribers.length) return result

    // L'API puo rispondere 200 al batch prima di aver persistito le righe.
    // Un secondo batch e idempotente (update_subscriber=1) e sblocca il caso.
    if (attempt === 1) result = await add()
    await wait(1000)
  }

  throw new Error(`Acumbamail: lista ${listId} ancora vuota dopo il caricamento di ${subscribers.length} destinatari`)
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
