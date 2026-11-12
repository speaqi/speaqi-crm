import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { loadOfficeSystem } from '@/lib/server/office-system'

/** Pianificatore e ultimo backup, per l'orologio del campus. Sola lettura. */
export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async () => Response.json(await loadOfficeSystem()))
}
