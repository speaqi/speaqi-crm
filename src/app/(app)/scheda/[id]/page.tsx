'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { formatEuroPlain } from '@/lib/command-center'
import { statusLabel } from '@/lib/data'

/**
 * Scheda completa di un cliente: tutto quello che c'e' su di lui, in una
 * pagina sola. Si legge e basta (le modifiche restano nelle loro pagine), con
 * una sola scrittura: collegare una mappa al contatto.
 */

type Overview = {
  contact: Record<string, any>
  headline: string
  deals: Array<{ id: string; title: string; counterparty: string | null; stage: string; value: number | null; outcome: string | null; closed_at: string | null; created_at: string }>
  quotes: Array<{
    id: string
    quote_number: string
    title: string | null
    status: string
    payment_state: string | null
    total_amount: number
    paid_at: string | null
    sent_at: string | null
    billing_interval: string | null
    public_token: string
    signature: { signer_name: string; channel: string; signed_at: string } | null
  }>
  subscription: { quote_id: string; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean; amount: number } | null
  invoices: Array<{ id: string; numero: string | null; status: string; issue_date: string | null; totale: number; sdi_status: string | null; last_error: string | null; aruba_env: string | null }>
  agency: Array<{ id: string; title: string; stage: string; presentations: Array<{ id: string; title: string; status: string; public_token: string | null }> }>
  tourism: { entities: Array<{ id: string; name: string; kind: string }>; decks: Array<{ id: string; title: string; destination: string | null; status: string; public_token: string | null }> }
  maps: Array<{ ref: string; origin: 'manual' | 'tourism'; name: string; stage_label: string; places: number | null; url: string | null; link_id?: string; role?: string; destination?: string | null }>
  maps_sources: { studiomap: string; speaqi: string }
  tasks: Array<{ id: string; type: string; due_date: string | null; priority: string | null; note: string | null }>
  activities: Array<{ id: string; type: string; content: string | null; created_at: string }>
  emails: Array<{ id: string; direction: string; subject: string | null; snippet: string | null; sent_at: string | null }>
}

const QUOTE_STATUS: Record<string, string> = { draft: 'Bozza', sent: 'Inviato', accepted: 'Accettato', paid: 'Pagato', cancelled: 'Annullato' }
const INVOICE_STATUS: Record<string, string> = {
  draft: 'Bozza',
  sending: 'In invio',
  sent: 'Inviata allo SDI',
  delivered: 'Consegnata',
  not_delivered: 'Non consegnata',
  accepted: 'Accettata',
  refused: 'Rifiutata',
  rejected: 'Scartata',
  error: 'Errore',
}
const DOC_STATUS: Record<string, string> = { draft: 'Bozza', generating: 'In generazione', ready: 'Da approvare', approved: 'Approvata', failed: 'Non riuscita' }
const ROLE_LABEL: Record<string, string> = { client: 'cliente nella mappa', partner: 'partner', prospect: 'da proporre', guide: 'guida' }

