import type { QuoteLineItem } from '@/types'

export type SpeaqiPackageKey = 'platform'

export interface SpeaqiPackageDef {
  key: SpeaqiPackageKey
  label: string
  subtitle: string
  tagline: string
  quoteTitle: string
  lineDescription: string
  details: string
  unit_price: number
}

const PLATFORM_DETAILS = `Un progetto Speaqi centralizza la conoscenza della tua organizzazione e la distribuisce in un'esperienza digitale sempre aggiornata.

• Pagine web multilingua, QR Code dinamici e AI Concierge
• Traduzioni testuali e audio multilingua inclusi
• Hosting, analytics e aggiornamenti inclusi
• Un solo piano completo per progetto, senza limiti per utenti o funzioni

La produzione di video AI è separata dall'abbonamento e viene definita in minuti in base alle esigenze del progetto.`

export const SPEAQI_PACKAGES: Record<SpeaqiPackageKey, SpeaqiPackageDef> = {
  platform: {
    key: 'platform',
    label: 'PIATTAFORMA SPEAQI',
    subtitle: 'Abbonamento annuale per progetto',
    tagline: 'Genera il blocco completo, poi personalizza liberamente righe, quantità e condizioni.',
    quoteTitle: 'Progetto Speaqi — abbonamento annuale',
    lineDescription: 'Piattaforma Speaqi — abbonamento annuale per progetto',
    details: PLATFORM_DETAILS,
    unit_price: 990,
  },
}

export function quoteLineFromPackage(key: SpeaqiPackageKey, lineId: string): QuoteLineItem {
  const p = SPEAQI_PACKAGES[key]
  return {
    id: lineId,
    description: p.lineDescription,
    details: p.details,
    quantity: 1,
    unit_price: p.unit_price,
  }
}
