'use client'

import { useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { FairExhibitor, compareExhibitors } from '@/lib/trade-fair'
import { DAILY_OUTREACH_CAP, isOutreachAligned, OutreachState } from '@/lib/trade-fair-outreach'
import ExhibitorDetail from './ExhibitorDetail'
import { FAIR, formatStamp, TYPE_SHORT } from './shared'

type Props = {
  rows: FairExhibitor[]
  now: Date
  showToast: (message: string) => void
  onRowChange: (row: FairExhibitor) => void
  onReload: () => Promise<void>
}

const PAGE = 40

export default function MailingTab({ rows, now, showToast, onRowChange, onReload }: Props) {
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'send' | 'excluded' | 'sent'>('send')
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)

  const o = (row: FairExhibitor) => (row.outreach || {}) as OutreachState
  const stats = useMemo(() => ({
    aligned: rows.filter(isOutreachAligned).length,
    prepared: rows.filter((r) => o(r).subject && !o(r).sent_at).length,
    selected: rows.filter((r) => o(r).selected && !o(r).sent_at).length,
    sent: rows.filter((r) => o(r).sent_at).length,
    tested: rows.some((r) => o(r).test_sent_at),
  }), [rows])

  const list = useMemo(() => rows
    .filter((r) => (view === 'sent' ? Boolean(o(r).sent_at) : Boolean(o(r).subject) && !o(r).sent_at && (view === 'send' ? o(r).selected : !o(r).selected)))
    .sort((a, b) => compareExhibitors(a, b, now)), [rows, view, now])

  async function call(path: string, payload: Record<string, unknown>) {
    setBusy(true)
    try {
      return await apiFetch<any>(`/api/trade-fair-exhibitors/outreach/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fair: FAIR, ...payload }),
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Operazione non riuscita')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function prepare() {
    const preview = await call('prepare', { dry_run: true })
    if (!preview) return
    if (!window.confirm(`Preparo ${preview.aligned} email (${preview.duplicates} doppioni di indirizzo restano deselezionati). Non invio nulla. Procedo?`)) return
    const done = await call('prepare', {})
    if (done) { showToast(`Preparate ${done.prepared} email`); await onReload() }
  }

  async function test() {
    const done = await call('send', { mode: 'test' })
    if (done) { showToast(`Test inviato a ${done.to}: ${done.sent} email, controlla la casella`); await onReload() }
  }

  async function send() {
    if (!window.confirm(`Invio ora fino a 20 email reali agli espositori selezionati (tetto ${DAILY_OUTREACH_CAP} al giorno), dal tuo Gmail. Hai controllato il test? Procedo?`)) return
    const done = await call('send', { mode: 'send', confirm: true })
    if (done) {
      showToast(`Inviate ${done.sent}${done.failed ? `, ${done.failed} non riuscite` : ''}. Oggi ne restano ${done.remaining_today}`)
      await onReload()
    }
  }

  const nextStep = stats.prepared + stats.sent === 0 ? 1 : !stats.tested ? 2 : 3
  const steps = [
    { n: 1, done: stats.prepared > 0 || stats.sent > 0, title: 'Prepara le email', text: `${stats.aligned} espositori in linea con Speaqi (enti del turismo, consorzi, DMC, tour operator, navigazione, catene, attrazioni) con email e ancora da contattare. Una email per tipologia, in inglese per l'estero. Non invia nulla.`, action: stats.prepared + stats.sent > 0 ? 'Riprepara' : 'Prepara', onClick: prepare, disabled: busy || !stats.aligned },
    { n: 2, done: stats.tested, title: 'Fai un test privato', text: 'Ti arrivano 3 email nella tua casella, con oggetto [TEST]: controlla testo, stand e footer.', action: 'Invia 3 test a me', onClick: test, disabled: busy || !stats.prepared },
    { n: 3, done: stats.sent > 0, title: 'Invia le selezionate', text: `${stats.selected} da inviare, ${stats.sent} già inviate. Parte dal tuo Gmail, 20 per volta e al massimo ${DAILY_OUTREACH_CAP} al giorno, dai più prioritari. Le risposte arrivano nella tua casella.`, action: 'Invia 20', onClick: send, disabled: busy || !stats.selected },
  ]

  return (
    <>
      <div className="fx-card">
        {steps.map((s) => (
          <div key={s.n} className="fx-step" data-done={s.done}>
            <span className="fx-step-n">{s.done ? '✓' : s.n}</span>
            <div><strong style={{ fontSize: 14 }}>{s.title}</strong><div className="fx-hint">{s.text}</div></div>
            <button className={`btn btn-sm ${s.n === nextStep ? 'btn-primary' : 'btn-ghost'}`} type="button" disabled={s.disabled} onClick={s.onClick}>{busy ? '…' : s.action}</button>
          </div>
        ))}
      </div>

      {stats.prepared + stats.sent > 0 ? (
        <>
          <div className="fx-chips" role="group" aria-label="Elenco email">
            {([['send', `Da inviare · ${stats.selected}`], ['excluded', `Escluse · ${stats.prepared - stats.selected}`], ['sent', `Inviate · ${stats.sent}`]] as const).map(([id, label]) => (
              <button key={id} type="button" className="fx-chip" aria-pressed={view === id} onClick={() => { setView(id); setLimit(PAGE) }}>{label}</button>
            ))}
          </div>
          <p className="fx-hint">Apri un&apos;email per leggerla o correggerla; la spunta decide se parte. Gli indirizzi doppi sono già esclusi.</p>
          {list.length === 0 ? <div className="fx-card fx-empty">Nessuna email in questo elenco.</div> : (
            <ul className="fx-list">
              {list.slice(0, limit).map((row) => {
                const open = openId === row.id
                const mail = o(row)
                return (
                  <li key={row.id} className="fx-item" data-open={open}>
                    <div className="fx-row" style={{ gridTemplateColumns: '28px minmax(0, 1fr) auto', cursor: 'pointer' }} onClick={() => setOpenId(open ? null : row.id)}>
                      {mail.sent_at ? <span>✉</span> : (
                        <input type="checkbox" checked={Boolean(mail.selected)} aria-label="Invia questa email" onClick={(e) => e.stopPropagation()}
                          onChange={async (e) => {
                            try {
                              const r = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, outreach: { selected: e.target.checked } }) })
                              onRowChange(r.exhibitor)
                            } catch (error) { showToast(error instanceof Error ? error.message : 'Impossibile aggiornare') }
                          }} />
                      )}
                      <span>
                        <div className="fx-name">{row.name} <span className="fx-muted" style={{ fontWeight: 400 }}>· {TYPE_SHORT[row.organization_type || '']}</span></div>
                        <div className="fx-meta"><span>{row.email}</span><span>· {mail.subject}</span></div>
                      </span>
                      <span className="fx-muted">{mail.sent_at ? formatStamp(mail.sent_at) : mail.lang === 'en' ? 'EN' : 'IT'}{mail.error ? ' ⚠' : ''}</span>
                    </div>
                    {open ? <ExhibitorDetail row={row} initialTab="email" showToast={showToast} onRowChange={onRowChange} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
          {list.length > limit ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => setLimit((v) => v + PAGE)}>Mostra altre ({list.length - limit})</button> : null}
        </>
      ) : null}
    </>
  )
}
