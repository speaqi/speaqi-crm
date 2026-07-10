/**
 * Trattative (deals): storico delle opportunità per contatto, al massimo una
 * aperta. contacts.status resta la fonte che l'app legge ovunque; queste
 * funzioni tengono la trattativa aperta allineata a ogni cambio di status
 * ("shadowing") e abilitano il rientro in pipeline con una nuova opportunità.
 *
 * Tutte le funzioni degradano senza errore se la tabella deals non esiste
 * ancora (migrazione non applicata): il CRM continua a funzionare come prima.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { isClosedStatus } from '@/lib/data'
import { createActivities, formatActivityDate, syncPendingCallTask } from '@/lib/server/crm'

export type Deal = {
  id: string
  user_id: string
  contact_id: string
  title: string
  counterparty?: string | null
  stage: string
  value?: number | null
  quote_id?: string | null
  expected_close_at?: string | null
  outcome?: 'won' | 'lost' | null
  lost_reason?: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
}

/** Tabella deals assente (42P01) o colonna mancante: degrada senza rompere. */
function isMissingDealsRelation(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  if (code === '42P01') return true
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : ''
  return message.includes('deals') && (message.includes('does not exist') || message.includes('schema cache'))
}

function isUniqueViolation(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code) === '23505'
}

function isLostStatus(status: string) {
  const normalized = status.toLowerCase()
  return normalized === 'lost' || normalized === 'not_interested'
}

export async function getOpenDeal(supabase: any, userId: string, contactId: string): Promise<Deal | null> {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .is('closed_at', null)
      .maybeSingle()
    if (error) throw error
    return (data as Deal) || null
  } catch (error) {
    if (isMissingDealsRelation(error)) return null
    throw error
  }
}

export async function listContactDeals(supabase: any, userId: string, contactId: string): Promise<Deal[]> {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as Deal[]) || []
  } catch (error) {
    if (isMissingDealsRelation(error)) return []
    throw error
  }
}

/**
 * Allinea la trattativa aperta al nuovo status del contatto.
 * - Status aperto: aggiorna lo stage della trattativa aperta (o la crea).
 * - Status chiuso: chiude la trattativa aperta con outcome won/lost.
 * Non solleva mai per tabella mancante; da chiamare DOPO l'update del contatto.
 */
export async function syncDealWithContactStatus(
  supabase: any,
  userId: string,
  contactId: string,
  status: string,
  extra: { value?: number | null; lostReason?: string | null } = {}
) {
  try {
    const openDeal = await getOpenDeal(supabase, userId, contactId)

    if (isClosedStatus(status)) {
      if (!openDeal) return null
      const outcome = isLostStatus(status) ? 'lost' : 'won'
      const { error } = await supabase
        .from('deals')
        .update({
          stage: status,
          outcome,
          lost_reason: outcome === 'lost' ? (extra.lostReason ?? openDeal.lost_reason ?? null) : null,
          value: extra.value !== undefined ? extra.value : openDeal.value,
          closed_at: new Date().toISOString(),
        })
        .eq('id', openDeal.id)
      if (error) throw error
      return openDeal.id
    }

    if (openDeal) {
      if (openDeal.stage === status && extra.value === undefined) return openDeal.id
      const { error } = await supabase
        .from('deals')
        .update({
          stage: status,
          value: extra.value !== undefined ? extra.value : openDeal.value,
        })
        .eq('id', openDeal.id)
      if (error) throw error
      return openDeal.id
    }

    const { data, error } = await supabase
      .from('deals')
      .insert({
        user_id: userId,
        contact_id: contactId,
        title: 'Trattativa',
        stage: status,
        value: extra.value ?? null,
      })
      .select('id')
      .single()
    if (error) {
      // Corsa con un altro insert: la trattativa aperta esiste già, va bene così.
      if (isUniqueViolation(error)) return null
      throw error
    }
    return data?.id ?? null
  } catch (error) {
    if (isMissingDealsRelation(error)) return null
    throw error
  }
}

/**
 * Rientro in pipeline: apre una NUOVA trattativa per un contatto chiuso/pagato
 * (o senza trattative), rimette il contatto a New con un follow-up
 * obbligatorio e logga l'attività. Lo storico delle trattative resta intatto.
 */
export async function reopenWithNewDeal(
  supabase: any,
  userId: string,
  contactId: string,
  input: {
    title?: string | null
    counterparty?: string | null
    value?: number | null
    followupAt: string
    note?: string | null
  }
) {
  const existing = await getOpenDeal(supabase, userId, contactId)
  if (existing) {
    throw new Error('Esiste già una trattativa aperta per questo contatto')
  }

  const title = (input.title || '').trim() || 'Nuova opportunità'
  const counterparty = (input.counterparty || '').trim() || null

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .insert({
      user_id: userId,
      contact_id: contactId,
      title,
      counterparty,
      stage: 'New',
      value: input.value ?? null,
    })
    .select('*')
    .single()
  if (dealError) throw dealError

  const nowIso = new Date().toISOString()
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .update({
      status: 'New',
      hidden: false,
      lost_reason: null,
      next_followup_at: input.followupAt,
      next_action_at: input.followupAt,
      stage_entered_at: nowIso,
    })
    .eq('user_id', userId)
    .eq('id', contactId)
    .select('*')
    .single()
  if (contactError) throw contactError

  await syncPendingCallTask(supabase, userId, contactId, input.followupAt)

  await createActivities(supabase, [
    {
      user_id: userId,
      contact_id: contactId,
      type: 'system',
      content: [
        `Nuova opportunità aperta: ${title}.`,
        counterparty ? `Controparte: ${counterparty}.` : null,
        input.value ? `Valore stimato: €${input.value}.` : null,
        `Contatto rientrato in pipeline (New). Follow-up: ${formatActivityDate(input.followupAt)}.`,
        input.note ? `Nota: ${input.note}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    },
  ])

  return { deal: deal as Deal, contact }
}
