import { publicSalesProgram } from '@/lib/sales-program'

/**
 * Provvigioni e prodotto per guides.speaqi.com/diventa-commerciale. Pubblico
 * apposta: e' quello che la pagina mostra a chiunque. Cosi' le percentuali e
 * il prezzo restano scritti in un posto solo (`SALES_PROGRAM` e il pacchetto
 * `video_map`), e cambiare il listino aggiorna anche la pagina su Guides.
 */
export function GET() {
  return Response.json(publicSalesProgram(), {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
  })
}
