'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '../layout'
import { apiFetch } from '@/lib/api'
import ElencoTab from '@/components/fiere/ElencoTab'
import DestinazioniTab from '@/components/fiere/DestinazioniTab'
import MailingTab from '@/components/fiere/MailingTab'
import PianoTab from '@/components/fiere/PianoTab'
import { downloadCsv, FAIR, FAIR_LABEL, TYPE_SHORT } from '@/components/fiere/shared'
import { effectivePriority, FairExhibitor, foreignDestinations, italianDestinations, PRIORITY_LABELS, STATUS_LABELS, summarize, TTG_FLOOR_MAP, TTG_HOW_TO_GET_THERE } from '@/lib/trade-fair'
import type { OutreachState } from '@/lib/trade-fair-outreach'

type Tab = 'elenco' | 'italiane' | 'estere' | 'piano' | 'mailing'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'elenco', label: 'Espositori', hint: 'Tutti gli espositori: cerca, aggiorna lo stato, aggiungi note e porta i contatti nel CRM.' },
  { id: 'italiane', label: 'Destinazioni italiane', hint: 'L’elenco completo delle destinazioni italiane presenti nel catalogo importato, con stand, contatti e bozza email.' },
  { id: 'estere', label: 'Destinazioni estere', hint: 'L’elenco completo delle destinazioni estere presenti nel catalogo importato, con stand e contatti.' },
  { id: 'piano', label: 'Piano di visita', hint: 'In fiera: i migliori per padiglione e stand, giorno per giorno.' },
  { id: 'mailing', label: 'Mailing', hint: 'Prima o dopo la fiera: un\'email su misura per ogni espositore in linea con Speaqi.' },
]

