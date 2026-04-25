import type { QuoteLineItem } from '@/types'

export type SpeaqiPackageKey = 'start' | 'experience' | 'signature'

export interface SpeaqiPackageDef {
  key: SpeaqiPackageKey
  label: string
  subtitle: string
  tagline: string
  quoteTitle: string
  lineDescription: string
  details: string
  unit_price: number
  list_unit_price: number
}

const START_DETAILS = `Perfetto per introdurre Speaqi nella tua struttura.

👉 Inizia a parlare la lingua dei tuoi clienti

• 1 video multilingua con lip-sync realistico fino a 1 min*
• Traduzione fino a 7 lingue
• QR dinamico
• Accesso piano Premium incluso per 1 anno (dopo 299€/anno)`

const EXPERIENCE_DETAILS = `La base per un'esperienza completa e professionale.

👉 Costruisci audience internazionale

• Fino a 3 video multilingua fino a 1 min*
• Traduzione fino a 7 lingue
• QR dinamico
• Accesso piano Premium incluso per 1 anno (dopo 299€/anno)
• Analytics su lingue e utilizzo
• Supporto prioritario`

const SIGNATURE_DETAILS = `La soluzione completa per trasformare la percezione della tua struttura.

👉 Rendi la tua cantina davvero globale

• Fino a 6 video multilingua fino a 1 min*
• Traduzione fino a 7 lingue
• QR dinamico
• Accesso piano Premium incluso per 1 anno (dopo 299€/anno)
• Analytics avanzate (paesi, engagement, performance)
• Supporto dedicato`

export const SPEAQI_PACKAGES: Record<SpeaqiPackageKey, SpeaqiPackageDef> = {
  start: {
    key: 'start',
    label: 'START',
    subtitle: '1 video',
    tagline: '👉 Inizia a parlare la lingua dei tuoi clienti',
    quoteTitle: 'Speaqi START — 1 video',
    lineDescription: 'Speaqi START — 1 video multilingua',
    details: START_DETAILS,
    unit_price: 349.99,
    list_unit_price: 699,
  },
  experience: {
    key: 'experience',
    label: 'EXPERIENCE',
    subtitle: '3 video',
    tagline: '👉 Costruisci audience internazionale',
    quoteTitle: 'Speaqi EXPERIENCE — 3 video',
    lineDescription: 'Speaqi EXPERIENCE — 3 video multilingua',
    details: EXPERIENCE_DETAILS,
    unit_price: 699.99,
    list_unit_price: 1099,
  },
  signature: {
    key: 'signature',
    label: 'SIGNATURE',
    subtitle: '6 video',
    tagline: '👉 Rendi la tua cantina davvero globale',
    quoteTitle: 'Speaqi SIGNATURE — 6 video',
    lineDescription: 'Speaqi SIGNATURE — 6 video multilingua',
    details: SIGNATURE_DETAILS,
    unit_price: 999.99,
    list_unit_price: 1999,
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
    list_unit_price: p.list_unit_price,
  }
}
