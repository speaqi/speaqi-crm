import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { loadOfficeProduction } from '@/lib/server/office-production'

/** La sala di controllo: le città di StudioMap e le loro otto fasi. Sola lettura. */
export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async () =>
    Response.json(await loadOfficeProduction(request.nextUrl.searchParams.get('fresh') === '1')))
}