export default function FierePage() {
  const { showToast } = useCRMContext()
  const [rows, setRows] = useState<FairExhibitor[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<Tab>('elenco')
  const [now, setNow] = useState(() => new Date())
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ exhibitors: FairExhibitor[] }>(`/api/trade-fair-exhibitors?fair=${FAIR}`)
      setRows(response.exhibitors)
      setLoadError('')
      setNow(new Date())
      // Righe mai valutate (import o algoritmo nuovo): si calcola il punteggio una volta e si ricarica.
      if (response.exhibitors.some((row) => !row.last_scored_at)) {
        apiFetch('/api/trade-fair-exhibitors/rescore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fair: FAIR }) })
          .then(() => apiFetch<{ exhibitors: FairExhibitor[] }>(`/api/trade-fair-exhibitors?fair=${FAIR}`))
          .then((fresh) => setRows(fresh.exhibitors))
          .catch(() => undefined)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare gli espositori')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onRowChange = useCallback((next: FairExhibitor) => {
    setRows((current) => (current || []).map((row) => (row.id === next.id ? next : row)))
  }, [])

  const summary = useMemo(() => summarize(rows || [], now), [rows, now])
  const destinations = useMemo(() => foreignDestinations(rows || []), [rows])
  const italian = useMemo(() => italianDestinations(rows || []), [rows])
  const mailCount = useMemo(() => (rows || []).filter((r) => ((r.outreach || {}) as OutreachState).selected && !((r.outreach || {}) as OutreachState).sent_at).length, [rows])

  async function runImport() {
    if (!importText.trim()) return showToast("Incolla prima l'elenco")
    setImporting(true)
    try {
      const result = await apiFetch<{ created: number; updated: number; skipped: number }>('/api/trade-fair-exhibitors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fair: FAIR, text: importText }),
      })
      showToast(`Importati: ${result.created} nuovi, ${result.updated} aggiornati, ${result.skipped} scartati`)
      setImportText('')
      setShowImport(false)
      await load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile importare')
    } finally {
      setImporting(false)
    }
  }

  function exportAll() {
    downloadCsv(`espositori-${FAIR}.csv`,
      ['Priorità', 'Classe', 'Punteggio TTG', 'Azione consigliata', 'Espositore', 'Tipologia', 'Stato', 'Paese', 'Padiglione', 'Stand', 'Email', 'Telefono', 'Sito', 'Primo contatto', 'Prossimo richiamo', 'Note'],
      (rows || []).map((row) => [
        PRIORITY_LABELS[effectivePriority(row)], row.lead_class || 'Da qualificare', row.ttg_priority_score, row.recommended_action, row.name,
        TYPE_SHORT[row.organization_type || ''] || '', STATUS_LABELS[row.status], row.country, row.hall, row.stand, row.email, row.phone, row.website,
        row.contacted_at?.slice(0, 10), row.next_followup_at, row.notes.map((n) => n.text).join(' | '),
      ]))
  }

  const current = TABS.find((t) => t.id === tab)!
  const counts: Record<Tab, number | null> = { elenco: summary.total, italiane: italian.length, estere: destinations.length, piano: null, mailing: mailCount || null }

  return (
    <div className="fx-page">
      <div className="fx-wrap">
        <header className="fx-head">
          <div>
            <h1 className="fx-title">🎪 {FAIR_LABEL}</h1>
            <p className="fx-sub">{summary.total} espositori · {summary.toContact} da contattare · {summary.contacted} già contattati{summary.overdue ? ` · ${summary.overdue} richiami scaduti` : ''}</p>
          </div>
          <details className="fx-menu">
            <summary className="btn btn-ghost btn-sm">Altro ▾</summary>
            <div className="fx-menu-pop">
              <a href={TTG_FLOOR_MAP} target="_blank" rel="noopener noreferrer">🗺️ Mappa dei padiglioni</a>
              <a href={TTG_HOW_TO_GET_THERE} target="_blank" rel="noopener noreferrer">🚇 Come arrivare in fiera</a>
              <button type="button" onClick={exportAll} disabled={!rows?.length}>⬇ Esporta tutto in CSV</button>
              <button type="button" onClick={() => { setShowImport((v) => !v) }}>⬆ Importa un elenco</button>
            </div>
          </details>
        </header>

        {showImport ? (
          <section className="fx-card">
            <strong>Importa gli espositori</strong>
            <span className="fx-hint">Incolla una tabella (Excel, CSV o copiata dal sito) con intestazione: Espositore, Paese, Categoria, Padiglione, Stand, Sito, Email, Telefono. Reimportare aggiorna i dati ma non tocca stato, note e richiami.</span>
            <textarea className="fi" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'Espositore;Paese;Categoria;Stand\nHotel Sole;Italia;Hotel e resort;B12'} />
            <div className="fx-actions">
              <button className="btn btn-primary btn-sm" type="button" onClick={runImport} disabled={importing}>{importing ? 'Importo…' : 'Importa'}</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowImport(false)}>Chiudi</button>
            </div>
          </section>
        ) : null}

        <nav className="fx-tabs" role="tablist" aria-label="Sezioni">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="fx-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}{counts[t.id] !== null ? <span className="fx-count">{counts[t.id]}</span> : null}
            </button>
          ))}
        </nav>
        <p className="fx-hint" style={{ marginTop: -6 }}>{current.hint}</p>

        {loadError ? <div style={{ color: '#b91c1c' }}>{loadError}</div> : null}
        {rows === null && !loadError ? <div className="fx-empty">Caricamento…</div> : null}
        {rows && rows.length === 0 ? <div className="fx-card fx-empty">Nessun espositore ancora: usa «Altro → Importa un elenco».</div> : null}

        {rows && rows.length > 0 && tab === 'elenco' ? <ElencoTab rows={rows} now={now} showToast={showToast} onRowChange={onRowChange} /> : null}
        {rows && rows.length > 0 && tab === 'italiane' ? <DestinazioniTab key="italiane" scope="italiane" rows={italian} now={now} showToast={showToast} onRowChange={onRowChange} /> : null}
        {rows && rows.length > 0 && tab === 'estere' ? <DestinazioniTab key="estere" scope="estere" rows={destinations} now={now} showToast={showToast} onRowChange={onRowChange} /> : null}
        {rows && rows.length > 0 && tab === 'piano' ? <PianoTab rows={rows} showToast={showToast} onRowChange={onRowChange} /> : null}
        {rows && rows.length > 0 && tab === 'mailing' ? <MailingTab rows={rows} now={now} showToast={showToast} onRowChange={onRowChange} onReload={load} /> : null}
      </div>
    </div>
  )
}
