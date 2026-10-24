'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { formatEuroPlain, MAP_STAGE_LABEL, type MapStage, type MapStatusRow, type WaitingItem } from '@/lib/command-center'

/**
 * La testa della prima pagina, solo per il titolare: una ricerca su tutto
 * (contatti di ogni lista, enti, mappe) e quattro riquadri — cosa aspetta te,
 * i soldi, le vendite, le mappe. Il resto della pagina (chiamate, coda) resta
 * sotto, com'era.
 */

type Overview = {
  office: { active_agents?: number; pending_count?: number; totals?: { day_actual: number; day_reserved: number }; error: string | null }
  waiting: WaitingItem[]
  money: {
    paid_month: number
    paid_month_count: number
    invoiced_month: number
    to_invoice_count: number
    to_invoice_amount: number
    renewals: Array<{ id: string; label: string; date: string; amount: number; contact_id: string | null }>
    renewals_amount: number
    past_due: Array<{ id: string; label: string; amount: number; contact_id: string | null }>
  }
  sales: {
    open_deals: number
    by_stage: Array<{ stage: string; count: number; value: number }>
    awaiting_signature: Array<{ id: string; label: string; amount: number; sent_at: string | null; contact_id: string | null }>
    awaiting_signature_count: number
    awaiting_signature_amount: number
  }
  maps: { counts: Record<MapStage, number>; rows: MapStatusRow[]; sources: { studiomap: string; speaqi: string } }
}

type SearchResult = {
  contacts: Array<{ id: string; name: string; company: string | null; email: string | null; status: string; contact_scope: string | null; billing_city: string | null }>
  entities: Array<{ id: string; name: string; kind: string; country_code: string; contact_id: string | null }>
  maps: MapStatusRow[]
}

const STAGE_ORDER: MapStage[] = ['online', 'su_speaqi', 'pronta', 'in_lavorazione']

