import { safePublicUrl } from '@/lib/tourism'
import { officeIsNaples } from '@/lib/office/director'
import { deckPlaceholders, presentationFixes, presentationQueue, type PresentationEvidence, type PresentationQueueItem } from '@/lib/office/presentations'
import { callModel, type AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { officeRows } from '../office-read'
import { addPhotosToDeck, createDeck, generateIntoDeck, type DeckRow, type PhotoFinder } from '../tourism-decks'
import { directorPhotoFiles } from '../office-director-photos'
import { buildAgentRequest, validateDeckAgentResult } from '../tourism-deck-agent'
import { addOfficeOutputOnce } from './shared'
import { sendDeckToTelegram } from '../office-deck-telegram'

const checked = (result: any) => { if (result.error) throw result.error; return result.data }

/** L'agente delle slide che passa dal budget dell'ufficio (riserva prima, saldo dopo), senza retry. */
export function officeDeckAgent(ctx: Parameters<AgentHandler>[0], model: typeof callModel = callModel) {
  return async (args: Parameters<typeof buildAgentRequest>[0]) => {
    const request = buildAgentRequest(args, ctx.agent.model)
    const result = await model(ctx, { model: ctx.agent.model, input: JSON.stringify(request.input), maxOutputTokens: request.max_output_tokens,
      jsonSchema: { name: 'tourism_deck', schema: request.text.format.schema } })
    return validateDeckAgentResult(args, { output_text: result.text }, ctx.agent.model)
  }
}

/** Generazioni per corsa: ognuna costa una chiamata, il tetto lo decide il titolare (settings.max_per_run). */
export function presentationsPerRun(settings: Record<string, unknown> | null | undefined) {
  const raw = Number(settings?.max_per_run)
  return Number.isInteger(raw) && raw >= 1 ? Math.min(10, raw) : 5
}
export async function presentationEntities(admin: any, userId: string, item: PresentationQueueItem) {
  const entity = checked(await admin.from('tourism_entities').select('*').eq('user_id', userId).eq('id', item.entity_id).maybeSingle())
  if (!entity || entity.kind !== 'organization' || entity.status !== 'VERIFIED' || entity.disabled) throw new Error('Ente non verificato o disabilitato')
  let destinationId = item.destination_id
  if (!destinationId) {
    const relations = checked(await admin.from('tourism_relations').select('to_id,evidence_id').eq('user_id', userId).eq('from_id', entity.id).in('relation', ['COVERS', 'MANAGES', 'PROMOTES']).limit(100)) || []
    const ids = [...new Set<string>(relations.map((r: any) => r.evidence_id))]
    const evidence = ids.length ? checked(await admin.from('tourism_evidence').select('id').eq('user_id', userId).eq('status', 'VERIFIED').in('id', ids)) || [] : []
    const destinations = [...new Set<string>(relations.filter((r: any) => evidence.some((e: any) => e.id === r.evidence_id)).map((r: any) => r.to_id))]
    if (destinations.length !== 1) throw new Error('Nessuna destinazione unica con un legame verificato (copre, gestisce o promuove): chiedi la presentazione al Direttore, che la attiva')
    destinationId = destinations[0]
  }
  const destination = checked(await admin.from('tourism_entities').select('*').eq('user_id', userId).eq('id', destinationId).maybeSingle())
  if (!destination || destination.kind !== 'place' || destination.status !== 'VERIFIED' || destination.disabled) throw new Error('Destinazione non verificata o disabilitata')
  if (officeIsNaples(entity.name, destination.name)) throw new Error('Napoli esclusa dalle presentazioni dell’ufficio')
  return { entity, destination }
}

export function presentationsHandler(admin: any, options: {
  model?: typeof callModel; create?: typeof createDeck; generate?: typeof generateIntoDeck; findPhotos?: PhotoFinder
} = {}): AgentHandler {
  return async (ctx) => {
    const userId = ctx.agent.user_id
    const base = process.env.APP_BASE_URL || 'https://crm.speaqi.com'
    const publicBase = safePublicUrl(base)
    if (!publicBase || new URL(publicBase).protocol !== 'https:' || new URL(publicBase).pathname !== '/' || new URL(publicBase).search || new URL(publicBase).hash) throw new Error('APP_BASE_URL deve essere una origine HTTPS pubblica')
    const queue = presentationQueue(ctx.agent.settings.queue || [])
    // Recupera soltanto bozze già approvate. Non genera deck né chiama modelli.
    const approved = await officeRows<{ id: string }>(admin, userId, 'office_presentation_tasks', 'id', (q) => q.is('email_prepared_at', null).eq('state', 'ready'))
    for (const task of approved) {
      const email = checked(await admin.rpc('prepare_office_presentation_email', { p_deck_id: task.id, p_user_id: userId }))
      if (['verified_email_missing', 'crm_contact_missing', 'pending_draft'].includes(email?.reason)) await addOfficeOutputOnce(admin, ctx, `presentation:email:${task.id}:${email.reason}`, {
        kind: 'report', title: 'Presentazione: bozza email da completare', target_table: 'tourism_decks', target_id: task.id,
        body: { deck_id: task.id, reason: email.reason, message: 'Verifica email con fonte, collegamento CRM e bozze già pendenti. Nessun invio eseguito.' }
      })
    }
    let generated = 0; let warnings = 0; let spentAttempts = 0
    const perRun = presentationsPerRun(ctx.agent.settings)
    for (const item of queue) {
      let source: Awaited<ReturnType<typeof presentationEntities>>
      try { source = await presentationEntities(admin, userId, item) }
      catch (error) {
        warnings++
        await addOfficeOutputOnce(admin, ctx, `presentation:source:${item.entity_id}:${item.destination_id || ''}`, {
          kind: 'report', title: 'Presentazioni: dati da completare', body: { entity_id: item.entity_id, message: error instanceof Error ? error.message : 'Fonte non disponibile' }
        }); continue
      }
      const { entity, destination } = source
      const evidence: PresentationEvidence[] = checked(await admin.from('tourism_evidence').select('id,entity_id,status,fields,source_url,excerpt')
        .eq('user_id', userId).eq('status', 'VERIFIED').in('entity_id', [entity.id, destination.id]).order('id').limit(200)) || []
      const claim = checked(await admin.rpc('claim_office_presentation', { p_run_id: ctx.runId, p_entity_id: entity.id, p_destination_id: destination.id, p_public_base: new URL(publicBase).origin }))
      let deck: DeckRow | null = checked(await admin.from('tourism_decks').select('*').eq('user_id', userId).eq('id', claim.task.id).maybeSingle())
      if (claim.claimed) {
        // Il claim persistente precede creazione e costo: un timeout non ripaga.
        const notes = JSON.stringify({ ente: entity.name, destinazione: destination.name, evidenze: evidence.map((e) => ({ fields: e.fields, excerpt: e.excerpt, source_url: e.source_url })) }).slice(0, 30000)
        deck = await (options.create || createDeck)(admin, userId, {
          entity_id: entity.id, destination: destination.name, notes,
          input: { destinazione: destination.name, ente: entity.name, paese: destination.country_code || entity.country_code,
            prezzo: '', contatto: '[DA VERIFICARE]' }
        }, claim.task.id)
        // Le foto mandate al Direttore con l'ordine vanno nei materiali prima della generazione.
        if (item.photos?.length) deck = (await addPhotosToDeck(admin, admin, deck, await directorPhotoFiles(admin, userId, item.photos))).deck
        let providerError: unknown
        // La pipeline esistente prepara il brief e valida le slide; solo il
        // trasporto del modello passa dal budget dell'ufficio, senza retry.
        const agent = officeDeckAgent(ctx, options.model || callModel)
        deck = await (options.generate || generateIntoDeck)(admin, admin, deck, undefined, async (args) => {
          try { return await agent(args) } catch (error) { providerError = error; throw error }
        }, options.findPhotos)
        spentAttempts++
        if (providerError) {
          checked(await admin.rpc('finish_office_presentation', { p_run_id: ctx.runId, p_task_id: claim.task.id,
            p_report: { message: 'Generazione non conclusa: verificare deck e riserva prima di riprovare. Nessun retry automatico.', error: deck.error } }))
          throw providerError
        }
      }
      else if (deck && item.photos?.length) {
        // Presentazione già fatta: le foto arrivate dopo si aggiungono (una volta sola), senza rigenerare.
        deck = (await addPhotosToDeck(admin, admin, deck, await directorPhotoFiles(admin, userId, item.photos))).deck
      }
      if (!deck || !['ready', 'failed', 'approved'].includes(deck.status)) {
        warnings++; ctx.log(`Presentazione ${claim.task.id}: tentativo da riconciliare, nessuna nuova spesa.`); continue
      }
      const placeholders = deckPlaceholders(deck.slides)
      const fixes = presentationFixes(deck.slides, [entity, destination], evidence)
      for (const fix of fixes) await addOfficeOutputOnce(admin, ctx, `presentation:fix:${deck.id}:v${deck.version}:${fix.slide_id}:${fix.field}`, {
        kind: 'data_fix', title: 'Presentazione: dato con fonte da verificare', target_table: 'tourism_decks', target_id: deck.id,
        body: { ...fix, deck_id: deck.id, version: deck.version, action: 'manual_deck_correction', note: 'Proposta da copiare nell’editor; nessuna modifica o approvazione automatica.' }
      })
      checked(await admin.rpc('finish_office_presentation', { p_run_id: ctx.runId, p_task_id: claim.task.id, p_report: {
        placeholders, fixes_proposed: fixes.length, warnings: deck.warnings, message: 'Rivedi e approva in Tourism. L’approvazione di questo rapporto non approva la presentazione.'
      } }))
      if (claim.claimed) {
        generated++
        // Appena pronta, la bozza arriva su Telegram in PDF (settings.telegram_pdf=false la spegne).
        if (ctx.agent.settings?.telegram_pdf !== false) {
          const sent = await sendDeckToTelegram(admin, deck)
          if (!sent.ok && sent.error !== 'Telegram non configurato') ctx.log(`Presentazione ${deck.id}: non inviata su Telegram (${sent.error}).`)
        }
      }
      if (spentAttempts >= perRun) break
    }
    return { summary: `Presentazioni: ${generated} preparate, ${warnings} segnalazioni; nessuna approvazione o invio automatico.` }
  }
}
export const runPresentations: AgentHandler = (ctx) => presentationsHandler(createServiceRoleClient())(ctx)
