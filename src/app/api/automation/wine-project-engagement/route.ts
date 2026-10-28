import { NextRequest } from 'next/server'
import { collectEmailEvents, fetchAcumbamailFunction, normalizeEmail } from '@/lib/server/acumbamail-api'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { createActivities } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { recordWhatsappEvent } from '@/lib/server/whatsapp-notify'
import { chunk, contactEngagementPatch, engagementRow, engagementRowChanged } from '@/lib/engagement-sync'

/**
 * Quante campagne per giro.
 *
 * Ogni campagna costa due chiamate ad Acumbamail, che ora passano da una coda
 * a 10 richieste al minuto: leggerle tutte e trentuno in un colpo significava
 * ottantadue secondi di attesa e un 429 quasi certo in fondo al giro. Con il
 * cron ogni mezz'ora, otto campagne per volta chiudono il giro completo in un
 * paio d'ore — una statistica di apertura non ha bisogno di essere piu fresca
 * di cosi.
 */
const DEFAULT_CAMPAIGN_LIMIT = 8

type CampaignRow = { user_id: string; campaign_key: string; campaign_id: string | null; name: string | null }

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  const token = process.env.ACUMBAMAIL_AUTH_TOKEN
  if (!token) return Response.json({ error: 'ACUMBAMAIL_AUTH_TOKEN non configurato' }, { status: 500 })
  try {
    const body = await request.json().catch(() => ({}))
    const requested = Number(body?.campaign_limit)
    const campaignLimit = Number.isInteger(requested) && requested > 0 && requested <= 50
      ? requested
      : DEFAULT_CAMPAIGN_LIMIT

    const supabase = createServiceRoleClient()
    // Dalla meno recentemente sincronizzata: la rotazione si mantiene da sola,
    // senza cursori da conservare fra un'esecuzione e l'altra. Ordinare per
    // `updated_at` come prima significava ripescare sempre le stesse campagne
    // in testa e non arrivare mai in fondo.
    const { data: campaigns, error } = await supabase
      .from('acumbamail_campaigns')
      .select('user_id,campaign_key,campaign_id,name')
      .ilike('name', 'Wine Project%')
      .not('campaign_id', 'is', null)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(campaignLimit)
    if (error) throw error

    let updated = 0
    let opensNotified = 0
    let clicksNotified = 0
    const failures: Array<{ campaign_key: string; error: string }> = []

    for (const campaign of (campaigns || []) as CampaignRow[]) {
      try {
        const result = await syncCampaign(supabase, token, campaign)
        updated += result.updated
        opensNotified += result.opensNotified
        clicksNotified += result.clicksNotified
        await supabase.from('acumbamail_campaigns')
          .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
          .eq('user_id', campaign.user_id).eq('campaign_key', campaign.campaign_key)
      } catch (campaignError) {
        // Fallimento isolato per campagna. Prima un solo errore mandava in 500
        // l'intera rotta, e siccome nel workflow n8n questo nodo sta a monte
        // della sincronizzazione delle risposte, la catena si fermava qui: le
        // risposte delle cantine non sono state lette per due settimane.
        const failure = errorMessage(campaignError, 'Sync engagement non riuscito')
        failures.push({ campaign_key: campaign.campaign_key, error: failure })
        console.error(`wine-project-engagement: campagna ${campaign.campaign_key}`, failure)
        // `last_synced_at` avanza comunque: una campagna che fallisce sempre
        // non deve monopolizzare la rotazione e affamare tutte le altre.
        await supabase.from('acumbamail_campaigns')
          .update({ last_synced_at: new Date().toISOString(), last_sync_error: failure.slice(0, 500) })
          .eq('user_id', campaign.user_id).eq('campaign_key', campaign.campaign_key)
      }
    }

    return Response.json({
      ok: failures.length === 0,
      campaigns_checked: campaigns?.length || 0,
      contacts_updated: updated,
      opens_notified: opensNotified,
      clicks_notified: clicksNotified,
      failures,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project engagement sync failed') }, { status: 500 })
  }
}

const PAGE = 1000
const LOOKUP_CHUNK = 200
const UPSERT_CHUNK = 500

async function syncCampaign(supabase: any, token: string, campaign: CampaignRow) {
  const [opensPayload, clicksPayload] = await Promise.all([
    fetchAcumbamailFunction('getCampaignOpeners', token, String(campaign.campaign_id)),
    fetchAcumbamailFunction('getCampaignClicks', token, String(campaign.campaign_id)),
  ])
  const opens = collectEmailEvents(opensPayload)
  const clicks = collectEmailEvents(clicksPayload)
  const emails = [...new Set([...opens.keys(), ...clicks.keys()])]
  if (!emails.length) return { updated: 0, opensNotified: 0, clicksNotified: 0 }
  const now = new Date().toISOString()

  // Righe gia' scritte per questa campagna: si riscrive solo cio' che e' cambiato,
  // in blocchi, invece di un upsert per indirizzo a ogni giro.
  const existing = new Map<string, Record<string, any>>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('acumbamail_campaign_engagements')
      .select('email,name,open_count,click_count,last_open_at')
      .eq('user_id', campaign.user_id).eq('campaign_key', campaign.campaign_key)
      .order('email').range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data || []) existing.set(row.email, row)
    if (!data || data.length < PAGE) break
  }
  const changedRows = emails
    .map((email) => engagementRow(email, opens.get(email), clicks.get(email)))
    .filter((row) => engagementRowChanged(existing.get(row.email), row))
    .map((row) => ({ ...row, user_id: campaign.user_id, campaign_key: campaign.campaign_key, updated_at: now }))
  for (const rows of chunk(changedRows, UPSERT_CHUNK)) {
    const { error } = await supabase.from('acumbamail_campaign_engagements').upsert(rows, { onConflict: 'user_id,campaign_key,email' })
    if (error) throw error
  }

  // Contatti in blocchi con `in`, non una select per indirizzo.
  const byEmail = new Map<string, Array<Record<string, any>>>()
  const normalized = [...new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean) as string[])]
  for (const batch of chunk(normalized, LOOKUP_CHUNK)) {
    const { data, error } = await supabase.from('contacts')
      .select('id,name,company,email,responsible,assigned_agent,event_tag,list_name,email_open_count,email_click_count,last_email_open_at,last_email_click_at')
      .eq('user_id', campaign.user_id).eq('event_tag', 'wine-project').in('email', batch)
    if (error) throw error
    for (const contact of data || []) {
      const list = byEmail.get(contact.email) || []
      list.push(contact)
      byEmail.set(contact.email, list)
    }
  }

  let updated = 0
  let opensNotified = 0
  let clicksNotified = 0
  const campaignLabel = campaign.name || 'Wine Project'

  for (const email of emails) {
    const key = normalizeEmail(email)
    const matches = key ? byEmail.get(key) : undefined
    // Due schede Wine con lo stesso indirizzo: come prima (maybeSingle) non si
    // sceglie a caso a quale attribuire l'apertura.
    if (!matches || matches.length !== 1) continue
    const contact = matches[0]
    const open = opens.get(email)
    const click = clicks.get(email)
    const { patch, newOpens, newClicks } = contactEngagementPatch(contact, open, click)
    if (!patch) continue

    const { error } = await supabase.from('contacts').update({ ...patch, updated_at: now }).eq('id', contact.id)
    if (error) throw error
    updated += 1

    // Solo l'incremento e' un fatto nuovo. Il sync rilegge a ogni giro gli
    // stessi apritori: notificare sul valore assoluto avrebbe rimandato la
    // stessa apertura ogni mezz'ora, per sempre. Quando il webhook della lista
    // ha gia' registrato l'evento i contatori coincidono e qui non parte nulla.
    if (newOpens > 0) {
      await recordEngagement(supabase, campaign.user_id, contact, 'email_open', newOpens, campaignLabel, open?.lastAt || now)
      opensNotified += 1
    }
    if (newClicks > 0) {
      await recordEngagement(supabase, campaign.user_id, contact, 'email_click', newClicks, campaignLabel, click?.lastAt || now)
      clicksNotified += 1
    }
  }

  return { updated, opensNotified, clicksNotified }
}

/**
 * Un'apertura vale due cose: una riga nel percorso datato della cantina e una
 * riga nel riepilogo WhatsApp. Finora il sync aggiornava solo i contatori,
 * quindi "chi ha reagito" mostrava un numero senza una data accanto e il
 * riepilogo parlava solo di invii.
 */
async function recordEngagement(
  supabase: any,
  userId: string,
  contact: Record<string, any>,
  type: 'email_open' | 'email_click',
  quantity: number,
  campaignLabel: string,
  occurredAt: string
) {
  const label = type === 'email_open' ? 'aperta' : 'cliccata'
  const detail = `Wine Project: email ${label} (${campaignLabel}).`
  await createActivities(supabase, [{
    user_id: userId,
    contact_id: contact.id,
    type,
    content: detail,
    metadata: { provider: 'acumbamail', source: 'wine-project-engagement', campaign: campaignLabel, quantity },
  }])
  await recordWhatsappEvent(supabase, {
    userId,
    type,
    contact: contact as any,
    detail,
    campaign: campaignLabel,
    source: 'wine_project',
    quantity,
    occurredAt,
  })
}
