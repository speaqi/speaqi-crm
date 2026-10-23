import { agencyModel, buildGenerateRequest, interpretGenerate } from '../agency-agent'
import { claimGeneration, createPresentation, createProject, getSettings, listCategories, runGeneration, type PresentationRow, type ProjectRow } from '../agency'
import { AGENCY_STAGE_LABELS } from '@/lib/agency'
import { agencyEmail, agencyPipelineCounts, agencyQueue, agencyServices, agencyTodo } from '@/lib/office/agency'
import { officeRomeDay } from '@/lib/office/finance'
import { safePublicUrl } from '@/lib/tourism'
import { BudgetExceeded, callModel, type AgentContext, type AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { officeRows } from '../office-read'
import { selectByIdChunks } from '../http'
import { addOfficeOutputOnce, officeEmailDraft } from './shared'
import type { CRMContact, Quote } from '@/types'

type Item = { id: string; item_key: string; project_id: string; presentation_id: string; generation_state: 'pending' | 'running' | 'done' | 'uncertain' }
const checked = (result: any) => { if (result.error) throw result.error; return result.data }
const time = (value: unknown) => { const n = Date.parse(String(value || '')); return Number.isFinite(n) ? n : 0 }
const ilike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)
const MAX_ITEMS = 2

async function pipeline(admin: any, userId: string) {
  const projects = await officeRows<ProjectRow>(admin, userId, 'agency_projects')
  const ids = projects.map((p) => p.id)
  const byProject = <T>(table: string, column: string) => selectByIdChunks<T>(ids, 100, (group, range) =>
    admin.from(table).select('*').eq('user_id', userId).in(column, group).order('id').range(range.from, range.to))
  const contactIds = [...new Set(projects.map((p) => p.contact_id).filter((id): id is string => Boolean(id)))]
  const byContact = <T>(table: string, column: string) => selectByIdChunks<T>(contactIds, 100, (group, range) =>
    admin.from(table).select('*').eq('user_id', userId).in(column, group).order('id').range(range.from, range.to))
  const [presentations, quotes, contacts, activities, items, deliveries] = await Promise.all([
    byProject<PresentationRow>('agency_presentations', 'project_id'), byProject<Quote & { agency_project_id: string }>('quotes', 'agency_project_id'),
    byContact<CRMContact>('contacts', 'id'), byContact<{ contact_id: string; created_at: string }>('activities', 'contact_id'),
    officeRows<Item>(admin, userId, 'office_agency_items'), officeRows<{ delivery_key: string }>(admin, userId, 'office_agency_deliveries', 'delivery_key', undefined, 'delivery_key'),
  ])
  const signatures = await selectByIdChunks<{ quote_id: string }>(quotes.map((q) => q.id), 100, (group, range) =>
    admin.from('quote_signatures').select('id,quote_id').eq('user_id', userId).in('quote_id', group).order('id').range(range.from, range.to))
  return { projects, presentations, quotes, contacts, activities, items, delivered: new Set(deliveries.map((d) => d.delivery_key)), signed: new Set(signatures.map((s) => s.quote_id)) }
}

async function presentationReport(admin: any, ctx: AgentContext, row: PresentationRow, base: string, hasQuote: boolean) {
  const todo = agencyTodo(row.slides, hasQuote)
  await addOfficeOutputOnce(admin, ctx, `agency:review:${row.id}:v${row.version}:quote:${row.quote_id || 'missing'}`, {
    kind: 'report', title: `Agenzia: ${row.title} — da rivedere`, target_table: 'agency_presentations', target_id: row.id,
    body: { titolo: row.title, errore: row.status === 'failed' ? row.error : null, presentazione: `${base}/agency/presentazioni/${row.id}`, segnaposto: todo.count, dove: todo.locations,
      preventivo_mancante: !hasQuote, crea_preventivo: `${base}/preventivi?agency_project=${row.project_id}`,
      nota: 'Rivedi e approva nella pagina Agency. Approvare questo rapporto non approva la presentazione e non invia nulla.' },
  })
}

