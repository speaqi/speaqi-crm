import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { loadOfficeOverview } from '@/lib/server/office-overview'

export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
      return Response.json({ error: 'Pagina non valida' }, { status: 400 })
    }
    return Response.json(await loadOfficeOverview(admin, userId, offset))
  })
}