function shortDate(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function AskBar() {
  const [q, setQ] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) {
      setResult(null)
      return
    }
    const mine = ++seq.current
    setLoading(true)
    const timer = setTimeout(() => {
      apiFetch<SearchResult>(`/api/command-center/search?q=${encodeURIComponent(text)}`)
        .then((data) => mine === seq.current && setResult(data))
        .catch(() => mine === seq.current && setResult({ contacts: [], entities: [], maps: [] }))
        .finally(() => mine === seq.current && setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  const empty = result && !result.contacts.length && !result.entities.length && !result.maps.length

  return (
    <div className="cc-ask">
      <input
        className="cc-ask-input"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Cerca un cliente, un ente o una mappa: «Bellavista», «Comune di Sorrento», «Capri»…"
        aria-label="Cerca in tutto il CRM"
      />
      {loading && <span className="cc-ask-hint">Cerco…</span>}
      {result && (
        <div className="cc-ask-results">
          {empty && <p className="cc-muted">Nessun risultato per «{q.trim()}».</p>}
          {result.contacts.map((c) => (
            <Link key={c.id} href={`/scheda/${c.id}`} className="cc-ask-row">
              <strong>{c.company || c.name}</strong>
              <span className="cc-muted">
                {c.company && c.name !== c.company ? `${c.name} · ` : ''}
                {c.billing_city ? `${c.billing_city} · ` : ''}
                {c.status}
                {c.contact_scope && c.contact_scope !== 'crm' ? ` · ${c.contact_scope}` : ''}
              </span>
              <span className="cc-ask-go">Scheda completa →</span>
            </Link>
          ))}
          {result.entities.map((e) =>
            e.contact_id ? (
              <Link key={e.id} href={`/scheda/${e.contact_id}`} className="cc-ask-row">
                <strong>{e.name}</strong>
                <span className="cc-muted">Ente · {e.kind === 'place' ? 'luogo' : 'organizzazione'} {e.country_code}</span>
                <span className="cc-ask-go">Scheda completa →</span>
              </Link>
            ) : (
              <Link key={e.id} href="/tourism" className="cc-ask-row">
                <strong>{e.name}</strong>
                <span className="cc-muted">Ente in Tourism Intelligence, non ancora nel CRM</span>
                <span className="cc-ask-go">Tourism →</span>
              </Link>
            )
          )}
          {result.maps.map((m) => (
            <div key={m.key} className="cc-ask-row">
              <strong>Mappa {m.name}</strong>
              <span className="cc-muted">
                {MAP_STAGE_LABEL[m.stage]}
                {m.places != null ? ` · ${m.places} luoghi` : ''}
                {m.price_cents ? ` · ${formatEuroPlain(m.price_cents / 100)}` : ''}
              </span>
              {m.speaqi_slug && (
                <a className="cc-ask-go" href={`https://guides.speaqi.com/maps/${m.speaqi_slug}`} target="_blank" rel="noreferrer">
                  Apri ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommandCenter() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showMaps, setShowMaps] = useState(false)

  useEffect(() => {
    apiFetch<Overview>('/api/command-center')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Errore'))
  }, [])

  return (
    <section className="cc">
      <AskBar />
      {error && <p className="cc-error">Il riepilogo non si è caricato: {error}</p>}
      {!data && !error && <p className="cc-muted">Carico il riepilogo…</p>}
      {data && (
        <div className="cc-grid">
          <div className="cc-card cc-card-wide">
            <h3>Aspetta te</h3>
            {data.waiting.length === 0 ? (
              <p className="cc-muted">Niente di fermo su di te.</p>
            ) : (
              <ul className="cc-list">
                {data.waiting.slice(0, 8).map((item, index) => (
                  <li key={`${item.kind}-${index}`} className={`cc-item cc-tone-${item.tone}`}>
                    <Link href={item.href}>
                      <strong>{item.title}</strong>
                      <span className="cc-muted">{item.detail}</span>
                    </Link>
                  </li>
                ))}
                {data.waiting.length > 8 && <li className="cc-muted">e altre {data.waiting.length - 8}</li>}
              </ul>
            )}
          </div>

          <div className="cc-card">
            <h3>Ufficio</h3>
            {data.office.error ? <p className="cc-muted">{data.office.error}</p> : <>
              <div className="cc-kpi"><span className="cc-kpi-value">{data.office.active_agents}</span><span className="cc-muted">agenti attivi</span></div>
              <dl className="cc-dl"><dt>Spesa oggi</dt><dd>{formatEuroPlain((data.office.totals?.day_actual || 0) / 100)}</dd>
                <dt>Prenotato</dt><dd>{formatEuroPlain((data.office.totals?.day_reserved || 0) / 100)}</dd>
                <dt>Aspetta te</dt><dd>{data.office.pending_count}</dd></dl>
            </>}
            <Link href="/ufficio" className="btn btn-ghost btn-sm">Apri l’Ufficio →</Link>
          </div>

          <div className="cc-card">
            <h3>Soldi</h3>
            <div className="cc-kpi">
              <span className="cc-kpi-value">{formatEuroPlain(data.money.paid_month)}</span>
              <span className="cc-muted">incassati questo mese ({data.money.paid_month_count})</span>
            </div>
            <dl className="cc-dl">
              <dt>Fatturato nel mese</dt>
              <dd>{formatEuroPlain(data.money.invoiced_month)}</dd>
              <dt>Pagato, da fatturare</dt>
              <dd>
                {data.money.to_invoice_count ? <Link href="/fatture">{data.money.to_invoice_count} · {formatEuroPlain(data.money.to_invoice_amount)}</Link> : '—'}
              </dd>
              <dt>Rinnovi in 30 giorni</dt>
              <dd>{data.money.renewals.length ? `${data.money.renewals.length} · ${formatEuroPlain(data.money.renewals_amount)}` : '—'}</dd>
            </dl>
            {data.money.renewals.length > 0 && (
              <ul className="cc-mini">
                {data.money.renewals.map((r) => (
                  <li key={r.id}>
                    {r.contact_id ? <Link href={`/scheda/${r.contact_id}`}>{r.label}</Link> : r.label} <span className="cc-muted">{shortDate(r.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="cc-card">
            <h3>Vendite</h3>
            <div className="cc-kpi">
              <span className="cc-kpi-value">{data.sales.open_deals}</span>
              <span className="cc-muted">trattative aperte</span>
            </div>
            {data.sales.by_stage.length > 0 && (
              <div className="cc-stages">
                {data.sales.by_stage.slice(0, 6).map((s) => (
                  <span key={s.stage} className="cc-chip">
                    {s.stage} <b>{s.count}</b>
                  </span>
                ))}
              </div>
            )}
            <p className="cc-sub">
              Preventivi in attesa di firma: <b>{data.sales.awaiting_signature_count}</b>
              {data.sales.awaiting_signature_count ? ` · ${formatEuroPlain(data.sales.awaiting_signature_amount)}` : ''}
            </p>
            <ul className="cc-mini">
              {data.sales.awaiting_signature.map((q) => (
                <li key={q.id}>
                  {q.contact_id ? <Link href={`/scheda/${q.contact_id}`}>{q.label}</Link> : q.label} <span className="cc-muted">{formatEuroPlain(q.amount)} · inviato {shortDate(q.sent_at)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="cc-card">
            <h3>Mappe</h3>
            <div className="cc-stages">
              {STAGE_ORDER.map((stage) => (
                <span key={stage} className={`cc-chip cc-map-${stage}`}>
                  {MAP_STAGE_LABEL[stage]} <b>{data.maps.counts[stage]}</b>
                </span>
              ))}
            </div>
            {data.maps.sources.studiomap !== 'ok' && (
              <p className="cc-muted">
                {data.maps.sources.studiomap === 'not_configured'
                  ? 'StudioMap non collegato (STUDIOMAP_CATALOG_TOKEN): vedo solo le mappe online.'
                  : 'StudioMap non risponde: vedo solo le mappe online.'}
              </p>
            )}
            {data.maps.sources.speaqi !== 'ok' && <p className="cc-muted">Le guide Speaqi non rispondono.</p>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMaps((v) => !v)}>
              {showMaps ? 'Chiudi elenco' : `Vedi tutte (${data.maps.rows.length})`}
            </button>
            {showMaps && (
              <ul className="cc-mini cc-maps">
                {data.maps.rows.map((m) => (
                  <li key={m.key}>
                    <span className={`cc-dot cc-map-${m.stage}`} /> {m.name}{' '}
                    <span className="cc-muted">
                      {MAP_STAGE_LABEL[m.stage]}
                      {m.places != null ? ` · ${m.ready_places != null && m.stage !== 'online' ? `${m.ready_places}/` : ''}${m.places} luoghi` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