/** Tutto il lavoro a pagamento attraversa callModel; nessun fetch del handler verso mappe o provider. */
export function agencyHandler(admin: any, options: { now?: () => Date; generate?: typeof runGeneration } = {}): AgentHandler {
  return async (ctx) => {
    const userId = ctx.agent.user_id, now = options.now?.() || new Date(), day = officeRomeDay(now)
    const configuredBase = safePublicUrl(process.env.APP_BASE_URL || 'https://crm.speaqi.com')
    if (!configuredBase || new URL(configuredBase).protocol !== 'https:' || new URL(configuredBase).pathname !== '/' || new URL(configuredBase).search || new URL(configuredBase).hash) throw new Error('APP_BASE_URL deve essere una origine HTTPS pubblica')
    const base = new URL(configuredBase).origin
    const data = await pipeline(admin, userId)
    const settings = await getSettings(admin, userId)
    const { entries, rejected } = agencyQueue(ctx.agent.settings.queue || [])
    const oldQuotes: typeof data.quotes = []
    for (const q of data.quotes) {
      if (q.status !== 'sent' || q.payment_state === 'paid' || data.signed.has(q.id) || !time(q.sent_at) || time(q.sent_at) >= now.getTime() - 7 * 86400_000) continue
      const contact = data.contacts.find((c) => c.id === q.contact_id)
      const reply = contact?.email ? checked(await admin.from('gmail_messages').select('id').eq('user_id', userId).eq('direction', 'inbound')
        .ilike('from_email', ilike(agencyEmail(contact.email))).gt('sent_at', q.sent_at).limit(1)) : []
      const linkedReply = q.contact_id ? checked(await admin.from('gmail_messages').select('id').eq('user_id', userId).eq('direction', 'inbound')
        .eq('contact_id', q.contact_id).gt('sent_at', q.sent_at).limit(1)) : []
      if (!reply?.length && !linkedReply?.length) oldQuotes.push(q)
    }
    const stale = data.projects.filter((project) => {
      if (['won', 'lost', 'on_hold'].includes(project.stage)) return false
      const activity = data.activities.filter((a) => a.contact_id === project.contact_id).map((a) => time(a.created_at))
      return activity.reduce((latest, at) => Math.max(latest, at), Math.max(time(project.updated_at), time(project.created_at))) < now.getTime() - 10 * 86400_000
    })
    await addOfficeOutputOnce(admin, ctx, `agency:day:${day}`, { kind: 'report', title: `Agenzia — pipeline del ${day}`, body: {
      per_stato: Object.entries(agencyPipelineCounts(data.projects)).map(([stage, count]) => ({ stato: AGENCY_STAGE_LABELS[stage as keyof typeof AGENCY_STAGE_LABELS], opportunita: count })),
      presentazioni_da_approvare: data.presentations.filter((p) => p.status === 'ready').map((p) => ({ titolo: p.title, link: `${base}/agency/presentazioni/${p.id}` })),
      ferme_oltre_10_giorni: stale.map((p) => ({ titolo: p.title, link: `${base}/agency/progetti/${p.id}` })),
      preventivi_senza_risposta_oltre_7_giorni: oldQuotes.map((q) => ({ id: q.id, numero: q.quote_number, opportunita: q.agency_project_id })),
      elementi_da_verificare: rejected, nota: 'Fotografia della pipeline all’avvio. Report e follow-up deterministici: nessuna chiamata al modello, nessun invio.' },
    })
    for (const row of data.presentations.filter((p) => p.status === 'ready')) {
      await presentationReport(admin, ctx, row, base, data.quotes.some((q) => q.id === row.quote_id && q.agency_project_id === row.project_id))
    }
    let followups = 0
    for (const quote of oldQuotes.sort((a, b) => time(a.sent_at) - time(b.sent_at))) {
      const key = `agency:followup:${quote.id}`
      if (data.delivered.has(key)) continue
      // Prima la consegna della proposta approvata ancora presente nella coda.
      const queued = entries.some((entry) => entry.agency_project_id === quote.agency_project_id || entry.contact_id === quote.contact_id)
      if (queued && data.presentations.some((p) => p.project_id === quote.agency_project_id && p.quote_id === quote.id && p.status === 'approved' && !data.delivered.has(`agency:proposal:${p.id}`))) continue
      const contact = data.contacts.find((c) => c.id === quote.contact_id)
      if (!contact?.email || contact.hidden || contact.email_unsubscribed_at || contact.contact_scope !== 'crm') continue
      const text = `Buongiorno ${contact.name || ''},\n\nriprendo il preventivo ${quote.quote_number} per ${data.projects.find((p) => p.id === quote.agency_project_id)?.title || 'il progetto'}. Hai avuto modo di valutarlo? Se vuoi, possiamo chiarire insieme i prossimi passi.\n\n${settings.signature || settings.name}`
      const draft = await officeEmailDraft(admin, ctx, { contactId: contact.id, key, subject: `Un aggiornamento sul preventivo ${quote.quote_number}`, text,
        note: `Agenzia: preventivo inviato il ${String(quote.sent_at).slice(0, 10)}, senza risposta da oltre 7 giorni. Fonte: quotes/${quote.id}. Solo bozza.` })
      if (draft.reason === 'daily_cap') break
      if (draft.created && draft.id) {
        followups++
        await draftOutput(admin, ctx, key, draft.id, `Follow-up Agenzia: ${contact.company || contact.name}`)
      }
      if (followups >= 5) break
    }

    let worked = 0, generated = 0
    for (const entry of entries) {
      if (worked >= MAX_ITEMS) break
      const previous = data.items.find((item) => item.item_key === entry.key)
      if (previous?.generation_state === 'running' || previous?.generation_state === 'uncertain') {
        await addOfficeOutputOnce(admin, ctx, `agency:uncertain:${previous.id}`, { kind: 'report', title: 'Agenzia: generazione da riconciliare',
          body: { opportunita: `${base}/agency/progetti/${previous.project_id}`, nota: 'Tentativo già avviato: controlla presentazione e riserva prima di riprovare. Nessuna nuova generazione automatica.' } })
        continue
      }
      const existingProject = data.projects.find((p) => p.id === (previous?.project_id || entry.agency_project_id))
        || (!entry.agency_project_id ? data.projects.filter((p) => p.contact_id === entry.contact_id).sort((a, b) => time(b.created_at) - time(a.created_at))[0] : null)
      if (existingProject && ['won', 'lost', 'on_hold'].includes(existingProject.stage)) continue
      if (previous?.generation_state === 'done') {
        const latest = data.presentations.filter((p) => p.project_id === previous.project_id).sort((a, b) => time(b.created_at) - time(a.created_at))[0]
        const quote = data.quotes.find((q) => q.id === latest?.quote_id)
        if (!latest || latest.status !== 'approved' || !latest.approved_at || !quote || !['sent', 'accepted'].includes(quote.status) || data.delivered.has(`agency:proposal:${latest.id}`)) continue
      }
      const existingPresentation = existingProject ? data.presentations.filter((p) => p.project_id === existingProject.id).sort((a, b) => time(b.created_at) - time(a.created_at))[0] : null
      if (existingPresentation?.status === 'generating') { ctx.log(`Presentazione ${existingPresentation.id} già in corso`); continue }
      if (existingPresentation?.status === 'failed' && existingPresentation.error !== new BudgetExceeded().message) {
        await presentationReport(admin, ctx, existingPresentation, base, Boolean(existingPresentation.quote_id))
        continue
      }
      worked++
      const item: Item = checked(await admin.rpc('claim_office_agency_item', { p_run_id: ctx.runId, p_key: entry.key, p_project_id: existingProject?.id || entry.agency_project_id || null }))
      let project: ProjectRow | null = checked(await admin.from('agency_projects').select('*').eq('user_id', userId).eq('id', item.project_id).maybeSingle())
      if (!project) {
        if (!entry.contact_id) throw new Error('Opportunità Agency non disponibile')
        const categories = await listCategories(admin, userId)
        project = await createProject(admin, userId, { contact_id: entry.contact_id, brief: entry.brief, services: agencyServices(entry.services || [], categories) }, item.project_id)
      }
      let presentation: PresentationRow | null = checked(await admin.from('agency_presentations').select('*').eq('user_id', userId).eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle())
      if (!presentation) presentation = await createPresentation(admin, project, {}, item.presentation_id)
      if ((presentation.status === 'draft' || (presentation.status === 'failed' && presentation.error === new BudgetExceeded().message)) && !presentation.generated_at && item.generation_state === 'pending') {
        const claimed = checked(await admin.rpc('claim_office_agency_generation', { p_run_id: ctx.runId, p_item_id: item.id }))
        if (claimed) {
          let providerError: unknown
          let claimedPresentation: PresentationRow
          try { claimedPresentation = await claimGeneration(admin, presentation, true) }
          catch (error) {
            checked(await admin.rpc('finish_office_agency_generation', { p_run_id: ctx.runId, p_item_id: item.id, p_state: 'pending' }))
            if (String(error).includes('already running')) { ctx.log('Presentazione già lavorata da un altro processo'); continue }
            throw error
          }
          presentation = await (options.generate || runGeneration)(admin, admin, claimedPresentation, undefined, { textOnly: true, generate: async (args) => {
            try {
              const model = agencyModel(), request = buildGenerateRequest(args, model)
              const result = await callModel(ctx, { model, input: JSON.stringify(request.input), maxOutputTokens: Math.min(request.max_output_tokens, 12000),
                jsonSchema: { name: 'agency_presentation', schema: request.text.format.schema } })
              return interpretGenerate(JSON.parse(result.text), args, model)
            } catch (error) { providerError = error; throw error }
          } })
          checked(await admin.rpc('finish_office_agency_generation', { p_run_id: ctx.runId, p_item_id: item.id,
            p_state: providerError instanceof BudgetExceeded ? 'pending' : presentation.status === 'ready' ? 'done' : 'uncertain' }))
          if (providerError) throw providerError
          if (presentation.status === 'ready') generated++
        }
      } else if (['ready', 'approved'].includes(presentation.status) && item.generation_state === 'pending') {
        checked(await admin.rpc('finish_office_agency_generation', { p_run_id: ctx.runId, p_item_id: item.id, p_state: 'done' }))
      }
      const quote = presentation.quote_id ? checked(await admin.from('quotes').select('*').eq('user_id', userId).eq('id', presentation.quote_id).eq('agency_project_id', project.id).maybeSingle()) : null
      if (['ready', 'failed'].includes(presentation.status)) await presentationReport(admin, ctx, presentation, base, Boolean(quote))
      else if (presentation.status === 'approved' && presentation.approved_at && quote && ['sent', 'accepted'].includes(quote.status) && project.contact_id) {
        const key = `agency:proposal:${presentation.id}`
        const draft = await officeEmailDraft(admin, ctx, { contactId: project.contact_id, key, subject: presentation.title,
          text: `Buongiorno,\n\necco la proposta per ${project.title}:\n${base}/proposta/${presentation.public_token}\n\n${settings.signature || settings.name}`,
          note: `Presentazione approvata dal titolare; preventivo ${quote.quote_number} ${quote.status}. Nessun invio.` })
        if (draft.created && draft.id) await draftOutput(admin, ctx, key, draft.id, `Proposta Agenzia: ${project.title}`)
      }
    }
    return { summary: `Agenzia: ${worked} elementi lavorati, ${generated} presentazioni preparate, ${followups} follow-up in bozza. Nessun invio.` }
  }
}

async function draftOutput(admin: any, ctx: AgentContext, key: string, id: string, title: string) {
  await addOfficeOutputOnce(admin, ctx, `agency:email:${key}`, { kind: 'draft_email', title,
    body: { email_draft_id: id, nota: 'Bozza pending in Email: da rivedere e inviare a mano.' }, target_table: 'email_drafts', target_id: id })
}
export const runAgency: AgentHandler = (ctx) => agencyHandler(createServiceRoleClient())(ctx)
