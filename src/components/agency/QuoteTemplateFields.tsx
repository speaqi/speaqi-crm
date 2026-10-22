'use client'

import type { QuoteTemplate } from '@/lib/commercial-proposal'
import s from './proposal-template.module.css'

/** Stessi campi per i due modelli, dati salvati separatamente. */
export default function QuoteTemplateFields({ value, onChange }: { value: QuoteTemplate; onChange: (v: QuoteTemplate) => void }) {
  const line = (index: number, patch: Partial<QuoteTemplate['items'][number]>) => onChange({ ...value, items: value.items.map((i, n) => n === index ? { ...i, ...patch } : i) })
  return <div className={s.fields}>
    <p>Le voci si copiano nel nuovo preventivo. Un prezzo vuoto richiede conferma; zero significa gratuito. Puoi aggiungere o togliere servizi per ogni cliente.</p>
    {value.items.map((item, i) => <fieldset key={i} style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <legend>Voce {i + 1}</legend>
      <label>Servizio<input aria-label={`Servizio ${i + 1}`} value={item.description} maxLength={200} onChange={e => line(i, { description: e.target.value })} /></label>
      <label>Inclusioni ed esclusioni<textarea aria-label={`Dettagli ${i + 1}`} rows={3} value={item.details} maxLength={2000} onChange={e => line(i, { details: e.target.value })} /></label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>Quantità<input type="number" min={0.01} step="any" value={item.quantity} onChange={e => line(i, { quantity: Number(e.target.value) })} /></label>
        <label>Prezzo unitario, IVA esclusa<input type="number" min={0} step="0.01" value={item.unit_price ?? ''} placeholder="Da definire" onChange={e => line(i, { unit_price: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <button type="button" onClick={() => onChange({ ...value, items: value.items.filter((_, n) => n !== i) })}>Rimuovi voce</button>
      </div>
    </fieldset>)}
    <button type="button" disabled={value.items.length >= 30} onClick={() => onChange({ ...value, items: [...value.items, { description: '', details: '', quantity: 1, unit_price: null }] })}>＋ Voce riutilizzabile</button>
    <label>Acconto predefinito (%)<input type="number" min={0} max={100} value={value.deposit_percent} onChange={e => onChange({ ...value, deposit_percent: Number(e.target.value) })} /></label>
    <label>Condizioni di pagamento<textarea rows={3} value={value.payment_terms_note} maxLength={2000} onChange={e => onChange({ ...value, payment_terms_note: e.target.value })} /></label>
    <label>Nota pubblica<textarea rows={2} value={value.public_note} maxLength={2000} onChange={e => onChange({ ...value, public_note: e.target.value })} /></label>
    <label>Contratto di base<textarea rows={14} value={value.contract_terms} maxLength={30000} onChange={e => onChange({ ...value, contract_terms: e.target.value })} /></label>
    <small>Inserisci il testo contrattuale approvato. I campi [DA VERIFICARE] possono restare in bozza, ma vanno completati prima dell’invio. Ogni preventivo conserva la propria copia.</small>
  </div>
}
