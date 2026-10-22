import { NextRequest } from 'next/server'
import { feText, isPlausibleCodiceFiscale, isValidPartitaIva, normalizePartitaIva } from '@/lib/fatturapa'
import { errorMessage } from '@/lib/server/http'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { loadInvoiceSettings } from '@/lib/server/invoices'

/**
 * Dati fiscali di chi emette le fatture, piu' il punto di partenza della
 * numerazione dell'anno (l'ultimo numero gia' emesso dal pannello Aruba).
 */

async function loadCounter(admin: any, userId: string, year: number) {
  const { data } = await admin.from('invoice_counters').select('last_number').eq('user_id', userId).eq('year', year).maybeSingle()
  return Number(data?.last_number) || 0
}

export async function GET(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  try {
    const year = new Date().getFullYear()
    const { settings, saved } = await loadInvoiceSettings(auth.admin, auth.userId)
    return Response.json({ settings, saved, year, last_number: await loadCounter(auth.admin, auth.userId, year) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare i dati fiscali') }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const partitaIva = normalizePartitaIva(body.partita_iva)
    if (!isValidPartitaIva(partitaIva)) return Response.json({ error: 'Partita IVA non valida' }, { status: 400 })
    const codiceFiscale = String(body.codice_fiscale ?? '').replace(/\s+/g, '').toUpperCase() || null
    if (codiceFiscale && !isPlausibleCodiceFiscale(codiceFiscale)) return Response.json({ error: 'Codice fiscale non valido' }, { status: 400 })
    const regime = String(body.regime_fiscale || '')
    if (!/^RF\d{2}$/.test(regime)) return Response.json({ error: 'Regime fiscale non valido' }, { status: 400 })
    const cap = String(body.cap ?? '').trim()
    if (!/^\d{5}$/.test(cap)) return Response.json({ error: 'Il CAP deve avere 5 cifre' }, { status: 400 })
    const iban = String(body.iban ?? '').replace(/\s+/g, '').toUpperCase() || null
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return Response.json({ error: 'IBAN non valido' }, { status: 400 })
    const natura = String(body.natura_esente ?? '').trim() || null
    if (natura && !/^N\d(\.\d)?$/.test(natura)) return Response.json({ error: 'Natura non valida' }, { status: 400 })
    const formato = String(body.numero_formato || '{n}').trim()
    if (!formato.includes('{n}') || formato.length > 30) return Response.json({ error: 'Il formato del numero deve contenere {n}' }, { status: 400 })

    const row = {
      user_id: auth.userId,
      denominazione: feText(body.denominazione, 80),
      partita_iva: partitaIva,
      codice_fiscale: codiceFiscale,
      regime_fiscale: regime,
      indirizzo: feText(body.indirizzo, 60),
      cap,
      comune: feText(body.comune, 60),
      provincia: String(body.provincia ?? '').trim().toUpperCase().slice(0, 2) || null,
      nazione: 'IT',
      iban,
      natura_esente: natura,
      bollo_virtuale: body.bollo_virtuale === true,
      causale_extra: feText(body.causale_extra ?? '', 400) || null,
      numero_formato: formato,
      updated_at: new Date().toISOString(),
    }
    if (!row.denominazione || !row.indirizzo || !row.comune) return Response.json({ error: 'Denominazione, indirizzo e comune sono obbligatori' }, { status: 400 })

    const { error } = await auth.admin.from('invoice_settings').upsert(row, { onConflict: 'user_id' })
    if (error) throw error

    // Punto di partenza della numerazione: si puo' solo alzare, mai scendere sotto un numero gia' usato.
    const year = new Date().getFullYear()
    if (body.last_number !== undefined && body.last_number !== null && body.last_number !== '') {
      const wanted = Number(body.last_number)
      if (!Number.isInteger(wanted) || wanted < 0) return Response.json({ error: 'Ultimo numero emesso non valido' }, { status: 400 })
      const current = await loadCounter(auth.admin, auth.userId, year)
      const { data: highest } = await auth.admin
        .from('invoices')
        .select('number')
        .eq('user_id', auth.userId)
        .eq('year', year)
        .order('number', { ascending: false })
        .limit(1)
        .maybeSingle()
      const floor = Math.max(Number(highest?.number) || 0, 0)
      if (wanted < floor) return Response.json({ error: `Il CRM ha già emesso la fattura ${floor} del ${year}: il numero non può scendere sotto.` }, { status: 400 })
      if (wanted !== current) {
        const { error: counterError } = await auth.admin
          .from('invoice_counters')
          .upsert({ user_id: auth.userId, year, last_number: wanted }, { onConflict: 'user_id,year' })
        if (counterError) throw counterError
      }
    }

    const { settings } = await loadInvoiceSettings(auth.admin, auth.userId)
    return Response.json({ settings, saved: true, year, last_number: await loadCounter(auth.admin, auth.userId, year) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare i dati fiscali') }, { status: 500 })
  }
}
