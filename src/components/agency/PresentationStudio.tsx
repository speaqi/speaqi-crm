'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import {
  DEFAULT_ACCENT,
  PRESENTATION_STATUS_LABELS,
  SLIDE_KINDS,
  SLIDE_KIND_INFO,
  SLIDE_LAYOUTS,
  THEME_STYLES,
  THEME_STYLE_INFO,
  blankSlide,
  countTodo,
  formatMoney,
  normalizeHex,
  type AgencySlide,
  type AgencyTheme,
  type SlideKind
} from '@/lib/agency'
import AgencyDeck, { type DeckContext } from './AgencySlides'
import { day, download, errorText, post, type PresentationView } from './client'
import s from './agency.module.css'

const LAYOUT_LABELS: Record<string, string> = { auto: 'Automatico', image_left: 'Foto a sinistra', image_right: 'Foto a destra', centered: 'Centrato' }
const SUGGESTIONS = [
  'Rendi il tono più istituzionale',
  'Aggiungi una roadmap di sei mesi',
  'Elimina la parte economica',
  'Rafforza la sezione sui benefici attesi',
  'Accorcia: massimo 10 slide',
  'Aggiungi una slide prima/dopo'
]
type Version = { id: string; version: number; title: string; reason: string; created_at: string; slide_count: number }

