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
  const pendingDrafts = rows.filter((row) => row.outreach?.destination_email?.status === 'draft').map((row) => row.id).join(',')
  useEffect(() => {
    if (!pendingDrafts) return
    const ids = pendingDrafts.split(',')
    let active = true
    let checking = false
    let offset = 0
    async function check() {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      const group = ids.slice(offset, offset + 5)
      offset = offset + 5 >= ids.length ? 0 : offset + 5
      try {
        await Promise.allSettled(group.map(async (id) => {
          const response = await apiFetch<{ exhibitor: FairExhibitor }>(`/api/trade-fair-exhibitors/destination-email?id=${encodeURIComponent(id)}`)
          if (active && response.exhibitor.outreach?.destination_email?.status === 'sent') onRowChange(response.exhibitor)
        }))
      } finally { checking = false }
    }
    check()
    const interval = window.setInterval(check, 30000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false; window.clearInterval(interval)
      window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check)
    }
  }, [pendingDrafts, onRowChange])

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

  async function openInGmail(row: FairExhibitor) {
    if (sendingRef.current) return
    sendingRef.current = true
    setSendingId(row.id)
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null
    try {
      const result = await apiFetch<{ exhibitor: FairExhibitor; to: string; url: string; warning?: string | null }>('/api/trade-fair-exhibitors/destination-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, subject, text: body, mode: 'draft' }),
      })
      onRowChange(result.exhibitor)
      if (popup) popup.location.href = result.url
      showToast(result.warning || (popup ? `Bozza pronta per ${result.to}: inviala da Gmail con Mailtrack attivo.` : 'Bozza pronta in Gmail. Consenti l’apertura della nuova scheda e premi di nuovo «Apri in Gmail».'))
    } catch (error) {
      popup?.close()
      showToast(error instanceof Error ? error.message : 'Impossibile creare la bozza Gmail')
      await onReload()
    } finally {
      sendingRef.current = false; setSendingId(null)
    }
  }

  function sendButton(row: FairExhibitor) {
    const state = row.outreach?.destination_email?.status
    const noEmail = !normalizeEmail(row.email)
    const excluded = row.status === 'not_interested'
    const label = sendingId === row.id ? 'Invio…' : state === 'sent' ? '✓ Inviata'
      : state ? 'Verifica in Gmail' : noEmail ? 'Email mancante' : excluded ? 'Non interessato' : 'Invia email'
    const blocked = Boolean(sendingId || noEmail || excluded || !signature || !subject.trim() || !body.trim())
    if (state === 'sent') return <button type="button" className="btn btn-ghost btn-sm" disabled>✓ Inviata</button>
    return <div className="fx-email-actions">
      <button type="button" className="btn btn-primary btn-sm" disabled={blocked || Boolean(state && state !== 'draft')}
        title="Apri la bozza nel browser dove Mailtrack è attivo e inviala da Gmail."
        aria-label={`Apri in Gmail · ${row.name}`} onClick={() => openInGmail(row)}>{sendingId === row.id ? 'Preparo…' : state === 'draft' ? 'Apri bozza Gmail' : 'Apri in Gmail'}</button>
      {state !== 'draft' ? <button type="button" className="btn btn-ghost btn-sm" disabled={blocked || Boolean(state)}
      title={state ? 'Verifica l’esito nella cartella Inviati di Gmail.' : row.email || undefined}
      aria-label={`${label} · ${row.name}`} onClick={() => send(row)}>{!state && !noEmail && !excluded ? 'Invia dal CRM' : label}</button> : <span className="fx-muted">Da inviare in Gmail</span>}
    </div>
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
      <p className="fx-hint">Email già abbinata a questa lista{copyForAudience.lang === 'en' ? ' in inglese' : ' in italiano'}. Per Mailtrack usa «Apri in Gmail» e invia la bozza da Chrome con l’estensione attiva. «Invia dal CRM» effettua l’invio diretto senza Mailtrack.</p>
      {signatureError ? <div className="fx-card" role="alert">{signatureError}</div> : null}
      {showEmail ? <section className="fx-card">
        <strong>Email per {label}</strong>
        <label>Oggetto<input className="fi" value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label>Messaggio<textarea className="fi" rows={18} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <div><strong>Firma dal CRM</strong><div style={{ whiteSpace: 'pre-wrap' }}>{signature || signatureError || 'Caricamento firma…'}</div></div>
        <div className="fx-actions"><button type="button" className="btn btn-primary btn-sm" disabled={!signature} onClick={() => copy(`Oggetto: ${subject}\n\n${body}\n\n${signature}\n\n${fairEmailFooter(copyForAudience.lang)}`, 'Email copiata')}>Copia email</button></div>
        <p className="fx-hint">Le modifiche saranno usate per i prossimi invii e le nuove bozze Gmail. Una bozza già preparata si riapre senza sovrascrivere le modifiche fatte in Gmail. La firma viene aggiunta automaticamente.</p>
      </section> : null}
      {rows.length ? <ElencoTab key={country} rows={selected} now={now} showToast={showToast} onRowChange={onRowChange} completeList renderRowAction={sendButton} />
        : <div className="fx-card fx-empty">Nessun espositore riconosciuto per questa lista nel catalogo importato. Controlla che l’elenco includa paese e categoria.</div>}
    </>
  )
}
