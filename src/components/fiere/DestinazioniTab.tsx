'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { FairExhibitor, normalizeEmail, STATUS_LABELS } from '@/lib/trade-fair'
import { FAIR_EMAIL_COPIES, fairEmailFooter, type FairEmailAudience } from '@/lib/trade-fair-destination-email'
import ElencoTab from './ElencoTab'
import { downloadCsv, FAIR, TYPE_SHORT } from './shared'

type Props = {
  rows: FairExhibitor[]
  now: Date
  showToast: (message: string) => void
  onRowChange: (row: FairExhibitor) => void
  scope: FairEmailAudience
  onReload: () => Promise<void>
}

export default function DestinazioniTab({ rows, now, showToast, onRowChange, scope, onReload }: Props) {
  const [country, setCountry] = useState('')
  const [showEmail, setShowEmail] = useState(false)
  const copyForAudience = FAIR_EMAIL_COPIES[scope]
  const [subject, setSubject] = useState(copyForAudience.subject)
  const [body, setBody] = useState(copyForAudience.body)
  const [signature, setSignature] = useState('')
  const [signatureError, setSignatureError] = useState('')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const sendingRef = useRef(false)
  useEffect(() => {
    let active = true
    apiFetch<{ signature: string }>('/api/trade-fair-exhibitors/destination-email')
      .then((response) => { if (active) setSignature(response.signature) })
      .catch((error) => { if (active) setSignatureError(error instanceof Error ? error.message : 'Firma CRM non disponibile') })
    return () => { active = false }
  }, [scope])
  const countries = useMemo(() => Array.from(new Set(rows.map((row) => row.country?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'it')), [rows])
  const selected = useMemo(() => country ? rows.filter((row) => row.country?.trim() === country) : rows, [rows, country])

  function exportCompleteList() {
    downloadCsv(`destinazioni-${scope}-${FAIR}.csv`,
      [scope === 'operatori' ? 'Tour operator / DMC' : 'Destinazione / Ente', 'Paese', 'Città', 'Tipologia', 'Categoria', 'Padiglione', 'Stand', 'Referente', 'Email', 'Telefono', 'Sito', 'Scheda fiera', 'Stato', 'Prossimo richiamo', 'Note'],
      rows.map((row) => [row.name, row.country, row.city, TYPE_SHORT[row.organization_type || ''] || '', row.category,
        row.hall, row.stand, row.contact_person, row.email, row.phone, row.website, row.source_url,
        STATUS_LABELS[row.status], row.next_followup_at, row.notes.map((note) => note.text).join(' | ')]))
  }

  async function copy(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast(success)
    } catch {
      showToast('Copia non riuscita: seleziona il testo e copialo manualmente.')
    }
  }

  async function send(row: FairExhibitor) {
    if (sendingRef.current) return
    sendingRef.current = true
    setSendingId(row.id)
    try {
      const result = await apiFetch<{ exhibitor: FairExhibitor; to: string; warning?: string | null }>('/api/trade-fair-exhibitors/destination-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, subject, text: body }),
      })
      onRowChange(result.exhibitor)
      showToast(result.warning || `Email inviata a ${result.to}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Invio non riuscito')
      await onReload()
    } finally {
      sendingRef.current = false
      setSendingId(null)
    }
  }

  function sendButton(row: FairExhibitor) {
    const state = row.outreach?.destination_email?.status
    const noEmail = !normalizeEmail(row.email)
    const excluded = row.status === 'not_interested'
    const label = sendingId === row.id ? 'Invio…' : state === 'sent' ? '✓ Inviata'
      : state ? 'Verifica in Gmail' : noEmail ? 'Email mancante' : excluded ? 'Non interessato' : 'Invia email'
    return <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(sendingId || state || noEmail || excluded || !signature || !subject.trim() || !body.trim())}
      title={state && state !== 'sent' ? 'Verifica l’esito nella cartella Inviati di Gmail.' : row.email || undefined}
      aria-label={`${label} · ${row.name}`} onClick={() => send(row)}>{label}</button>
  }

  const recipients = Array.from(new Set(rows.map((row) => normalizeEmail(row.email)).filter((email): email is string => Boolean(email))))
  const label = scope === 'operatori' ? 'tour operator e DMC' : `destinazioni ${scope}`

  return (
    <>
      <section className="fx-card">
        <strong>{rows.length} {label} nel catalogo importato</strong>
        <p className="fx-hint">{scope === 'operatori' ? 'Operatori da valutare per la distribuzione delle mappe o una fornitura in blocco per i loro viaggi.' : `Enti del turismo, consorzi e associazioni di promozione territoriale${scope === 'estere' ? ', incluse le rappresentanze con sede in Italia' : ' italiani'}.`} L’elenco iniziale include tutti gli stati e tutte le priorità.</p>
        <div className="fx-bar">
          {scope !== 'italiane' ? <select className="fi" aria-label="Filtra per paese" value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">Tutti i paesi</option>
            {countries.map((value) => <option key={value} value={value}>{value}</option>)}
          </select> : null}
          <button type="button" className="btn btn-primary btn-sm" onClick={exportCompleteList} disabled={!rows.length}>⬇ Esporta elenco completo in CSV</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowEmail((value) => !value)} aria-expanded={showEmail}>✉ Bozza email</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!recipients.length} onClick={() => copy(recipients.join('; '), `${recipients.length} indirizzi unici copiati`)}>Copia indirizzi · {recipients.length}</button>
        </div>
      </section>
      <p className="fx-hint">Email già abbinata a questa lista{copyForAudience.lang === 'en' ? ' in inglese' : ' in italiano'}. Il pulsante «Invia email» invia subito a quell’espositore il testo della bozza con la firma salvata nel CRM.</p>
      {signatureError ? <div className="fx-card" role="alert">{signatureError}</div> : null}
      {showEmail ? <section className="fx-card">
        <strong>Email per {label}</strong>
        <label>Oggetto<input className="fi" value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label>Messaggio<textarea className="fi" rows={18} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <div><strong>Firma dal CRM</strong><div style={{ whiteSpace: 'pre-wrap' }}>{signature || signatureError || 'Caricamento firma…'}</div></div>
        <div className="fx-actions"><button type="button" className="btn btn-primary btn-sm" disabled={!signature} onClick={() => copy(`Oggetto: ${subject}\n\n${body}\n\n${signature}\n\n${fairEmailFooter(copyForAudience.lang)}`, 'Email copiata')}>Copia email</button></div>
        <p className="fx-hint">Le modifiche al testo saranno usate per i successivi clic su «Invia email». La firma viene aggiunta automaticamente.</p>
      </section> : null}
      {rows.length ? <ElencoTab key={country} rows={selected} now={now} showToast={showToast} onRowChange={onRowChange} completeList renderRowAction={sendButton} />
        : <div className="fx-card fx-empty">Nessun espositore riconosciuto per questa lista nel catalogo importato. Controlla che l’elenco includa paese e categoria.</div>}
    </>
  )
}