function d(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="sc-section">
      <h2>
        {title}
        {count != null && <span className="sc-count">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

export default function SchedaPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapRef, setMapRef] = useState('')
  const [mapRole, setMapRole] = useState('client')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    apiFetch<Overview>(`/api/contacts/${id}/overview`)
      .then((value) => {
        setData(value)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Errore'))
  }, [id])

  useEffect(load, [load])

  async function linkMap() {
    if (mapRef.trim().length < 2) return
    setSaving(true)
    try {
      await apiFetch(`/api/contacts/${id}/maps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map_ref: mapRef.trim(), role: mapRole }) })
      setMapRef('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Collegamento non riuscito')
    } finally {
      setSaving(false)
    }
  }

  async function unlinkMap(linkId: string) {
    await apiFetch(`/api/contacts/${id}/maps?link_id=${linkId}`, { method: 'DELETE' }).catch(() => null)
    load()
  }

  if (error && !data) return <div className="sc-page"><p className="cc-error">{error}</p></div>
  if (!data) return <div className="sc-page"><p className="cc-muted">Carico la scheda…</p></div>

  const c = data.contact
  const paidTotal = data.quotes.filter((q) => q.status === 'paid' || q.payment_state === 'paid').reduce((sum, q) => sum + Math.round(q.total_amount * 100), 0) / 100

  return (
    <div className="sc-page">
      <header className="sc-head">
        <div>
          <p className="sc-kicker">
            <Link href="/dashboard">← Prima pagina</Link>
          </p>
          <h1>{c.company || c.name}</h1>
          <p className="sc-who">
            {c.company && c.name !== c.company ? `${c.name} · ` : ''}
            {[c.email, c.phone, c.billing_city].filter(Boolean).join(' · ')}
          </p>
          <p className="sc-headline">{data.headline}</p>
        </div>
        <div className="sc-head-side">
          <span className="sc-status">{statusLabel(c.status)}</span>
          {c.responsible && <span className="cc-muted">Segue: {c.responsible}</span>}
          <Link className="btn btn-ghost btn-sm" href={`/contacts/${c.id}`}>
            Apri il contatto
          </Link>
        </div>
      </header>
      {error && <p className="cc-error">{error}</p>}

      <div className="sc-facts">
        <div><span className="cc-muted">Incassato</span><b>{formatEuroPlain(paidTotal)}</b></div>
        <div><span className="cc-muted">Preventivi</span><b>{data.quotes.length}</b></div>
        <div><span className="cc-muted">Fatture</span><b>{data.invoices.length}</b></div>
        <div><span className="cc-muted">Mappe</span><b>{data.maps.length}</b></div>
        <div><span className="cc-muted">Da fare</span><b>{data.tasks.length}</b></div>
      </div>

      <div className="sc-grid">
        <Section title="Contratti e preventivi" count={data.quotes.length}>
          {data.subscription && (
            <p className={`sc-sub ${data.subscription.status === 'past_due' ? 'sc-bad' : ''}`}>
              Abbonamento {data.subscription.status === 'past_due' ? 'con pagamento non riuscito' : data.subscription.cancel_at_period_end ? 'disdetto' : 'attivo'} · {formatEuroPlain(data.subscription.amount)}/anno · rinnovo {d(data.subscription.current_period_end)}
            </p>
          )}
          {data.quotes.length === 0 ? (
            <p className="cc-muted">Nessun preventivo. <Link href="/preventivi">Crea un preventivo</Link></p>
          ) : (
            <table className="sc-table">
              <tbody>
                {data.quotes.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link href={`/preventivi?edit=${q.id}`}>{q.quote_number}</Link>
                      <div className="cc-muted">{q.title}</div>
                    </td>
                    <td>{formatEuroPlain(q.total_amount)}{q.billing_interval === 'year' ? '/anno' : ''}</td>
                    <td>
                      {QUOTE_STATUS[q.status] || q.status}
                      <div className="cc-muted">
                        {q.signature ? `Firmato da ${q.signature.signer_name} il ${d(q.signature.signed_at)}${q.signature.channel === 'in_person' ? ' (in presenza)' : ''}` : q.sent_at ? `Inviato ${d(q.sent_at)}, non firmato` : ''}
                        {q.paid_at ? ` · pagato ${d(q.paid_at)}` : ''}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Fatture" count={data.invoices.length}>
          {data.invoices.length === 0 ? (
            <p className="cc-muted">Nessuna fattura. <Link href="/fatture">Vai a Fatture</Link></p>
          ) : (
            <table className="sc-table">
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href="/fatture">{inv.numero ? `N. ${inv.numero}` : 'Bozza'}</Link>
                      <div className="cc-muted">{d(inv.issue_date)}{inv.aruba_env === 'demo' ? ' · demo Aruba' : ''}</div>
                    </td>
                    <td>{formatEuroPlain(inv.totale)}</td>
                    <td>
                      {INVOICE_STATUS[inv.status] || inv.status}
                      {(inv.sdi_status || inv.last_error) && <div className="cc-muted">{inv.last_error || inv.sdi_status}</div>}
                    </td>
                    <td>
                      {inv.numero && (
                        <a href={`/api/invoices/${inv.id}/xml`} onClick={(event) => { event.preventDefault(); downloadXml(inv.id, inv.numero) }}>
                          XML
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Mappe" count={data.maps.length}>
          {data.maps_sources.studiomap !== 'ok' && <p className="cc-muted">StudioMap non disponibile: lo stato viene solo dalle guide online.</p>}
          {data.maps.length === 0 && <p className="cc-muted">Nessuna mappa collegata.</p>}
          <ul className="sc-list">
            {data.maps.map((m) => (
              <li key={`${m.origin}-${m.ref}`}>
                <strong>{m.name}</strong> <span className="cc-muted">{m.stage_label}{m.places != null ? ` · ${m.places} luoghi` : ''}</span>
                <div className="cc-muted">
                  {m.origin === 'tourism' ? `Dall’ente (destinazione ${m.destination || m.ref})` : ROLE_LABEL[m.role || 'client']}
                  {m.url && <> · <a href={m.url} target="_blank" rel="noreferrer">Apri ↗</a></>}
                  {m.link_id && <> · <button type="button" className="sc-link" onClick={() => unlinkMap(m.link_id!)}>Scollega</button></>}
                </div>
              </li>
            ))}
          </ul>
          <div className="sc-inline-form">
            <input value={mapRef} onChange={(event) => setMapRef(event.target.value)} placeholder="Slug o nome della mappa (es. capri)" />
            <select value={mapRole} onChange={(event) => setMapRole(event.target.value)}>
              {Object.entries(ROLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving || mapRef.trim().length < 2} onClick={linkMap}>
              Collega
            </button>
          </div>
        </Section>

        <Section title="Trattative" count={data.deals.length}>
          {data.deals.length === 0 ? (
            <p className="cc-muted">Nessuna trattativa.</p>
          ) : (
            <ul className="sc-list">
              {data.deals.map((deal) => (
                <li key={deal.id}>
                  <strong>{deal.title}</strong>
                  {deal.counterparty && <span className="cc-muted"> con {deal.counterparty}</span>}
                  <div className="cc-muted">
                    {deal.closed_at ? `Chiusa ${d(deal.closed_at)}${deal.outcome ? ` (${deal.outcome})` : ''}` : `Aperta · fase ${statusLabel(deal.stage)}`}
                    {deal.value ? ` · ${formatEuroPlain(Number(deal.value))}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {(data.agency.length > 0 || data.tourism.decks.length > 0 || data.tourism.entities.length > 0) && (
          <Section title="Proposte e presentazioni">
            <ul className="sc-list">
              {data.agency.map((p) => (
                <li key={p.id}>
                  <Link href={`/agency/${p.id}`}><strong>{p.title}</strong></Link> <span className="cc-muted">Agency · {p.stage}</span>
                  {p.presentations.map((pr) => (
                    <div key={pr.id} className="cc-muted">
                      <Link href={`/agency/presentazioni/${pr.id}`}>{pr.title}</Link> · {DOC_STATUS[pr.status] || pr.status}
                    </div>
                  ))}
                </li>
              ))}
              {data.tourism.entities.map((e) => (
                <li key={e.id}>
                  <strong>{e.name}</strong> <span className="cc-muted">Ente in Tourism Intelligence</span>
                </li>
              ))}
              {data.tourism.decks.map((deck) => (
                <li key={deck.id}>
                  <strong>{deck.title}</strong> <span className="cc-muted">{deck.destination} · {DOC_STATUS[deck.status] || deck.status}</span>
                  {deck.public_token && deck.status === 'approved' && (
                    <div className="cc-muted"><a href={`/presentazione/${deck.public_token}`} target="_blank" rel="noreferrer">Link pubblico ↗</a></div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Da fare" count={data.tasks.length}>
          {data.tasks.length === 0 ? (
            <p className="cc-muted">Nessuna attività in sospeso.</p>
          ) : (
            <ul className="sc-list">
              {data.tasks.map((t) => (
                <li key={t.id}>
                  <strong>{t.note || t.type}</strong> <span className="cc-muted">{t.type} · {d(t.due_date)}{t.priority === 'high' ? ' · alta priorità' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Ultimi movimenti">
          <ul className="sc-list">
            {data.emails.map((m) => (
              <li key={`e-${m.id}`}>
                <span className="cc-muted">{d(m.sent_at)} · {m.direction === 'inbound' ? 'email ricevuta' : 'email inviata'}</span>
                <div><strong>{m.subject || '(senza oggetto)'}</strong></div>
                {m.snippet && <div className="cc-muted sc-clamp">{m.snippet}</div>}
              </li>
            ))}
            {data.activities.map((a) => (
              <li key={`a-${a.id}`}>
                <span className="cc-muted">{d(a.created_at)} · {a.type}</span>
                {a.content && <div className="sc-clamp">{a.content}</div>}
              </li>
            ))}
            {data.emails.length === 0 && data.activities.length === 0 && <li className="cc-muted">Nessun movimento registrato.</li>}
          </ul>
        </Section>
      </div>
    </div>
  )
}

async function downloadXml(invoiceId: string, numero: string | null) {
  const { createClient } = await import('@/lib/supabase')
  const { data } = await createClient().auth.getSession()
  const response = await fetch(`/api/invoices/${invoiceId}/xml`, { headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} })
  if (!response.ok) return
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fattura-${(numero || invoiceId).replace(/[^\w-]+/g, '-')}.xml`
  a.click()
  URL.revokeObjectURL(url)
}
