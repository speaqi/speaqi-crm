import { NextRequest } from 'next/server'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { errorMessage } from '@/lib/server/http'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  const { id: contactId } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const table = body.kind === 'quote' ? 'quotes' : body.kind === 'invoice' ? 'invoices' : null
    const documentId = String(body.id || '')
    const projectId = body.project_id ? String(body.project_id) : null
    if (!table || !documentId) return Response.json({ error: 'Documento non valido' }, { status: 400 })
    const { data: row, error } = table === 'invoices'
      ? await auth.admin.from('invoices').select('id,contact_id,quote_id').eq('id', documentId).eq('user_id', auth.userId).maybeSingle()
      : await auth.admin.from('quotes').select('id,contact_id').eq('id', documentId).eq('user_id', auth.userId).maybeSingle()
    if (error) throw error
    if (!row) return Response.json({ error: 'Documento non trovato' }, { status: 404 })
    const document = row as { id: string; contact_id: string | null; quote_id?: string | null }
    let belongs = document.contact_id === contactId
    if (!belongs && table === 'invoices' && document.quote_id && !document.contact_id) {
      const quote = await auth.admin.from('quotes').select('id').eq('id', document.quote_id).eq('user_id', auth.userId).eq('contact_id', contactId).maybeSingle()
      if (quote.error) throw quote.error
      belongs = !!quote.data
    }
    if (!belongs) return Response.json({ error: 'Documento non collegato a questo contatto' }, { status: 404 })
    if (projectId) {
      const project = await auth.admin.from('crm_projects').select('id').eq('id', projectId).eq('user_id', auth.userId).eq('contact_id', contactId).maybeSingle()
      if (project.error) throw project.error
      if (!project.data) return Response.json({ error: 'Progetto non valido' }, { status: 400 })
    }
    const result = await auth.admin.from(table).update({ project_id: projectId }).eq('id', documentId).eq('user_id', auth.userId).select('id').maybeSingle()
    if (result.error) throw result.error
    if (!result.data) return Response.json({ error: 'Documento non trovato' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) { return Response.json({ error: errorMessage(error, 'Impossibile collegare il documento') }, { status: 500 }) }
}
