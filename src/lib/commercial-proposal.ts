import type { QuoteLineItem } from '@/types'

export type ProposalLine = { description: string; details: string; quantity: number; unit_price: number | null }
export type QuoteTemplate = {
  items: ProposalLine[]
  contract_terms: string
  payment_terms_note: string
  public_note: string
  deposit_percent: number
}
export type ProposalType = 'agency' | 'tourism'

// Testi di lavoro: i campi contrattuali non ancora definiti impediscono l'invio,
// ma non il salvataggio della bozza. Non sostituiscono i contratti già emessi.
const PROVIDER = 'Fornitore: The Best Italy, Via Guglielmo Melisurgo 4, P.IVA 10831191217.'
export const DEFAULT_AGENCY_CONTRACT = `ACCORDO DI SERVIZI — SPEAQI AGENCY

${PROVIDER}
Cliente e progetto: quelli indicati nel presente preventivo.

1. Oggetto e perimetro
Le prestazioni, le quantità e i corrispettivi sono esclusivamente quelli delle righe selezionate del preventivo e dei relativi dettagli. La presentazione illustra la proposta; eventuali attività aggiuntive richiedono un accordo scritto.

2. Consegne e collaborazione
Il Cliente fornisce materiali, accessi e approvazioni necessari e garantisce i diritti sui materiali forniti.
Tempi, dipendenze, numero di revisioni e modalità di approvazione: [DA VERIFICARE].

3. Corrispettivi
Valgono importi, IVA, acconto, saldo e condizioni di pagamento riportati nel preventivo. Eventuali canoni, spese pubblicitarie, licenze e servizi di terzi devono essere indicati espressamente nelle righe o nelle esclusioni.

4. Diritti e consegna dei materiali
Diritti d'uso, file sorgenti, licenze di terzi e condizioni di trasferimento: [DA VERIFICARE].

5. Assistenza e durata
Durata dell'incarico, assistenza dopo la consegna, manutenzione ed esclusioni: [DA VERIFICARE].

6. Riservatezza e dati
Le parti trattano come riservati i materiali e le informazioni ricevuti per l'esecuzione dell'incarico. Eventuali ruoli privacy e accordi sul trattamento dei dati: [DA VERIFICARE].

7. Interruzione e controversie
Recesso, risoluzione, responsabilità e disciplina delle controversie: [DA VERIFICARE].

8. Accettazione
La firma del preventivo riguarda le righe selezionate, le condizioni economiche e il presente accordo.`

export const DEFAULT_TOURISM_CONTRACT = `ACCORDO DI PROGETTO — SPEAQI TOURISM

${PROVIDER}
Cliente e progetto: quelli indicati nel presente preventivo.

1. Oggetto
Il progetto riguarda l'esperienza digitale descritta nelle righe selezionate del preventivo. Contenuti, lingue, audio, itinerari, QR, AI Concierge e servizi aggiuntivi sono compresi solo nella misura indicata nell'offerta.

2. Modello economico e durata
Indicare se il progetto prevede un abbonamento piattaforma, servizi professionali o un accordo di distribuzione con canone incluso. Durata, decorrenza, rinnovo e cessazione: [DA VERIFICARE].
Importi, IVA e scadenze di pagamento sono quelli riportati nel preventivo. I video AI eventualmente acquistati vanno descritti separatamente in minuti.

3. Contenuti e pubblicazione
Il Cliente mette a disposizione i materiali di cui detiene i diritti e approva i contenuti prima della pubblicazione. Responsabili, aggiornamenti e tempi concordati: [DA VERIFICARE].

4. Distribuzione e misurazione
Se è previsto un accordo di distribuzione, specificare canali, impegni, periodo di misurazione, definizione di accesso, report e conseguenze del mancato raggiungimento delle soglie: [DA VERIFICARE oppure NON APPLICABILE].

5. Dati e assistenza
Ruoli privacy, dati e statistiche accessibili, assistenza, disponibilità del servizio e gestione alla cessazione: [DA VERIFICARE].

6. Riservatezza e diritti
Le parti mantengono riservate le informazioni ricevute per il progetto. Il Cliente mantiene i diritti sui materiali forniti; la piattaforma rimane del Fornitore. Ulteriori diritti e licenze: [DA VERIFICARE].

7. Interruzione e controversie
Recesso, risoluzione, responsabilità e disciplina delle controversie: [DA VERIFICARE].

8. Accettazione
La firma del preventivo riguarda le righe selezionate, le condizioni economiche e il presente accordo.`

