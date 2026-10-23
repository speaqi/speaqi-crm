import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { ensureOfficeAgents } from '@/lib/server/office-agents/definitions'
import {
  MAX_ORDER_FILE_BYTES, MAX_ORDER_FILES, createDirectorOrder, listDirectorOrders, processDirectorOrder, type OrderFile,
} from '@/lib/server/office-director-orders'

/** Gli ultimi ordini al Direttore, con la sua risposta. */
export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => Response.json({ orders: await listDirectorOrders(admin, userId) }))
}

/**
 * Un ordine (testo e, se serve, foto). Si salva subito; il Direttore lo lavora
 * dopo la risposta e la pagina segue lo stato.
 */
export async function POST(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const length = Number(request.headers.get('content-length') || 0)
    if (length > MAX_ORDER_FILES * MAX_ORDER_FILE_BYTES + 100_000) return Response.json({ error: 'Ordine troppo grande' }, { status: 413 })
    let text = ''
    const files: OrderFile[] = []
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData()
      text = String(form.get('text') || '')
      for (const item of form.getAll('files')) {
        if (typeof item === 'string') continue
        files.push({ name: item.name || 'foto', buffer: Buffer.from(await item.arrayBuffer()) })
      }
    } else {
      const body = await request.json().catch(() => null)
      text = typeof body?.text === 'string' ? body.text : ''
    }
    await ensureOfficeAgents(admin, userId)
    let order
    try {
      order = await createDirectorOrder(admin, userId, { source: 'web', text, files })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Ordine non valido' }, { status: 400 })
    }
    void processDirectorOrder(admin, userId, order.id)
      .catch((error) => console.error('[direttore] ordine non elaborato', order.id, String((error as Error)?.message || error).slice(0, 300)))
    return Response.json({ order }, { status: 202 })
  })
}
