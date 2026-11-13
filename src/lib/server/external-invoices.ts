/** Segna una bozza o un XML numerato preparato a mano come fattura esterna.
 * Conserva il documento precedente e non assegna numeri né invia allo SDI. */
export async function reconcileInvoiceRecord(admin: any, userId: string, invoiceId: string, input: { number: string; issued: string; paymentState: string; paidAt: string | null; total: number }) {
  const { data: current, error } = await admin.from('invoices').select('*').eq('id', invoiceId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!current) return { ok: false as const, status: 404, error: 'Fattura non trovata' }
  const manualPrepared = current.status === 'sent' && current.number != null && current.aruba_env === 'manual' && !current.aruba_filename
  const cleanDraft = current.status === 'draft' && current.number == null && current.send_attempts === 0
  if (current.externally_issued || (!cleanDraft && !manualPrepared)) return { ok: false as const, status: 409, error: 'La fattura è già stata emessa o lavorata: verifica il caso manualmente.' }
  if (manualPrepared && (input.number !== current.numero || input.issued !== current.issue_date || Math.round(input.total * 100) !== Math.round(Number(current.totale) * 100))) return { ok: false as const, status: 409, error: 'Numero, data e importo del documento numerato devono restare invariati.' }
  let query = admin.from('invoices').update({
    externally_issued: true, external_number: input.number, external_snapshot: structuredClone(current),
    ...(manualPrepared ? {} : { issue_date: input.issued, status: 'sent', sent_at: `${input.issued}T12:00:00Z`, totale: input.total }),
    payment_state: input.paymentState, paid_at: input.paidAt,
    sdi_status: null, sdi_detail: null, last_error: null,
  }).eq('id', invoiceId).eq('user_id', userId).eq('externally_issued', false)
  if (current.updated_at) query = query.eq('updated_at', current.updated_at)
  query = manualPrepared ? query.eq('status', 'sent').eq('aruba_env', 'manual').is('aruba_filename', null).eq('number', current.number).eq('issue_date', current.issue_date) : query.eq('status', 'draft').is('number', null).eq('send_attempts', 0)
  const { data, error: updateError } = await query.select('*').maybeSingle()
  if (updateError?.code === '23505') return { ok: false as const, status: 409, error: 'Esiste già una fattura esterna con questo numero e anno: verifica prima di proseguire.' }
  if (updateError) throw updateError
  if (!data) return { ok: false as const, status: 409, error: 'La fattura è cambiata: ricarica e verifica.' }
  return { ok: true as const, invoice: data }
}
