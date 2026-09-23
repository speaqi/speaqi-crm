import type { QuoteBillingInterval, QuoteLineItem, QuotePaymentMethod } from '@/types'

export type SpeaqiPackageKey = 'platform' | 'video_map'

/**
 * `one_time`: nessun rinnovo automatico su Stripe (la piattaforma si paga a
 * bonifico). `yearly`: abbonamento annuale, solo carta, Stripe rinnova da solo.
 */
export type SpeaqiPackageBilling = 'one_time' | 'yearly'

export interface SpeaqiPackageDef {
  key: SpeaqiPackageKey
  label: string
  subtitle: string
  tagline: string
  quoteTitle: string
  lineDescription: string
  details: string
  unit_price: number
  /** Prezzo di listino mostrato barrato; null = nessuno sconto da esporre. */
  list_unit_price: number | null
  billing: SpeaqiPackageBilling
}

const PLATFORM_DETAILS = `Un progetto Speaqi centralizza la conoscenza della tua organizzazione e la distribuisce in un'esperienza digitale sempre aggiornata.

• Pagine web multilingua, QR Code dinamici e AI Concierge
• Traduzioni testuali e audio multilingua inclusi
• Hosting, analytics e aggiornamenti inclusi
• Un solo piano completo per progetto, senza limiti per utenti o funzioni

La produzione di video AI è separata dall'abbonamento e viene definita in minuti in base alle esigenze del progetto.`

const VIDEO_MAP_DETAILS = `Il video della tua attività dentro le mappe Speaqi: chi esplora il territorio ti trova e ti vede, nella sua lingua.

• Video di presentazione dell'attività pubblicato sulla mappa
• Scheda con posizione, contatti e collegamento al tuo sito
• Visibilità per un anno, con rinnovo automatico
• Pagamento con carta, disdetta in qualsiasi momento prima del rinnovo`

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
    list_unit_price: null,
    billing: 'one_time',
  },
  video_map: {
    key: 'video_map',
    label: 'VIDEO NELLA MAPPA',
    subtitle: 'Abbonamento annuale · rinnovo automatico · solo carta',
    tagline: 'Per le attività commerciali: firma e pagamento online, il rinnovo lo gestisce Stripe.',
    quoteTitle: 'Video nella mappa — abbonamento annuale',
    lineDescription: 'Video nella mappa — abbonamento annuale',
    details: VIDEO_MAP_DETAILS,
    unit_price: 300,
    list_unit_price: 400,
    billing: 'yearly',
  },
}

export const SPEAQI_PACKAGE_KEYS = Object.keys(SPEAQI_PACKAGES) as SpeaqiPackageKey[]

export function isSpeaqiPackageKey(value: unknown): value is SpeaqiPackageKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPEAQI_PACKAGES, value)
}

export function quoteLineFromPackage(key: SpeaqiPackageKey, lineId: string): QuoteLineItem {
  const p = SPEAQI_PACKAGES[key]
  return {
    id: lineId,
    description: p.lineDescription,
    details: p.details,
    quantity: 1,
    unit_price: p.unit_price,
    ...(p.list_unit_price ? { list_unit_price: p.list_unit_price } : {}),
  }
}

export function quoteBillingIntervalForPackage(key: SpeaqiPackageKey): QuoteBillingInterval {
  return SPEAQI_PACKAGES[key].billing === 'yearly' ? 'year' : 'one_time'
}

export const SUBSCRIPTION_PAYMENT_TERMS_NOTE =
  'Abbonamento annuale: pagamento con carta alla firma, rinnovo automatico ogni anno allo stesso prezzo. Disdetta in qualsiasi momento prima del rinnovo.'

/**
 * Condizioni di pagamento di un abbonamento: solo carta, e l'intero importo
 * annuo come "acconto" (deposit 100%, saldo 0). Con un acconto a zero il
 * preventivo risulterebbe `waived`, cioe' niente da pagare.
 */
export const SUBSCRIPTION_PAYMENT_TERMS: {
  payment_method: QuotePaymentMethod
  payment_terms_mode: 'percent'
  deposit_percent: number
  deposit_manual_amount: null
} = {
  payment_method: 'stripe',
  payment_terms_mode: 'percent',
  deposit_percent: 100,
  deposit_manual_amount: null,
}

/** Il preventivo completo di un pacchetto: usato dal costruttore e da /vendita. */
export function quoteDraftFromPackage(key: SpeaqiPackageKey, lineId: string) {
  const p = SPEAQI_PACKAGES[key]
  const billingInterval = quoteBillingIntervalForPackage(key)
  return {
    title: p.quoteTitle,
    items: [quoteLineFromPackage(key, lineId)],
    billing_interval: billingInterval,
    ...(billingInterval === 'year'
      ? { ...SUBSCRIPTION_PAYMENT_TERMS, payment_terms_note: SUBSCRIPTION_PAYMENT_TERMS_NOTE }
      : {}),
  }
}