/** Presentation Studio: modifica, revisione con l'AI, versioni, tema, preventivo, approvazione ed export. */
export default function PresentationStudio({ id }: { id: string }) {
  const router = useRouter()
  const [v, setV] = useState<PresentationView | null>(null)
  const [slides, setSlides] = useState<AgencySlide[]>([])
  const [theme, setTheme] = useState<AgencyTheme | null>(null)
  const [title, setTitle] = useState('')
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [index, setIndex] = useState(0)
  const [instruction, setInstruction] = useState('')
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [created, setCreated] = useState<string[]>([])

  const adopt = useCallback((next: PresentationView, keep = false) => {
    setV(next)
    if (!keep) {
      setSlides(next.slides)
      setTheme(next.theme)
      setTitle(next.title)
      setQuoteId(next.quote_id)
      setDirty(false)
    }
  }, [])
  const load = useCallback((keep = false) => apiFetch<PresentationView>(`/api/agency/presentations/${id}`).then((x) => { adopt(x, keep); return x }).catch((err) => { setError(errorText(err)); return null }), [id, adopt])
  useEffect(() => {
    load()
    try {
      const w = sessionStorage.getItem(`agency:warnings:${id}`)
      if (w) {
        setCreated(JSON.parse(w))
        sessionStorage.removeItem(`agency:warnings:${id}`)
      }
    } catch {
      /* niente */
    }
  }, [load, id])

  // L'agente lavora dopo la risposta: si segue lo stato finché non torna.
  const generating = v?.status === 'generating'
  useEffect(() => {
    if (!generating) return
    const t = setInterval(async () => {
      const x = await load(false)
      if (x && x.status !== 'generating') {
        setVersions(null)
        if (x.status === 'failed') setError(x.error || 'L’agente non ha completato il lavoro')
        else setNotice(x.last_change || 'Presentazione aggiornata')
      }
    }, 3000)
    return () => clearInterval(t)
  }, [generating, load])

  const images = useMemo(() => Object.fromEntries((v?.project.assets || []).filter((a) => a.url && (a.kind === 'photo' || a.kind === 'logo')).map((a) => [a.id, a.url as string])), [v])
  const photos = (v?.project.assets || []).filter((a) => a.kind === 'photo')
  const logoUrl = v?.project.client_brand.logo_asset_id ? images[v.project.client_brand.logo_asset_id] || null : null
  const quote = v && quoteId === v.quote_id ? v.quote : null
  const todo = countTodo(slides, { hasQuote: Boolean(quoteId) })
  const current = slides[Math.min(index, slides.length - 1)]

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

  const save = (reason?: string) =>
    run('save', async () => {
      if (!v) return
      const next = await post<PresentationView>(`/api/agency/presentations/${id}`, { version: v.version, slides, theme, title, quote_id: quoteId, reason }, 'PATCH')
      adopt(next)
      setVersions(null)
      setNotice(`Salvata la versione ${next.version}`)
      return next
    })

  const revise = (text = instruction) =>
    run('revise', async () => {
      if (!v || text.trim().length < 3) return
      let version = v.version
      if (dirty) {
        const saved = await post<PresentationView>(`/api/agency/presentations/${id}`, { version: v.version, slides, theme, title, quote_id: quoteId, reason: 'Modifica manuale prima della revisione' }, 'PATCH')
        version = saved.version
      }
      adopt(await post<PresentationView>(`/api/agency/presentations/${id}/revise`, { instruction: text, version }))
      setInstruction('')
    })

  const regenerate = () => {
    if (!confirm('Rigenerare da capo? L’agente rilegge brief e materiali e riscrive tutte le slide (la versione attuale resta nello storico).')) return
    return run('generate', async () => adopt(await post<PresentationView>(`/api/agency/presentations/${id}/generate`, { instruction })))
  }

  const approve = (value: boolean) =>
    run('approve', async () => {
      if (dirty && !(await save('Modifica prima dell’approvazione'))) return
      adopt(await post<PresentationView>(`/api/agency/presentations/${id}/approve`, { approve: value }))
      setNotice(value ? 'Approvata: il link è attivo e il PDF è quello definitivo.' : 'Riportata in revisione: il link non funziona finché non la riapprovi.')
    })

  const openVersions = () => run('versions', async () => setVersions((await apiFetch<{ versions: Version[] }>(`/api/agency/presentations/${id}/versions`)).versions))
  const restore = (n: number) => {
    if (dirty && !confirm('Le modifiche non salvate andranno perse. Ripristinare?')) return
    return run('restore', async () => {
      adopt(await post<PresentationView>(`/api/agency/presentations/${id}/versions`, { version: n }))
      setVersions(null)
      setNotice(`Ripristinata la versione ${n} (come nuova versione: lo storico resta)`)
    })
  }

  const edit = (patch: Partial<AgencySlide>) => {
    setSlides((cur) => cur.map((x, k) => (k === index ? { ...x, ...patch } : x)))
    setDirty(true)
  }
  const setItem = (i: number, patch: Partial<AgencySlide['items'][number]>) => edit({ items: current.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) })
  const move = (dir: -1 | 1) => {
    const to = index + dir
    if (to < 0 || to >= slides.length) return
    setSlides((cur) => {
      const next = [...cur]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
    setIndex(to)
    setDirty(true)
  }
  const addSlide = (kind: SlideKind) => {
    const fresh = blankSlide(kind, slides.map((x) => x.id))
    setSlides((cur) => [...cur.slice(0, index + 1), fresh, ...cur.slice(index + 1)])
    setIndex(index + 1)
    setDirty(true)
  }
  const duplicateSlide = () => {
    const copy = { ...blankSlide(current.kind, slides.map((x) => x.id)), ...current, id: blankSlide(current.kind, slides.map((x) => x.id)).id }
    setSlides((cur) => [...cur.slice(0, index + 1), copy, ...cur.slice(index + 1)])
    setIndex(index + 1)
    setDirty(true)
  }
  const removeSlide = () => {
    if (slides.length <= 1) return
    setSlides((cur) => cur.filter((_, k) => k !== index))
    setIndex(Math.max(0, index - 1))
    setDirty(true)
  }
  const setThemePatch = (patch: Partial<AgencyTheme>) => {
    setTheme((t) => (t ? { ...t, ...patch } : t))
    setDirty(true)
  }

  if (!v || !theme) {
    return (
      <div className={s.ws}>
        {error ? <p className={s.error} role="alert">{error}</p> : <p className={s.help}>Caricamento…</p>}
        <Link className={s.crumb} href="/agency?tab=studio">← Presentation Studio</Link>
      </div>
    )
  }

  const ctx: DeckContext = {
    theme,
    images,
    clientName: v.project.client_name,
    clientLogo: logoUrl,
    agencyName: v.settings.name,
    agencySignature: v.settings.signature,
    quote
  }
  const approved = v.status === 'approved'
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/proposta/${v.public_token}`
  const range = current ? SLIDE_KIND_INFO[current.kind].items : [0, 0]
  const locked = generating || !!busy

  return (
    <div className={s.ws}>
      <div className={s.top}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <Link className={s.crumb} href={`/agency/${v.project.id}`}>← {v.project.client_name} · {v.project.title}</Link>
          <div className={s.row} style={{ marginTop: 4 }}>
            <input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} style={{ fontSize: 18, fontWeight: 700, maxWidth: 560 }} aria-label="Titolo della presentazione" />
            <span className={s.badge} data-s={v.status}>{generating && <span className={s.spin} />} {PRESENTATION_STATUS_LABELS[v.status]}</span>
            <span className={s.help}>v{v.version} · {day(v.updated_at)}</span>
          </div>
        </div>
        <div className={s.row}>
          <button className={s.ghost} onClick={() => save()} disabled={!dirty || locked}>{busy === 'save' ? 'Salvo…' : dirty ? 'Salva' : 'Salvato'}</button>
          <button className={s.ghost} onClick={() => run('pdf', () => download(`/api/agency/presentations/${id}/pdf`, 'proposta.pdf'))} disabled={locked || dirty} title={dirty ? 'Salva prima di esportare' : approved ? undefined : 'PDF di bozza: ogni pagina porta “Bozza”'}>
            {busy === 'pdf' ? <><span className={s.spin} /> PDF…</> : 'PDF'}
          </button>
          {approved ? (
            <button className={s.ghost} onClick={() => approve(false)} disabled={locked}>Riporta in revisione</button>
          ) : (
            <button className={s.primary} onClick={() => approve(true)} disabled={locked || todo > 0} title={todo ? `Restano ${todo} [DA VERIFICARE]` : 'Attiva il link da condividere'}>{busy === 'approve' ? 'Approvo…' : 'Approva'}</button>
          )}
        </div>
      </div>

      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {created.length > 0 && <div className={s.warn} style={{ marginBottom: 12 }}><strong>Alla creazione</strong><ul>{created.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {generating && <p className={s.notice} role="status"><span className={s.spin} /> L’agente sta lavorando: analizza i materiali e scrive le slide. Di solito 1-3 minuti; la pagina si aggiorna da sola.</p>}
      {approved && (
        <div className={s.panel} style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 12 }}>Link per il cliente</strong>
          <div className={s.share}>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link pubblico" />
            <button className={s.ghost} onClick={() => navigator.clipboard.writeText(link).then(() => setNotice('Link copiato'), () => setError('Copia non riuscita'))}>Copia</button>
            <a className={s.ghost} href={`/proposta/${v.public_token}`} target="_blank" rel="noreferrer">Apri ↗</a>
          </div>
          <p className={s.help}>Chi ha il link vede la proposta senza accedere. Una modifica la riporta in revisione e spegne il link finché non la riapprovi.</p>
        </div>
      )}

      <div className={s.studio}>
        <div className={s.slideList} aria-label="Slide">
          {slides.map((sl, i) => {
            const t = countTodo([sl], { hasQuote: Boolean(quoteId) })
            return (
              <button key={sl.id} className={`${s.slideItem} ${i === index ? s.slideOn : ''}`} onClick={() => setIndex(i)}>
                <span className={s.slideNum}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <em>{SLIDE_KIND_INFO[sl.kind].label}{t ? <span className={s.todoDot}> · {t}!</span> : null}</em>
                  <strong>{sl.title || '(senza titolo)'}</strong>
                </span>
              </button>
            )
          })}
          <select value="" onChange={(e) => e.target.value && addSlide(e.target.value as SlideKind)} disabled={locked || slides.length >= 24} aria-label="Aggiungi slide">
            <option value="">＋ Aggiungi slide…</option>
            {SLIDE_KINDS.map((k) => <option key={k} value={k}>{SLIDE_KIND_INFO[k].label}</option>)}
          </select>
        </div>

        <div className={s.stack}>
          <div className={`${s.panel} ${s.ai}`}>
            <header><h2>✦ Chiedi all’AI</h2><button className={s.linkBtn} onClick={regenerate} disabled={locked}>Rigenera da capo</button></header>
            <textarea rows={3} value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} placeholder="Es. Rendi questa presentazione più istituzionale, aggiungi una roadmap di sei mesi, elimina la parte economica e migliora la sezione dedicata ai risultati." aria-label="Istruzione per l'AI" disabled={generating} />
            <div className={s.suggest}>{SUGGESTIONS.map((x) => <button key={x} type="button" onClick={() => setInstruction((cur) => (cur ? `${cur.replace(/[.\s]*$/, '')}. ${x}` : x))} disabled={generating}>{x}</button>)}</div>
            <div className={s.row}>
              <button className={s.primary} onClick={() => revise()} disabled={locked || instruction.trim().length < 3}>{busy === 'revise' ? <><span className={s.spin} /> Invio…</> : 'Applica la revisione'}</button>
              <span className={s.help}>Cambia solo le slide interessate; ogni revisione è una versione che puoi ripristinare.</span>
            </div>
            {v.last_change && !generating && <p className={s.help}><strong>Ultima modifica dell’AI:</strong> {v.last_change}</p>}
          </div>

          {(todo > 0 || v.warnings.length > 0) && (
            <div className={s.warn}>
              {todo > 0 && <div><strong>{todo} [DA VERIFICARE]</strong> da completare prima di approvare: sono evidenziati nell’anteprima.</div>}
              {v.warnings.length > 0 && <ul>{v.warnings.slice(0, 20).map((w, i) => <li key={i}>{w.slide !== '*' && <em>{w.slide}: </em>}{w.message}</li>)}</ul>}
            </div>
          )}

          {current && (
            <div className={s.panel}>
              <header>
                <h2>Slide {index + 1} · {SLIDE_KIND_INFO[current.kind].label}</h2>
                <div className={s.row}>
                  <button className={s.mini} onClick={() => move(-1)} disabled={locked || index === 0} aria-label="Sposta su">↑</button>
                  <button className={s.mini} onClick={() => move(1)} disabled={locked || index === slides.length - 1} aria-label="Sposta giù">↓</button>
                  <button className={s.mini} onClick={duplicateSlide} disabled={locked || slides.length >= 24}>Duplica</button>
                  <button className={s.mini} onClick={removeSlide} disabled={locked || slides.length <= 1}>Elimina</button>
                </div>
              </header>
              <p className={s.help}>{SLIDE_KIND_INFO[current.kind].use}</p>
              <div className={s.formGrid}>
                <label className={s.field}>Layout
                  <select value={current.kind} onChange={(e) => edit({ kind: e.target.value as SlideKind })} disabled={locked}>
                    {SLIDE_KINDS.map((k) => <option key={k} value={k}>{SLIDE_KIND_INFO[k].label}</option>)}
                  </select>
                </label>
                <label className={s.field}>Occhiello<input value={current.kicker} maxLength={60} onChange={(e) => edit({ kicker: e.target.value })} disabled={locked} /></label>
              </div>
              <label className={s.field}>Titolo (il messaggio)<textarea rows={2} value={current.title} maxLength={180} onChange={(e) => edit({ title: e.target.value })} disabled={locked} /></label>
              <label className={s.field}>Testo<textarea rows={3} value={current.body} maxLength={900} onChange={(e) => edit({ body: e.target.value })} disabled={locked} /></label>
              {range[1] > 0 && (
                <div className={s.items}>
                  <span className={s.help}>Voci ({current.items.length}, consigliate {range[0]}-{range[1]}){current.kind === 'comparison' && ' · nel testo una riga per punto'}{(current.kind === 'metrics' || current.kind === 'chart') && ' · il valore deve stare nei materiali'}</span>
                  {current.items.map((it, i) => (
                    <div className={s.item} key={i}>
                      <input value={it.title} maxLength={90} placeholder="Titolo" onChange={(e) => setItem(i, { title: e.target.value })} disabled={locked} aria-label={`Voce ${i + 1} titolo`} />
                      <textarea value={it.text} maxLength={400} placeholder="Testo" onChange={(e) => setItem(i, { text: e.target.value })} disabled={locked} aria-label={`Voce ${i + 1} testo`} />
                      <input value={it.value} maxLength={40} placeholder={current.kind === 'roadmap' ? 'Periodo' : 'Valore'} onChange={(e) => setItem(i, { value: e.target.value })} disabled={locked} aria-label={`Voce ${i + 1} valore`} />
                      <button className={s.mini} onClick={() => edit({ items: current.items.filter((_, k) => k !== i) })} disabled={locked} aria-label={`Togli voce ${i + 1}`}>×</button>
                    </div>
                  ))}
                  <div className={s.row}><button className={s.mini} onClick={() => edit({ items: [...current.items, { title: '', text: '', value: '' }] })} disabled={locked || current.items.length >= range[1]}>＋ Voce</button></div>
                </div>
              )}
              <label className={s.field}>{current.kind === 'quote' ? 'Autore della citazione' : current.kind === 'metrics' || current.kind === 'chart' ? 'Fonte dei dati' : 'Nota in fondo'}<input value={current.note} maxLength={300} onChange={(e) => edit({ note: e.target.value })} disabled={locked} /></label>
              <div className={s.formGrid}>
                <label className={s.field}>Foto
                  <select value={current.image_asset_id || ''} onChange={(e) => edit({ image_asset_id: e.target.value || null })} disabled={locked || !photos.length}>
                    <option value="">{photos.length ? 'Nessuna' : 'Nessuna foto caricata'}</option>
                    {photos.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
                  </select>
                </label>
                <label className={s.field}>Disposizione
                  <select value={current.layout} onChange={(e) => edit({ layout: e.target.value as AgencySlide['layout'] })} disabled={locked}>
                    {SLIDE_LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABELS[l]}</option>)}
                  </select>
                </label>
              </div>
              {current.kind === 'investment' && <p className={s.help}>Le cifre arrivano dal preventivo scelto qui sotto: si cambiano nel preventivo, non nella slide.</p>}
            </div>
          )}

          <div className={s.panel}>
            <header><h2>Stile</h2></header>
            <div className={s.styles}>
              {THEME_STYLES.map((st) => (
                <button key={st} type="button" className={`${s.styleCard} ${theme.style === st ? s.styleOn : ''}`} onClick={() => setThemePatch({ style: st })} disabled={locked}>
                  <strong>{THEME_STYLE_INFO[st].label}</strong>
                  <span>{THEME_STYLE_INFO[st].description}</span>
                </button>
              ))}
            </div>
            <div className={s.row}>
              <span className={s.help}>Accento</span>
              <input type="color" value={normalizeHex(theme.accent) || DEFAULT_ACCENT} onChange={(e) => setThemePatch({ accent: e.target.value })} style={{ width: 44, padding: 2 }} disabled={locked} aria-label="Colore d'accento" />
              <button className={s.mini} onClick={() => setThemePatch({ accent: DEFAULT_ACCENT })} disabled={locked}><span className={s.swatch} style={{ background: DEFAULT_ACCENT }} /> Speaqi</button>
              {v.project.client_brand.accent && <button className={s.mini} onClick={() => setThemePatch({ accent: v.project.client_brand.accent as string })} disabled={locked}><span className={s.swatch} style={{ background: v.project.client_brand.accent }} /> Cliente</button>}
              <label className={s.row} style={{ gap: 4 }}>
                <input type="checkbox" checked={theme.client_logo} onChange={(e) => setThemePatch({ client_logo: e.target.checked })} disabled={locked || !logoUrl} style={{ width: 'auto' }} />
                Logo del cliente{!logoUrl && ' (caricalo nell’opportunità)'}
              </label>
              <label className={s.row} style={{ gap: 4 }}>
                Lingua
                <select value={theme.language} onChange={(e) => setThemePatch({ language: e.target.value as 'it' | 'en' })} disabled={locked} style={{ width: 'auto' }}>
                  <option value="it">Italiano</option>
                  <option value="en">Inglese</option>
                </select>
              </label>
            </div>
          </div>

          <div className={s.panel}>
            <header><h2>Preventivo collegato</h2><Link className={s.linkBtn} href={`/preventivi?agency_project=${v.project.id}${v.project.contact_id ? `&contact=${v.project.contact_id}` : ''}`}>＋ Nuovo preventivo</Link></header>
            <select value={quoteId || ''} onChange={(e) => { setQuoteId(e.target.value || null); setDirty(true) }} disabled={locked} aria-label="Preventivo mostrato">
              <option value="">Nessuno (la slide investimento resta da completare)</option>
              {v.quotes.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.title} · {formatMoney(q.total, q.currency)} ({q.status})</option>)}
            </select>
            {v.quote && quoteId === v.quote_id && <p className={s.help}>Mostrato nella slide “Investimento”: {v.quote.lines.length} voci, totale {formatMoney(v.quote.total, v.quote.currency)}. <Link href={`/preventivi?edit=${v.quote.id}`}>Modifica il preventivo →</Link></p>}
            {quoteId !== v.quote_id && <p className={s.help}>Salva per vedere il preventivo nell’anteprima.</p>}
          </div>

          <div className={s.panel}>
            <header><h2>Versioni</h2>{!versions && <button className={s.linkBtn} onClick={openVersions} disabled={!!busy}>Mostra lo storico</button>}</header>
            {versions && (
              <div className={s.versions}>
                {versions.map((x) => (
                  <div className={s.version} key={x.id}>
                    <b>v{x.version}</b>
                    <span><span title={x.reason}>{x.reason || 'Salvataggio'}</span><br /><span className={s.help}>{new Date(x.created_at).toLocaleString('it-IT')} · {x.slide_count} slide</span></span>
                    {x.version === v.version ? <span className={s.tag}>attuale</span> : <button className={s.mini} onClick={() => restore(x.version)} disabled={locked}>Ripristina</button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={s.row}>
            <button className={s.ghost} onClick={() => run('dup', async () => { const r = await post<{ id: string }>(`/api/agency/presentations/${id}/duplicate`, {}); router.push(`/agency/presentazioni/${r.id}`) })} disabled={locked}>Duplica la presentazione</button>
            <button className={s.danger} onClick={() => confirm('Eliminare la presentazione e il suo storico?') && run('delete', async () => { await apiFetch(`/api/agency/presentations/${id}`, { method: 'DELETE' }); router.push(`/agency/${v.project.id}`) })} disabled={locked}>Elimina</button>
          </div>
        </div>

        <div className={s.preview}>
          <AgencyDeck slides={slides} ctx={ctx} index={index} onIndexChange={setIndex} />
          <span className={s.help}>Anteprima dal vivo: è ciò che vede il cliente e ciò che esce nel PDF (una pagina 16:9 per slide).</span>
        </div>
      </div>
    </div>
  )
}
