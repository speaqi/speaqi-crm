import { NextRequest } from 'next/server'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { errorMessage } from '@/lib/server/http'
import { isUuid } from '@/lib/tourism'

/** Collegamenti espliciti, riservati al titolare; non modificano i documenti. */
export async function GET(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  try {
    const taskId = request.nextUrl.searchParams.get('task_id')
    const invoiceId = request.nextUrl.searchParams.get('invoice_id')
    if ((!taskId && !invoiceId) || (taskId && invoiceId) || !isUuid(taskId || invoiceId)) return Response.json({ error: 'Scegli un’attività o una fattura' }, { status: 400 })
    if (taskId) {
      const task = await auth.admin.from('tasks').select('id').eq('id', taskId).eq('user_id', auth.userId).is('contact_id', null).maybeSingle()
      if (task.error) throw task.error
      if (!task.data) return Response.json({ error: 'Attività non trovata' }, { status: 404 })
    } else {
      const invoice = await auth.admin.from('invoices').select('id').eq('id', invoiceId!).eq('user_id', auth.userId).maybeSingle()
      if (invoice.error) throw invoice.error
      if (!invoice.data) return Response.json({ error: 'Fattura non trovata' }, { status: 404 })
    }
    const links: Array<{ task_id: string; invoice_id: string }> = []
    for (let offset = 0; ; offset += 1000) {
      const query = auth.admin.from('todo_invoice_links').select('task_id,invoice_id').eq('user_id', auth.userId)
      const result = await (taskId ? query.eq('task_id', taskId).order('invoice_id') : query.eq('invoice_id', invoiceId!).order('task_id')).range(offset, offset + 999)
      if (result.error) throw result.error
      links.push(...(result.data || []))
      if ((result.data || []).length < 1000) break
    }
    const candidates: unknown[] = []
    for (let offset = 0; ; offset += 1000) {
      const result = taskId
        ? await auth.admin.from('invoices').select('id,numero,external_number,externally_issued,customer,issue_date,totale,payment_state,status').eq('user_id', auth.userId).order('id').range(offset, offset + 999)
        : await auth.admin.from('tasks').select('id,title,note,status,board_column_id').eq('user_id', auth.userId).is('contact_id', null).order('id').range(offset, offset + 999)
      if (result.error) throw result.error
      candidates.push(...(result.data || []))
      if ((result.data || []).length < 1000) break
    }
    return Response.json({ links, candidates })
  } catch (error) { return Response.json({ error: errorMessage(error, 'Impossibile caricare i collegamenti') }, { status: 500 }) }
}
async function write(request: NextRequest, remove: boolean) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const taskId = String(body.task_id || ''), invoiceId = String(body.invoice_id || '')
    if (!isUuid(taskId) || !isUuid(invoiceId)) return Response.json({ error: 'Scegli attività e fattura' }, { status: 400 })
    const [task, invoice] = await Promise.all([
      auth.admin.from('tasks').select('id').eq('id', taskId).eq('user_id', auth.userId).is('contact_id', null).maybeSingle(),
      auth.admin.from('invoices').select('id').eq('id', invoiceId).eq('user_id', auth.userId).maybeSingle(),
    ])
    if (task.error) throw task.error
    if (invoice.error) throw invoice.error
    if (!task.data || !invoice.data) return Response.json({ error: 'Attività o fattura non trovata' }, { status: 404 })
    const result = remove
      ? await auth.admin.from('todo_invoice_links').delete().eq('user_id', auth.userId).eq('task_id', taskId).eq('invoice_id', invoiceId)
      : await auth.admin.from('todo_invoice_links').upsert({ user_id: auth.userId, task_id: taskId, invoice_id: invoiceId }, { onConflict: 'task_id,invoice_id', ignoreDuplicates: true })
    if (result.error) throw result.error
    return Response.json({ ok: true })
  } catch (error) { return Response.json({ error: errorMessage(error, 'Impossibile aggiornare il collegamento') }, { status: 500 }) }
}
export async function POST(request: NextRequest) { return write(request, false) }
export async function DELETE(request: NextRequest) { return write(request, true) }
