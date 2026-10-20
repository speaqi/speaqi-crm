'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import {
  AGENCY_STAGES,
  AGENCY_STAGE_LABELS,
  DEFAULT_ACCENT,
  PRESENTATION_STATUS_LABELS,
  formatMoney,
  normalizeHex,
  type AgencyStage
} from '@/lib/agency'
import { day, errorText, post, type ProjectView } from './client'
import s from './agency.module.css'

const KIND_LABEL: Record<string, string> = { photo: 'Foto', logo: 'Logo', document: 'Documento', website: 'Sito' }

/** Un'opportunità Agency: cliente, brief e materiali, analisi dell'AI, presentazioni, preventivi e pacchetto commerciale. */
export default function ProjectPage({ id }: { id: string }) {
  const router = useRouter()
  const [p, setP] = useState<ProjectView | null>(null)
  const [brief, setBrief] = useState('')
  const [title, setTitle] = useState('')
  const [services, setServices] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [url, setUrl] = useState('')
  const [accent, setAccent] = useState('')
  const [attachable, setAttachable] = useState<{ id: string; quote_number: string; title: string; total_amount: number; currency: string; status: string }[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const files = useRef<HTMLInputElement>(null)
  const logo = useRef<HTMLInputElement>(null)

  const adopt = useCallback((v: ProjectView, keep = false) => {
    setP(v)
    if (!keep) {
      setBrief(v.brief)
      setTitle(v.title)
      setServices(v.services)
      setDirty(false)
    }
    setUrl((cur) => cur || v.website_url || '')
    setAccent(v.client_brand.accent || '')
  }, [])
  const load = useCallback((keep = false) => apiFetch<ProjectView>(`/api/agency/projects/${id}`).then((v) => adopt(v, keep)).catch((err) => setError(errorText(err))), [id, adopt])
  useEffect(() => { load() }, [load])
  // Una presentazione in generazione aggiorna da sola la lista.
  useEffect(() => {
    if (!p?.presentations.some((x) => x.status === 'generating')) return
    const t = setInterval(() => load(true), 4000)
    return () => clearInterval(t)
  }, [p, load])

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label)
    setError('')
    setNotice('')
    try {
      return await fn()
    } catch (err) {
      setError(errorText(err))
      return undefined
    } finally {
      setBusy('')
    }
  }

  const patch = (body: Record<string, unknown>, message = 'Salvato') =>
    run('save', async () => {
      if (!p) return
      adopt(await post<ProjectView>(`/api/agency/projects/${id}`, { ...body, version: p.version }, 'PATCH'))
      setNotice(message)
    })

  const upload = (list: FileList | null, field: 'files' | 'logo') => {
    if (!list?.length) return
    const fd = new FormData()
    for (const f of Array.from(list)) fd.append(field, f)
    return run('upload', async () => {
      adopt(await apiFetch<ProjectView>(`/api/agency/projects/${id}/assets`, { method: 'POST', body: fd }), true)
      setNotice('Materiali aggiunti: l’agente li legge alla prossima generazione o revisione.')
      if (files.current) files.current.value = ''
      if (logo.current) logo.current.value = ''
    })
  }

  const newPresentation = (generate: boolean) =>
    run('new', async () => {
      if (dirty) await patch({ brief, title, services })
      const v = await post<{ id: string }>(`/api/agency/projects/${id}/presentations`, { generate })
      router.push(`/agency/presentazioni/${v.id}`)
    })

  const openAttach = () =>
    run('attach-list', async () => {
      setAttachable((await apiFetch<{ quotes: NonNullable<typeof attachable> }>(`/api/agency/projects/${id}/quotes`)).quotes)
    })

  if (!p) {
    return (
      <div className={s.ws}>
        {error ? <p className={s.error} role="alert">{error}</p> : <p className={s.help}>Caricamento…</p>}
        <Link className={s.crumb} href="/agency">← Speaqi Agency</Link>
      </div>
    )
  }
  const a = p.analysis
  const hasAnalysis = Boolean(a.client_summary || a.verified_facts.length || a.missing.length)
  const approved = p.presentations.find((x) => x.status === 'approved')
  const quote = p.quotes.find((q) => q && q.status !== 'cancelled')
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const packageText = approved
    ? [
        `Gentile ${p.contact?.name || p.client_name},`,
        '',
        `come promesso ecco la nostra proposta "${p.title}":`,
        `${origin}/proposta/${approved.public_token}`,
        ...(quote?.public_token && ['sent', 'accepted', 'paid'].includes(quote.status) ? ['', 'Il preventivo, da accettare e firmare online:', `${origin}/preventivo?id=${quote.public_token}`] : []),
        '',
        'Restiamo a disposizione per parlarne.',
        p.settings.name
      ].join('\n')
    : ''

  return (
    <div className={s.ws}>
      <div className={s.top}>
        <div>
          <Link className={s.crumb} href="/agency?tab=opportunita">← Speaqi Agency · Opportunità</Link>
          <h1>{p.client_name} <span>·</span> {p.title}</h1>
          <div className={s.row} style={{ marginTop: 6 }}>
            <select value={p.stage} onChange={(e) => patch({ stage: e.target.value as AgencyStage }, 'Stato aggiornato')} style={{ width: 'auto' }} disabled={!!busy} aria-label="Stato dell'opportunità">
              {AGENCY_STAGES.map((st) => <option key={st} value={st}>{AGENCY_STAGE_LABELS[st]}</option>)}
            </select>
            {p.contact ? <Link className={s.tag} href={`/contacts/${p.contact.id}`}>Scheda CRM: {p.contact.name}{p.contact.email ? ` · ${p.contact.email}` : ''} →</Link> : <span className={s.tag}>Contatto non più nel CRM</span>}
            {p.deal && <span className={s.tag}>Trattativa CRM: {p.deal.title} · {p.deal.closed_at ? (p.deal.outcome === 'won' ? 'vinta' : 'chiusa') : p.deal.stage}</span>}
          </div>
        </div>
        <div className={s.row}>
          <button className={s.ghost} onClick={() => newPresentation(false)} disabled={!!busy}>Presentazione vuota</button>
          <button className={s.primary} onClick={() => newPresentation(true)} disabled={!!busy}>{busy === 'new' ? <><span className={s.spin} /> Avvio…</> : '✦ Genera una presentazione'}</button>
        </div>
      </div>

      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}

      <div className={s.cols2}>
        <div className={s.stack}>
          <div className={s.panel}>
            <header><h2>Brief</h2><button className={s.primary} onClick={() => patch({ brief, title, services })} disabled={!dirty || !!busy}>{busy === 'save' ? 'Salvo…' : 'Salva il brief'}</button></header>
            <label className={s.field}>Titolo della proposta<input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} /></label>
            <div className={s.chips} role="group" aria-label="Servizi">
              {p.categories.filter((c) => c.is_active || services.includes(c.slug)).map((c) => (
                <button key={c.slug} type="button" className={`${s.chip} ${services.includes(c.slug) ? s.chipOn : ''}`} onClick={() => { setServices((cur) => (cur.includes(c.slug) ? cur.filter((x) => x !== c.slug) : [...cur, c.slug])); setDirty(true) }}>{c.name}</button>
              ))}
            </div>
            <textarea rows={9} value={brief} maxLength={40000} onChange={(e) => { setBrief(e.target.value); setDirty(true) }} placeholder="Esigenze, obiettivi, vincoli, tempi, budget se noto. L’agente lo legge insieme ai materiali." aria-label="Brief" />
          </div>

          <div className={s.panel}>
            <header>
              <h2>Materiali ({p.assets.length})</h2>
              <div className={s.row}>
                <button className={s.ghost} onClick={() => logo.current?.click()} disabled={!!busy}>Logo del cliente</button>
                <button className={s.ghost} onClick={() => files.current?.click()} disabled={!!busy}>{busy === 'upload' ? <><span className={s.spin} /> Carico…</> : '＋ Documenti e foto'}</button>
              </div>
            </header>
            <input ref={files} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,.pdf,.docx,.pptx,.txt,.md,.csv" onChange={(e) => upload(e.target.files, 'files')} />
            <input ref={logo} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files, 'logo')} />
            <div className={s.share}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sito-del-cliente.it" aria-label="Sito del cliente" />
              <button className={s.ghost} disabled={!url.trim() || !!busy} onClick={() => run('site', async () => {
                const v = await post<ProjectView & { website_truncated?: boolean }>(`/api/agency/projects/${id}/website`, { url })
                adopt(v, true)
                setNotice(v.website_truncated ? 'Sito letto (testo lungo: l’agente ne legge la prima parte).' : 'Sito letto e salvato fra i materiali.')
              })}>{busy === 'site' ? <><span className={s.spin} /> Leggo…</> : 'Leggi il sito'}</button>
            </div>
            {p.assets.length === 0 ? (
              <p className={s.help}>Nessun materiale. Presentazioni, documenti, foto e il sito del cliente rendono la proposta precisa.</p>
            ) : (
              <div className={s.assets}>
                {p.assets.map((as) => (
                  <div className={s.asset} key={as.id}>
                    <div className={`${s.thumb} ${as.kind === 'logo' ? s.thumbLogo : ''}`} style={as.url ? { backgroundImage: `url("${as.url}")` } : undefined}>{as.url ? '' : as.kind === 'website' ? 'WEB' : as.name.split('.').pop()?.toUpperCase()}</div>
                    <div className={s.assetMeta}>
                      <span title={as.name}>{as.name}</span>
                      <span className={s.help}>{KIND_LABEL[as.kind]}{p.client_brand.logo_asset_id === as.id ? ' · logo in uso' : ''}</span>
                      <div className={s.row}>
                        {(as.kind === 'logo' || as.kind === 'photo') && p.client_brand.logo_asset_id !== as.id && (
                          <button className={s.linkBtn} onClick={() => patch({ client_brand: { ...p.client_brand, logo_asset_id: as.id } }, 'Logo del cliente aggiornato')} disabled={!!busy}>Usa come logo</button>
                        )}
                        <button className={s.linkBtn} onClick={() => run('asset', async () => adopt(await apiFetch<ProjectView>(`/api/agency/projects/${id}/assets/${as.id}`, { method: 'DELETE' }), true))} disabled={!!busy}>Rimuovi</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className={s.row}>
              <span className={s.help}>Colore del cliente</span>
              <input type="color" value={normalizeHex(accent) || DEFAULT_ACCENT} onChange={(e) => setAccent(e.target.value)} style={{ width: 44, padding: 2 }} aria-label="Colore del cliente" />
              <button className={s.mini} onClick={() => patch({ client_brand: { ...p.client_brand, accent } }, 'Colore salvato: vale per le presentazioni nuove; nello Studio lo applichi a quelle esistenti.')} disabled={!!busy}>Salva colore</button>
              {p.client_brand.accent && <button className={s.linkBtn} onClick={() => patch({ client_brand: { ...p.client_brand, accent: null } })}>Usa l’arancio Speaqi</button>}
            </div>
          </div>

          <div className={s.panel}>
            <header><h2>Analisi dell’AI</h2>{a.generated_at && <span className={s.help}>{day(a.generated_at)} · {a.model}</span>}</header>
            {!hasAnalysis ? (
              <p className={s.help}>Compare dopo la prima generazione: fatti verificati (con la fonte), ipotesi, dati mancanti e la strategia scelta.</p>
            ) : (
              <>
                {a.client_summary && <p style={{ margin: 0 }}>{a.client_summary}</p>}
                <div className={s.analysis}>
                  <section><h3>Fatti verificati</h3><ul>{a.verified_facts.map((f, i) => <li key={i}>{f.fact} <span className={s.src}>({f.source})</span></li>)}</ul></section>
                  <section><h3>Ipotesi di lavoro</h3><ul>{a.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
                  <section><h3>Dati mancanti</h3><ul>{a.missing.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
                  <section><h3>Esigenze e obiettivi</h3><ul>{[...a.needs, ...a.objectives].map((x, i) => <li key={i}>{x}</li>)}</ul></section>
                </div>
                {(a.strategy.positioning || a.strategy.proposal) && (
                  <div className={s.warn} style={{ background: '#f5f7fb', borderColor: '#e3e7ef', color: 'inherit' }}>
                    <strong>Strategia</strong>
                    {a.strategy.positioning && <p style={{ margin: '4px 0' }}>{a.strategy.positioning}</p>}
                    {a.strategy.proposal && <p style={{ margin: '4px 0' }}>{a.strategy.proposal}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className={s.stack}>
          <div className={s.panel}>
            <header><h2>Presentazioni</h2></header>
            {p.presentations.length ? (
              <table className={s.table}>
                <tbody>
                  {p.presentations.map((x) => (
                    <tr key={x.id}>
                      <td><Link href={`/agency/presentazioni/${x.id}`}>{x.title}</Link><div className={s.help}>{x.slide_count} slide · v{x.version} · {day(x.updated_at)}</div></td>
                      <td><span className={s.badge} data-s={x.status}>{x.status === 'generating' && <span className={s.spin} />} {PRESENTATION_STATUS_LABELS[x.status]}</span></td>
                      <td className={s.help}>{x.todo ? `${x.todo} da verificare` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={s.empty}><strong>Nessuna presentazione</strong>“Genera una presentazione” legge brief e materiali e costruisce la proposta.</div>
            )}
          </div>

          <div className={s.panel}>
            <header>
              <h2>Preventivi</h2>
              <div className={s.row}>
                <button className={s.ghost} onClick={openAttach} disabled={!!busy || !p.contact_id}>Collega esistente</button>
                <Link className={s.primary} href={`/preventivi?agency_project=${p.id}${p.contact_id ? `&contact=${p.contact_id}` : ''}`}>＋ Nuovo preventivo</Link>
              </div>
            </header>
            <p className={s.help}>Il prezzo vive solo nel preventivo: la slide “Investimento” della presentazione lo legge da lì, così i due documenti non possono dire cifre diverse.</p>
            {attachable && (
              <div className={s.results}>
                {attachable.length ? attachable.map((q) => (
                  <button key={q.id} className={s.result} onClick={() => run('attach', async () => { adopt(await post<ProjectView>(`/api/agency/projects/${id}/quotes`, { quote_id: q.id }), true); setAttachable(null) })}>
                    <span><strong>{q.quote_number}</strong> · {q.title}</span>
                    <span>{formatMoney(Number(q.total_amount), q.currency)}</span>
                  </button>
                )) : <div className={s.result}>Nessun preventivo libero per questo cliente.</div>}
              </div>
            )}
            {p.quotes.length ? (
              <table className={s.table}>
                <tbody>
                  {p.quotes.map((q) => q && (
                    <tr key={q.id}>
                      <td><Link href={`/preventivi?edit=${q.id}`}>{q.number}</Link><div className={s.help}>{q.title}</div></td>
                      <td><span className={s.badge} data-s={q.status}>{q.status}</span></td>
                      <td>{formatMoney(q.total, q.currency)}{q.billing_interval === 'year' ? ' / anno' : ''}</td>
                      <td><button className={s.linkBtn} onClick={() => confirm('Scollegare il preventivo da questa opportunità? Il preventivo resta nel CRM.') && run('detach', async () => adopt(await apiFetch<ProjectView>(`/api/agency/projects/${id}/quotes?quote_id=${q.id}`, { method: 'DELETE' }), true))}>Scollega</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className={s.help}>Nessun preventivo collegato.</p>}
          </div>

          <div className={s.panel}>
            <header><h2>Pacchetto commerciale</h2></header>
            <ul className={s.help} style={{ margin: 0, paddingLeft: 18 }}>
              <li>{approved ? '✓' : '○'} Presentazione approvata {approved && <Link href={`/agency/presentazioni/${approved.id}`}>({approved.title})</Link>}</li>
              <li>{quote ? '✓' : '○'} Preventivo collegato {quote && `(${quote.number})`}</li>
              <li>{quote && ['sent', 'accepted', 'paid'].includes(quote.status) ? '✓' : '○'} Preventivo inviato al cliente (stato “sent” o successivo)</li>
            </ul>
            {approved ? (
              <>
                <textarea readOnly rows={9} value={packageText} onFocus={(e) => e.currentTarget.select()} aria-label="Testo per il cliente" />
                <div className={s.row}>
                  <button className={s.ghost} onClick={() => navigator.clipboard.writeText(packageText).then(() => setNotice('Testo copiato'), () => setError('Copia non riuscita'))}>Copia il testo</button>
                  <a className={s.ghost} href={`/proposta/${approved.public_token}`} target="_blank" rel="noreferrer">Apri la proposta ↗</a>
                </div>
              </>
            ) : (
              <p className={s.help}>Approva una presentazione per avere il link da mandare al cliente; con un preventivo inviato, il pacchetto include anche quello.</p>
            )}
          </div>

          <div className={s.row}>
            <button className={s.danger} onClick={() => confirm('Eliminare l’opportunità con presentazioni, versioni e file? I preventivi restano nel CRM.') && run('delete', async () => { await apiFetch(`/api/agency/projects/${id}`, { method: 'DELETE' }); router.push('/agency?tab=opportunita') })} disabled={!!busy}>Elimina l’opportunità</button>
          </div>
        </div>
      </div>
    </div>
  )
}
