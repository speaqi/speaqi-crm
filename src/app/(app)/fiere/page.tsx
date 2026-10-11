'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '../layout'
import { apiFetch } from '@/lib/api'
import {
  compareByLocation,
  compareExhibitors,
  effectivePriority,
  FairExhibitor,
  FairFilter,
  filterExhibitors,
  followupState,
  PRIORITY_LABELS,
  standLabel,
  standMapUrl,
  TTG_FLOOR_MAP,
  TTG_HOW_TO_GET_THERE,
  STATUS_LABELS,
  summarize,
  TRADE_FAIR_STATUSES,
  TradeFairStatus,
} from '@/lib/trade-fair'

// Espositori di una fiera da valutare, contattare e riprendere dopo l'evento.
const FAIR = 'ttg-2026'
const FAIR_LABEL = 'TTG Travel Experience 2026'
const PAGE_SIZE = 100

const PRIORITY_COLORS: Record<number, string> = { 1: '#16a34a', 2: '#d97706', 3: '#94a3b8' }
const STATUS_COLORS: Record<TradeFairStatus, string> = {
  new: '#64748b',
  contacted: '#4f6ef7',
  replied: '#0ea5e9',
  interested: '#16a34a',
  meeting: '#7c3aed',
  not_interested: '#b91c1c',
}