export function defaultQuoteTemplate(type: ProposalType): QuoteTemplate {
  return {
    items: [],
    contract_terms: type === 'agency' ? DEFAULT_AGENCY_CONTRACT : DEFAULT_TOURISM_CONTRACT,
    payment_terms_note: '',
    public_note: '',
    deposit_percent: type === 'agency' ? 30 : 100
  }
}

const text = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : ''
export function normalizeQuoteTemplate(raw: unknown, type: ProposalType): QuoteTemplate {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const base = defaultQuoteTemplate(type)
  return {
    items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).map((i: any) => ({
      description: text(i?.description, 200), details: text(i?.details, 2000),
      quantity: Number.isFinite(Number(i?.quantity)) && Number(i?.quantity) > 0 ? Math.min(Number(i.quantity), 1000000) : 1,
      unit_price: i?.unit_price !== null && i?.unit_price !== '' && Number.isFinite(Number(i?.unit_price)) && Number(i?.unit_price) >= 0 ? Math.min(Number(i.unit_price), 100000000) : null
    })),
    contract_terms: text(r.contract_terms, 30000) || base.contract_terms,
    payment_terms_note: text(r.payment_terms_note, 2000),
    public_note: text(r.public_note, 2000),
    deposit_percent: r.deposit_percent !== null && r.deposit_percent !== undefined && Number.isFinite(Number(r.deposit_percent)) ? Math.max(0, Math.min(100, Number(r.deposit_percent))) : base.deposit_percent
  }
}

/** Sostituzione letterale, senza interpretare $ o i segnaposto contenuti nei dati. */
export function proposalText(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{([a-z_]+)\}\}/gi, (_, key: string) => vars[key] || `[DA VERIFICARE: ${key}]`)
}

export function quoteDraftFromTemplate(template: QuoteTemplate, vars: Record<string, string>, fallback: ProposalLine[] = []) {
  const items: QuoteLineItem[] = (template.items.length ? template.items : fallback).map((i, index) => ({
    id: `proposal-${index + 1}`, description: proposalText(i.description, vars),
    details: proposalText(i.details, vars) + (i.unit_price === null ? '\n[DA VERIFICARE: importo]' : ''),
    quantity: i.quantity, unit_price: i.unit_price ?? 0
  }))
  return {
    status: 'draft' as const, billing_interval: 'one_time' as const,
    items, deposit_percent: template.deposit_percent,
    payment_terms_mode: 'percent' as const, deposit_manual_amount: null,
    payment_method: 'both' as const,
    contract_terms: proposalText(template.contract_terms, vars),
    payment_terms_note: proposalText(template.payment_terms_note, vars),
    public_note: proposalText(template.public_note, vars)
  }
}

/** Guardie condivise da creazione, modifica e invio email. Nessun costo implicito. */
export function quoteCompletionIssues(quote: { contract_terms?: unknown; items?: unknown; payment_terms_note?: unknown; public_note?: unknown }) {
  const values = [quote.contract_terms, quote.payment_terms_note, quote.public_note]
  for (const i of Array.isArray(quote.items) ? quote.items : []) {
    if (!i?.choice_group_id || i.selected === true) values.push(i?.description, i?.details)
  }
  return values.some(v => typeof v === 'string' && /\[DA VERIFICARE[^\]]*\]|\{\{[a-z_]+\}\}/i.test(v))
    ? ['Completa i campi [DA VERIFICARE] e i segnaposto del preventivo e del contratto prima di inviare.'] : []
}
