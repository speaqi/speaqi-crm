'use client'

import Link from 'next/link'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { CLASS_META, evaluateExhibitor, FACTOR_DEFS, FactorKey, SOURCE_LABELS } from '@/lib/opportunity-score'
import {
  effectivePriority,
  FairExhibitor,
  PRIORITY_LABELS,
  standLabel,
  standMapUrl,
  STATUS_LABELS,
  TRADE_FAIR_STATUSES,
  TradeFairStatus,
  TTG_HOW_TO_GET_THERE,
} from '@/lib/trade-fair'
import { OutreachState, TEMPLATE_LABELS } from '@/lib/trade-fair-outreach'
import { FAIR, formatStamp } from './shared'

export type DetailTab = 'contatto' | 'punteggio' | 'email'

type Props = {
  row: FairExhibitor
  initialTab?: DetailTab
  showToast: (message: string) => void
  onRowChange: (row: FairExhibitor) => void
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Scheda di un espositore: tre sotto-schede, una cosa alla volta. */
export default function ExhibitorDetail({ row, initialTab = 'contatto', showToast, onRowChange }: Props) {
  const outreach = (row.outreach || {}) as OutreachState
  const hasMail = Boolean(outreach.subject)
  const [tab, setTab] = useState<DetailTab>(initialTab === 'email' && !hasMail ? 'contatto' : initialTab)
  const [busy, setBusy] = useState(false)
  const [contact, setContact] = useState({ person: row.contact_person || '', email: row.email || '', phone: row.phone || '' })
  const [noteDraft, setNoteDraft] = useState('')
  const [mail, setMail] = useState({ subject: outreach.subject || '', body: outreach.body || '' })
  const [mailDirty, setMailDirty] = useState(false)
  const [nextStep, setNextStep] = useState((row.meeting_outcome || {}).next_step || '')

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const response = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
        method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id: row.id, ...body }),
      })
      onRowChange(response.exhibitor)
      return response.exhibitor
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function saveContact(toCrm: boolean) {
    const email = contact.email.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Email non valida')
    setBusy(true)
    try {
      let next = (await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
        method: 'PATCH', headers: JSON_HEADERS,
        body: JSON.stringify({ id: row.id, email, phone: contact.phone.trim(), contact_person: contact.person.trim() }),
      })).exhibitor
      if (toCrm) {
        if (next.status === 'new') {
          next = (await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
            method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id: row.id, status: 'contacted' }),
          })).exhibitor
        }
        const made = await apiFetch<{ created: boolean; exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors/contact', {
          method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id: row.id }),
        })
        next = made.exhibitor
        showToast(made.created ? 'Aggiunto al CRM: lo trovi nei follow-up' : 'Contatto del CRM aggiornato')
      } else showToast('Dati salvati')
      onRowChange(next)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile salvare')
    } finally {
      setBusy(false)
    }
  }

  async function addNote() {
    if (!noteDraft.trim()) return
    if (await patch({ note: noteDraft })) setNoteDraft('')
  }

  async function saveMail() {
    if (await patch({ outreach: { subject: mail.subject, body: mail.body } })) {
      setMailDirty(false)
      showToast('Email salvata')
    }
  }

  async function testMail() {
    setBusy(true)
    try {
      const done = await apiFetch<{ to: string }>('/api/trade-fair-exhibitors/outreach/send', {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fair: FAIR, mode: 'test', ids: [row.id] }),
      })
      showToast(`Test inviato a ${done.to}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Test non riuscito')
    } finally {
      setBusy(false)
    }
  }

  const ev = tab === 'punteggio' ? evaluateExhibitor(row) : null
  const flags = row.ttg_flags || {}
  const outcome = row.meeting_outcome || {}
  const location = standLabel(row)
  const sent = Boolean(outreach.sent_at)

  return (
    <div className="fx-detail">
      <div className="fx-links">
        {location ? <strong>📍 {location}</strong> : <span className="fx-muted">Stand non indicato</span>}
        <a href={standMapUrl(row)} target="_blank" rel="noopener noreferrer">Mappa e percorso</a>
        <a href={TTG_HOW_TO_GET_THERE} target="_blank" rel="noopener noreferrer">Come arrivare</a>
        {row.source_url ? <a href={row.source_url} target="_blank" rel="noopener noreferrer">Scheda TTG</a> : null}
        {row.website ? <a href={row.website} target="_blank" rel="noopener noreferrer">Sito</a> : null}
      </div>
      {row.description ? <p className="fx-hint">{row.description}</p> : null}

      <div className="fx-subtabs" role="tablist">
        {([['contatto', 'Contatto e note'], ['punteggio', 'Punteggio'], ...(hasMail ? [['email', 'Email']] : [])] as [DetailTab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" className="fx-subtab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'contatto' ? (
        <>
          <div className="fx-sec">
            <div className="fx-sec-title">Stato</div>
            <div className="fx-actions">
              <select className="fi" style={{ width: 'auto' }} value={row.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })}>
                {TRADE_FAIR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s as TradeFairStatus]}</option>)}
              </select>
              <label className="fx-check">Richiamare il <input className="fi" type="date" style={{ width: 'auto' }} value={row.next_followup_at || ''} disabled={busy}
                onChange={(e) => patch({ next_followup_at: e.target.value || null })} /></label>
              {row.contacted_at ? <span className="fx-muted">Primo contatto {formatStamp(row.contacted_at)}</span> : null}
            </div>
          </div>

          <div className="fx-sec">
            <div className="fx-sec-title">Contatto preso allo stand</div>
            <div className="fx-grid">
              {([['person', 'Con chi hai parlato'], ['email', 'Email corretta'], ['phone', 'Telefono']] as const).map(([field, label]) => (
                <input key={field} className="fi" placeholder={label} type={field === 'email' ? 'email' : 'text'} disabled={busy}
                  value={contact[field]} onChange={(e) => setContact({ ...contact, [field]: e.target.value })} />
              ))}
            </div>
            <div className="fx-actions">
              <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => saveContact(true)}>
                {row.contact_id ? 'Salva e aggiorna il CRM' : 'Salva e aggiungi al CRM'}
              </button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => saveContact(false)}>Solo salva</button>
              {row.contact_id ? <Link className="btn btn-ghost btn-sm" href={`/contacts/${row.contact_id}`}>Apri nel CRM →</Link> : null}
              {row.email ? <a className="btn btn-ghost btn-sm" href={`mailto:${row.email}`}>✉ Scrivi</a> : null}
              {row.phone ? <a className="btn btn-ghost btn-sm" href={`tel:${row.phone}`}>📞 Chiama</a> : null}
            </div>
            <span className="fx-muted">Aggiungendolo al CRM diventa un contatto della pipeline, con richiamo domani (o alla data scelta sopra).</span>
          </div>

          <div className="fx-sec">
            <div className="fx-sec-title">Note</div>
            <div className="fx-actions" style={{ alignItems: 'stretch' }}>
              <textarea className="fi" rows={2} style={{ flex: 1, minWidth: 220 }} placeholder="Cosa vi siete detti, cosa promettere…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
              <button className="btn btn-primary btn-sm" type="button" disabled={busy || !noteDraft.trim()} onClick={addNote}>Aggiungi</button>
            </div>
            {row.notes.map((note) => (
              <div key={note.id} className="fx-note">
                <span><span className="fx-muted">{formatStamp(note.at)} — </span>{note.text}</span>
                <button type="button" className="btn-mini" disabled={busy} onClick={() => patch({ delete_note_id: note.id })}>✕</button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {tab === 'punteggio' && ev ? (
        <>
          <div className="fx-actions">
            <span className="fx-score" data-k={ev.leadClass || effectivePriority(row)} style={{ minWidth: 56 }}>
              {ev.leadClass ? `${ev.leadClass} · ${ev.opportunityScore}` : Math.round(ev.ttgPriorityScore)}
            </span>
            <div>
              <strong style={{ fontSize: 14 }}>{ev.leadClass ? `${CLASS_META[ev.leadClass].label} — ${ev.recommendedAction}` : `Da qualificare (stima ${ev.provisionalClass})`}</strong>
              <div className="fx-muted">Affidabilità dati {ev.confidence} · azione TTG {ev.ttgActionScore}/50 · priorità TTG {ev.ttgPriorityScore}</div>
            </div>
          </div>
          {ev.needsQualification ? <p className="fx-hint">I dati non bastano per una classe. Compila i criteri segnati con «?» (distribuzione, budget, potenziale): bastano pochi secondi allo stand.</p> : null}

          <div className="fx-sec">
            <div className="fx-sec-title">Criteri</div>
            {FACTOR_DEFS.map((def) => {
              const f = ev.factors.find((x) => x.key === def.key)!
              const chosen = row.sos_manual?.[def.key as FactorKey]?.option || ''
              return (
                <div key={def.key} className="fx-crit" data-unknown={f.points === null}>
                  <span title={def.question}>{def.label}</span>
                  <select className="fi" disabled={busy} value={chosen} onChange={(e) => patch({ sos_factor: { key: def.key, option: e.target.value || null } })}>
                    <option value="">{f.points === null ? '? Sconosciuto' : `Dedotto: ${f.optionLabel}`}</option>
                    {def.options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.points})</option>)}
                  </select>
                  <span className="fx-muted">{f.points === null ? `?/${def.max}` : `${f.points}/${def.max} · ${SOURCE_LABELS[f.source!]}`}</span>
                </div>
              )
            })}
          </div>

          <div className="fx-sec">
            <div className="fx-sec-title">In fiera</div>
            <div className="fx-actions">
              {([['decision_maker_present', 'Decisore presente (+10)'], ['partner_intro', 'Introdotto da SNAV / partner (+10)'], ['existing_client', 'Già cliente o partner']] as const).map(([flag, label]) => (
                <label key={flag} className="fx-check"><input type="checkbox" disabled={busy} checked={Boolean(flags[flag])} onChange={(e) => patch({ ttg_flags: { [flag]: e.target.checked } })} /> {label}</label>
              ))}
            </div>
          </div>

          <div className="fx-sec">
            <div className="fx-sec-title">Dopo l&apos;incontro</div>
            <div className="fx-grid">
              <select className="fi" disabled={busy} value={outcome.interest || ''} onChange={(e) => patch({ meeting_outcome: { ...outcome, interest: e.target.value || null } })}>
                <option value="">Interesse: non registrato</option><option value="yes">Ha mostrato interesse</option><option value="maybe">Forse</option><option value="no">Nessun interesse</option>
              </select>
              <select className="fi" disabled={busy} value={outcome.budget_plausible === true ? 'yes' : outcome.budget_plausible === false ? 'no' : ''}
                onChange={(e) => patch({ meeting_outcome: { ...outcome, budget_plausible: e.target.value === '' ? null : e.target.value === 'yes' } })}>
                <option value="">Budget: non so</option><option value="yes">Budget plausibile</option><option value="no">Nessun budget</option>
              </select>
              <input className="fi" placeholder="Prossimo passo concordato" value={nextStep} disabled={busy} onChange={(e) => setNextStep(e.target.value)}
                onBlur={() => nextStep !== (outcome.next_step || '') && patch({ meeting_outcome: { ...outcome, next_step: nextStep } })} />
            </div>
          </div>

          <div className="fx-sec">
            <div className="fx-sec-title">Priorità in lista</div>
            <select className="fi" style={{ width: 'auto', justifySelf: 'start' }} disabled={busy} value={row.priority ?? ''} onChange={(e) => patch({ priority: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Automatica ({PRIORITY_LABELS[effectivePriority({ ...row, priority: null })]})</option>
              <option value="1">Alta</option><option value="2">Media</option><option value="3">Bassa</option>
            </select>
          </div>

          <details className="fx-muted">
            <summary style={{ cursor: 'pointer' }}>Spiegazione e storico modifiche</summary>
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>{ev.explanation.map((line) => <li key={line}>{line}</li>)}</ul>
            {(row.sos_history || []).slice(0, 10).map((h) => (
              <div key={`${h.at}${h.factor}`}>{formatStamp(h.at)} — {FACTOR_DEFS.find((d) => d.key === h.factor)?.label}: {h.from || 'dedotto'} → {h.to || 'dedotto'}</div>
            ))}
          </details>
        </>
      ) : null}

      {tab === 'email' && hasMail ? (
        <>
          <div className="fx-actions">
            <span className="fx-muted">{outreach.template ? TEMPLATE_LABELS[outreach.template as keyof typeof TEMPLATE_LABELS] : ''} · {outreach.lang === 'en' ? 'inglese' : 'italiano'} · a {row.email}</span>
            {sent ? <strong style={{ fontSize: 13 }}>Inviata {formatStamp(outreach.sent_at as string)}</strong> : (
              <label className="fx-check"><input type="checkbox" disabled={busy} checked={Boolean(outreach.selected)} onChange={(e) => patch({ outreach: { selected: e.target.checked } })} /> Invia questa email</label>
            )}
          </div>
          {outreach.note ? <span className="fx-muted" style={{ color: '#92400e' }}>{outreach.note}</span> : null}
          {outreach.error ? <span className="fx-muted" style={{ color: '#b91c1c' }}>Errore: {outreach.error}</span> : null}
          <input className="fi" value={mail.subject} disabled={busy || sent} placeholder="Oggetto" onChange={(e) => { setMail({ ...mail, subject: e.target.value }); setMailDirty(true) }} />
          <textarea className="fi" rows={14} value={mail.body} disabled={busy || sent} onChange={(e) => { setMail({ ...mail, body: e.target.value }); setMailDirty(true) }} />
          {!sent ? (
            <div className="fx-actions">
              <button className="btn btn-primary btn-sm" type="button" disabled={busy || !mailDirty} onClick={saveMail}>Salva modifiche</button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={testMail}>Invia test a me</button>
              <span className="fx-muted">Tieni il footer con «no grazie»: senza, l&apos;invio viene bloccato.</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