function formatDay(value: string | null) {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function formatStamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export default function FierePage() {
  const { showToast } = useCRMContext()
  const [rows, setRows] = useState<FairExhibitor[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<FairFilter>({ status: 'open', priority: 'all' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [sort, setSort] = useState<'priority' | 'stand' | 'name'>('priority')
  const [draft, setDraft] = useState<{ id: string; email: string; phone: string; person: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ exhibitors: FairExhibitor[] }>(`/api/trade-fair-exhibitors?fair=${FAIR}`)
      setRows(response.exhibitors)
      setLoadError('')
      setNow(new Date())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare gli espositori')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const summary = useMemo(() => summarize(rows || [], now), [rows, now])
  const halls = useMemo(
    () => Array.from(new Set((rows || []).map((row) => (row.hall || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  )
  const visible = useMemo(
    () =>
      filterExhibitors(rows || [], filter, now).sort((a, b) =>
        sort === 'stand' ? compareByLocation(a, b) : sort === 'name' ? a.name.localeCompare(b.name) : compareExhibitors(a, b, now)
      ),
    [rows, filter, now, sort]
  )

  function setFilterAndReset(next: FairFilter) {
    setFilter(next)
    setLimit(PAGE_SIZE)
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const response = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      setRows((current) => (current || []).map((row) => (row.id === id ? response.exhibitor : row)))
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare')
      return false
    } finally {
      setBusyId(null)
    }
  }

  function draftFor(row: FairExhibitor) {
    return draft && draft.id === row.id
      ? draft
      : { id: row.id, email: row.email || '', phone: row.phone || '', person: row.contact_person || '' }
  }

  /** Salva i dati corretti allo stand; con `toCrm` l'espositore entra anche in pipeline con follow-up. */
  async function saveContactData(row: FairExhibitor, toCrm: boolean) {
    const d = draftFor(row)
    const email = d.email.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Email non valida')
    setBusyId(row.id)
    try {
      const saved = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, email, phone: d.phone.trim(), contact_person: d.person.trim() }),
      })
      let next = saved.exhibitor
      if (toCrm) {
        if (next.status === 'new') {
          const moved = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: row.id, status: 'contacted' }),
          })
          next = moved.exhibitor
        }
        const made = await apiFetch<{ created: boolean; exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        next = made.exhibitor
        showToast(made.created ? 'Salvato e aggiunto al CRM: lo trovi nei follow-up' : 'Salvato, contatto già nel CRM aggiornato')
      } else {
        showToast('Dati salvati')
      }
      setRows((current) => (current || []).map((item) => (item.id === row.id ? next : item)))
      setDraft(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile salvare')
    } finally {
      setBusyId(null)
    }
  }

  async function addNote(row: FairExhibitor) {
    if (!noteDraft.trim()) return
    if (await patch(row.id, { note: noteDraft })) setNoteDraft('')
  }

  async function runImport() {
    if (!importText.trim()) return showToast('Incolla prima l\'elenco')
    setImporting(true)
    try {
      const result = await apiFetch<{ created: number; updated: number; skipped: number }>('/api/trade-fair-exhibitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fair: FAIR, text: importText }),
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

  function exportCsv() {
    const header = ['Priorità', 'Punteggio', 'Espositore', 'Stato', 'Paese', 'Categoria', 'Padiglione', 'Stand', 'Email', 'Telefono', 'Sito', 'Primo contatto', 'Prossimo follow-up', 'Note']
    const lines = visible.map((row) =>
      [
        PRIORITY_LABELS[effectivePriority(row)], row.score, row.name, STATUS_LABELS[row.status], row.country, row.category,
        row.hall, row.stand, row.email, row.phone, row.website, row.contacted_at?.slice(0, 10), row.next_followup_at,
        row.notes.map((note) => note.text).join(' | '),
      ].map(csvCell).join(';')
    )
    const blob = new Blob(['﻿' + [header.map(csvCell).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `espositori-${FAIR}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const pill = (color: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: '#fff', background: color,
  })
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', minWidth: 130 }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, display: 'grid', gap: 16, alignContent: 'start' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🎪 {FAIR_LABEL}</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
            Espositori da valutare, contattare e riprendere dopo la fiera. Il punteggio dice quanto somigliano a un cliente di Speaqi Maps.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a className="btn btn-ghost btn-sm" href={TTG_FLOOR_MAP} target="_blank" rel="noopener noreferrer">🗺️ Mappa padiglioni</a>
          <a className="btn btn-ghost btn-sm" href={TTG_HOW_TO_GET_THERE} target="_blank" rel="noopener noreferrer">🚇 Come arrivare</a>
          <button className="btn btn-ghost btn-sm" type="button" onClick={exportCsv} disabled={!visible.length}>Esporta CSV</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Chiudi importazione' : 'Importa elenco'}
          </button>
        </div>
      </header>

      {showImport ? (
        <section style={{ ...card, display: 'grid', gap: 8 }}>
          <strong>Importa gli espositori</strong>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            Incolla una tabella (da Excel, CSV o copiata dal sito) con intestazione: Espositore, Paese, Categoria, Padiglione, Stand, Sito, Email, Telefono, Descrizione.
            Senza intestazione, una riga = un nome. Reimportare aggiorna i dati ma non tocca stato, note e follow-up.
          </span>
          <textarea className="fi" rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'Espositore;Paese;Categoria;Stand\nHotel Sole;Italia;Hotel e resort;B12'} />
          <div>
            <button className="btn btn-primary btn-sm" type="button" onClick={runImport} disabled={importing}>
              {importing ? 'Importo…' : 'Importa'}
            </button>
          </div>
        </section>
      ) : null}

      {loadError ? <div style={{ color: '#b91c1c' }}>{loadError}</div> : null}
      {rows === null && !loadError ? <div>Caricamento…</div> : null}

      {rows && rows.length === 0 ? (
        <section style={card}>Nessun espositore ancora: usa «Importa elenco» per caricare quelli della fiera.</section>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {[
              ['Espositori', summary.total, () => setFilterAndReset({ status: 'all', priority: 'all' })],
              ['Da contattare', summary.toContact, () => setFilterAndReset({ status: 'new', priority: 'all' })],
              ['…di priorità alta', summary.highToContact, () => setFilterAndReset({ status: 'new', priority: 1 })],
              ['Già contattati', summary.contacted, () => setFilterAndReset({ status: 'open', priority: 'all' })],
              ['Follow-up scaduti', summary.overdue, () => setFilterAndReset({ status: 'open', priority: 'all', onlyFollowup: true })],
              ['Interessati', summary.interested, () => setFilterAndReset({ status: 'interested', priority: 'all' })],
            ].map(([label, value, onClick]) => (
              <button key={label as string} type="button" style={{ ...card, textAlign: 'left', cursor: 'pointer' }} onClick={onClick as () => void}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{value as number}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{label as string}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input className="fi" style={{ minWidth: 220 }} placeholder="Cerca nome, stand, email, categoria…" value={filter.search || ''}
              onChange={(e) => setFilterAndReset({ ...filter, search: e.target.value })} />
            <select className="fi" value={String(filter.status || 'all')} onChange={(e) => setFilterAndReset({ ...filter, status: e.target.value as FairFilter['status'] })}>
              <option value="all">Tutti gli stati</option>
              <option value="open">Aperti (non scartati)</option>
              {TRADE_FAIR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select className="fi" value={String(filter.priority || 'all')} onChange={(e) => setFilterAndReset({ ...filter, priority: e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1 | 2 | 3) })}>
              <option value="all">Ogni priorità</option>
              <option value="1">Alta</option><option value="2">Media</option><option value="3">Bassa</option>
            </select>
            <select className="fi" value={filter.hall || ''} onChange={(e) => setFilterAndReset({ ...filter, hall: e.target.value || undefined })}>
              <option value="">Tutti i padiglioni</option>
              {halls.map((hall) => <option key={hall} value={hall}>{hall.replace(/^Hall\s+/i, 'Pad. ')}</option>)}
            </select>
            <select className="fi" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="priority">Ordina: da contattare per primi</option>
              <option value="stand">Ordina: giro della fiera (padiglione e stand)</option>
              <option value="name">Ordina: nome</option>
            </select>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={Boolean(filter.onlyFollowup)} onChange={(e) => setFilterAndReset({ ...filter, onlyFollowup: e.target.checked })} /> Follow-up da fare</label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={Boolean(filter.onlyWithContact)} onChange={(e) => setFilterAndReset({ ...filter, onlyWithContact: e.target.checked })} /> Con email o telefono</label>
            <span style={{ fontSize: 13, color: '#64748b' }}>{visible.length} risultati</span>
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {visible.slice(0, limit).map((row) => {
              const priority = effectivePriority(row)
              const follow = followupState(row, now)
              const open = openId === row.id
              const busy = busyId === row.id
              return (
                <li key={row.id} style={{ background: '#fff', border: `1px solid ${follow === 'overdue' ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 14px', cursor: 'pointer' }} onClick={() => setOpenId(open ? null : row.id)}>
                    <span style={pill(PRIORITY_COLORS[priority])} title={row.score_reasons.join(' · ') || 'Nessun segnale'}>
                      {PRIORITY_LABELS[priority]} · {row.score}
                    </span>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {[row.country, row.category].filter(Boolean).join(' · ')}
                      </div>
                    </div>
 {standLabel(row) ? <span style={{ fontSize: 12, fontWeight: 700, background: '#eef2ff', color: '#3730a3', borderRadius: 6, padding: '2px 8px' }}>📍 {standLabel(row)}</span> : null}
                    {row.contact_id ? <span title="Già nel CRM" style={{ fontSize: 12 }}>✅ CRM</span> : null}
                    {row.notes.length ? <span title="Note" style={{ fontSize: 12 }}>📝 {row.notes.length}</span> : null}
                    {row.next_followup_at && follow !== 'none' ? (
                      <span style={{ fontSize: 12, color: follow === 'overdue' ? '#b91c1c' : '#475569', fontWeight: follow === 'planned' ? 400 : 700 }}>
                        {follow === 'overdue' ? '⚠ scaduto ' : follow === 'today' ? '⏰ oggi ' : '↻ '}{formatDay(row.next_followup_at)}
                      </span>
                    ) : null}
                    <span style={pill(STATUS_COLORS[row.status])}>{STATUS_LABELS[row.status]}</span>
                  </div>

                  {open ? (
                    <div style={{ borderTop: '1px solid #e2e8f0', padding: 14, display: 'grid', gap: 12 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <select className="fi" value={row.status} disabled={busy} onChange={(e) => patch(row.id, { status: e.target.value })}>
                          {TRADE_FAIR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                        </select>
                        <select className="fi" value={row.priority ?? ''} disabled={busy} onChange={(e) => patch(row.id, { priority: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">Priorità automatica ({PRIORITY_LABELS[effectivePriority({ priority: null, score: row.score })]})</option>
                          <option value="1">Alta</option><option value="2">Media</option><option value="3">Bassa</option>
                        </select>
                        <label style={{ fontSize: 13 }}>
                          Follow-up{' '}
                          <input className="fi" type="date" value={row.next_followup_at || ''} disabled={busy} onChange={(e) => patch(row.id, { next_followup_at: e.target.value || null })} />
                        </label>
                        {row.contacted_at ? <span style={{ fontSize: 12, color: '#64748b' }}>Primo contatto {formatStamp(row.contacted_at)}</span> : null}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, alignItems: 'center' }}>
                        {standLabel(row) ? <strong>📍 {standLabel(row)}</strong> : <span style={{ color: '#64748b' }}>Stand non indicato</span>}
                        <a href={standMapUrl(row)} target="_blank" rel="noopener noreferrer">🗺️ Mappa e percorso allo stand</a>
                        <a href={TTG_HOW_TO_GET_THERE} target="_blank" rel="noopener noreferrer">🚇 Come arrivare in fiera</a>
                        {row.source_url ? <a href={row.source_url} target="_blank" rel="noopener noreferrer">Scheda sul sito della fiera</a> : null}
                        {row.website ? <a href={row.website} target="_blank" rel="noopener noreferrer">🌐 Sito</a> : null}
                      </div>

                      <div style={{ display: 'grid', gap: 8, background: '#f8fafc', borderRadius: 10, padding: 12 }}>
                        <strong style={{ fontSize: 13 }}>Contatto preso allo stand</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {([['person', 'Con chi hai parlato'], ['email', 'Email corretta'], ['phone', 'Telefono']] as const).map(([field, label]) => (
                            <input key={`${row.id}-${field}`} className="fi" style={{ flex: '1 1 200px' }} placeholder={label}
                              type={field === 'email' ? 'email' : 'text'} inputMode={field === 'email' ? 'email' : undefined}
                              value={draftFor(row)[field]} disabled={busy}
                              onChange={(e) => setDraft({ ...draftFor(row), [field]: e.target.value })} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => saveContactData(row, true)}>
                            {row.contact_id ? '💾 Salva e aggiorna il contatto nel CRM' : '➕ Salva e aggiungi al CRM (da ricontattare)'}
                          </button>
                          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => saveContactData(row, false)}>Solo salva</button>
                          {row.contact_id ? <Link className="btn btn-ghost btn-sm" href={`/contacts/${row.contact_id}`}>Apri contatto →</Link> : null}
                          {row.email ? <a className="btn btn-ghost btn-sm" href={`mailto:${row.email}`}>✉ Scrivi</a> : null}
                          {row.phone ? <a className="btn btn-ghost btn-sm" href={`tel:${row.phone}`}>📞 Chiama</a> : null}
                        </div>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          «Aggiungi al CRM» crea il contatto in pipeline con follow-up per domani (o la data impostata sopra) e segna l&apos;espositore come contattato.
                        </span>
                      </div>

                      {row.description ? <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>{row.description}</p> : null}
                      {row.score_reasons.length ? <div style={{ fontSize: 12, color: '#64748b' }}>Perché questo punteggio: {row.score_reasons.join(' · ')}</div> : null}

                      <div style={{ display: 'grid', gap: 6 }}>
                        <strong style={{ fontSize: 13 }}>Note</strong>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <textarea className="fi" rows={2} style={{ flex: 1 }} placeholder="Cosa vi siete detti, cosa promettere, chi richiamare…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
                          <button className="btn btn-primary btn-sm" type="button" disabled={busy || !noteDraft.trim()} onClick={() => addNote(row)}>Aggiungi</button>
                        </div>
                        {row.notes.map((note) => (
                          <div key={note.id} style={{ fontSize: 13, background: '#f8fafc', borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                            <span><span style={{ color: '#64748b' }}>{formatStamp(note.at)} — </span>{note.text}</span>
                            <button type="button" className="btn-mini" disabled={busy} onClick={() => patch(row.id, { delete_note_id: note.id })}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {visible.length > limit ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setLimit((v) => v + PAGE_SIZE)}>
              Mostra altri ({visible.length - limit})
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
