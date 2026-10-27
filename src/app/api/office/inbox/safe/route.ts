import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { approveSafeOutputs } from '@/lib/server/office-autonomy'

/** «Approva le sicure»: archivia gli avvisi e approva le proposte interne e reversibili. */
export async function POST(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => Response.json(await approveSafeOutputs(admin, userId)))
}
