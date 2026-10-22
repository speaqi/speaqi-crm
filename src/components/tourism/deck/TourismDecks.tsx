'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { DeckStatus } from '@/lib/tourism-deck'
import DeckWizard from './DeckWizard'
import TemplateEditor from './TemplateEditor'
import s from '../tourism.module.css'
import e from './editor.module.css'

type Row = { id: string; title: string; destination: string; status: DeckStatus; todo: number; updated_at: string; approved_at: string | null }

export const DECK_STATUS_LABELS: Record<DeckStatus, string> = {
  draft: 'Bozza',
  generating: 'In generazione',
  ready: 'Da rivedere',
  approved: 'Approvata',
  failed: 'Da correggere'
}

/** Tab "Presentazioni": l'elenco, il tasto per crearne una e il modello generico. */
export default function TourismDecks() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [wizard, setWizard] = useState(false)
  const [template, setTemplate] = useState(false)

  const load = useCallback(() => {
    apiFetch<{ decks: Row[] }>('/api/tourism/decks')
      .then((r) => { setRows(r.decks); setError('') })
      .catch((err) => setError(err instanceof Error ? err.message : 'Elenco non caricato'))
  }, [])
  useEffect(load, [load])

  return (
    <section aria-label="Presentazioni per destinazione">
      <div className={e.head}>
        <div>
          <h2 style={{ margin: 0 }}>Presentazioni per destinazione</h2>
          <p className={e.help}>Una presentazione personalizzata per ogni DMC o ente: la crei da qui, la rivedi, la approvi e poi la invii.</p>
        </div>
        <div className={e.bar}>
          <button className={s.secondary} onClick={() => setTemplate(true)}>Modifica il modello</button>
          <button className={s.primary} onClick={() => setWizard(true)}>＋ Crea la presentazione</button>
        </div>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
      {rows === null && !error && <p className={s.muted}>Caricamento…</p>}
      {rows && !rows.length && <p className={s.empty}>Nessuna presentazione ancora. Premi “Crea la presentazione”, oppure aprila dalla scheda di un ente.</p>}
      {rows && rows.length > 0 && (
        <table className={e.table}>
          <thead>
            <tr><th>Destinazione</th><th>Stato</th><th>Da completare</th><th>Aggiornata</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/tourism/presentazioni/${r.id}`}><strong>{r.title}</strong></Link></td>
                <td><span className={e.status} data-s={r.status}>{DECK_STATUS_LABELS[r.status]}</span></td>
                <td>{r.todo ? `${r.todo} [DA VERIFICARE]` : '—'}</td>
                <td>{new Date(r.updated_at).toLocaleDateString('it-IT')}</td>
                <td><Link href={`/tourism/presentazioni/${r.id}`}>Apri →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {wizard && <DeckWizard onClose={() => setWizard(false)} onCreated={(id) => router.push(`/tourism/presentazioni/${id}`)} />}
      {template && <TemplateEditor onClose={() => setTemplate(false)} />}
    </section>
  )
}
