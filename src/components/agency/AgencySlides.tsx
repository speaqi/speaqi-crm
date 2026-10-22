'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  AGENCY_TODO,
  AGENCY_TODO_PATTERN,
  deckFields,
  fieldIsDark,
  formatMoney,
  inkOn,
  numberedMark,
  type AgencySlide,
  type SlideField,
  type AgencyTheme,
  type QuoteSummary
} from '@/lib/agency'
import d from './agency-deck.module.css'

/** Testo con i segnaposto da completare ben visibili. */
export function Txt({ value }: { value: string }) {
  const parts: (string | { todo: string })[] = []
  let last = 0
  for (const m of value.matchAll(AGENCY_TODO_PATTERN)) {
    if (m.index > last) parts.push(value.slice(last, m.index))
    parts.push({ todo: m[0] })
    last = m.index + m[0].length
  }
  if (last < value.length) parts.push(value.slice(last))
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <mark key={i} className={d.todo}>{p.todo}</mark>))}
    </>
  )
}

export type DeckContext = {
  theme: AgencyTheme
  images: Record<string, string>
  clientName: string
  clientLogo: string | null
  agencyName: string
  agencySignature: string
  quote: QuoteSummary | null
  /** Indirizzo del preventivo pubblico, se si può mostrare. */
  quoteHref?: string | null
}

const cls = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
const bg = (url?: string | null): CSSProperties | undefined => (url ? { backgroundImage: `url("${url}")` } : undefined)
const two = (i: number) => String(i + 1).padStart(2, '0')

function Brand({ ctx, dark }: { ctx: DeckContext; dark: boolean }) {
  return (
    <span className={d.brand}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dark ? '/deck/logo-on-color.png' : '/deck/logo.png'} alt="Speaqi" />
      <span>{ctx.agencyName.replace(/^speaqi\s*/i, '') || 'Agency'}</span>
    </span>
  )
}

/** Testata corrente: il capitolo (il vecchio "kicker") a sinistra, il punto della presentazione a destra. */
function Run({ ctx, slide, n, total }: { ctx: DeckContext; slide: AgencySlide; n: number; total: number }) {
  return (
    <header className={d.run}>
      <span className={d.runLeft}>{slide.kicker ? <Txt value={slide.kicker} /> : ctx.clientName}</span>
      <span className={d.runRight}>
        {ctx.clientLogo && ctx.theme.client_logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={d.runLogo} src={ctx.clientLogo} alt={ctx.clientName} />
        )}
        <span><span className={d.pagerNow}>{two(n - 1)}</span> / {two(total - 1)}</span>
      </span>
    </header>
  )
}

function Head({ slide, big = false }: { slide: AgencySlide; big?: boolean }) {
  return (
    <div className={d.head}>
      <h2 className={big ? d.display : d.title}><Txt value={slide.title} /></h2>
      {slide.body && <p className={d.lead}><Txt value={slide.body} /></p>}
    </div>
  )
}

const lines = (text: string) => text.split(/\n+/).map((l) => l.replace(/^[-•·*]\s*/, '').trim()).filter(Boolean)
const numeric = (value: string) => {
  const m = value.replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)*/)
  if (!m) return null
  const raw = m[0]
  // "1.250,5" → 1250.5 ; "1,250.5" → 1250.5 ; "12,5" → 12.5
  const normalized = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function Investment({ ctx }: { ctx: DeckContext }) {
  const q = ctx.quote
  if (!q) {
    return (
      <div className={d.investEmpty}>
        <mark className={d.todo}>{AGENCY_TODO}</mark> Collega un preventivo: le cifre di questa slide arrivano da lì.
      </div>
    )
  }
  const per = q.billing_interval === 'year' ? ' / anno' : ''
  // Le righe a 0 € sono "incluse": si contano in una riga sola, l'elenco intero sta nel preventivo.
  const priced = q.lines.filter((l) => l.total > 0)
  const included = q.lines.length - priced.length
  const shown = priced.slice(0, 6)
  const hidden = priced.length - shown.length
  const net = Math.max(0, q.subtotal - q.discount)
  return (
    <div className={d.invest}>
      <div className={d.investLines}>
        {shown.map((l, i) => (
          <div className={d.investLine} key={i}>
            <div>
              <strong>{l.description}</strong>
              {l.details && <span>{l.details}</span>}
            </div>
            <em>
              {l.list_total && l.list_total > l.total && <s className={d.investWas}>{formatMoney(l.list_total, q.currency)}</s>}
              {formatMoney(l.total, q.currency)}
            </em>
          </div>
        ))}
        {hidden > 0 && <div className={d.investMore}>+ altre {hidden} voci nel preventivo</div>}
        {included > 0 && <div className={d.investMore}>Compresi nel prezzo: {included} {included === 1 ? 'voce' : 'voci'}, elencate nel preventivo</div>}
      </div>
      <div className={d.investTotal}>
        <div className={d.investLabel}>Il prezzo, IVA {q.tax_rate}% esclusa</div>
        <div className={d.investBig}>{formatMoney(net, q.currency)}{per && <small>{per}</small>}</div>
        {q.discount > 0 && <div className={d.investRow}><span>Sconto incluso</span><b>− {formatMoney(q.discount, q.currency)}</b></div>}
        {q.deposit_net !== null && q.balance_net !== null && (
          <div className={d.investPay}>
            <div className={d.investRow}><span>Alla firma</span><b>{formatMoney(q.deposit_net, q.currency)} + IVA</b></div>
            <div className={d.investRow}><span>Saldo</span><b>{formatMoney(q.balance_net, q.currency)} + IVA</b></div>
            {q.payment_note && <div className={d.investMeta}>{q.payment_note}</div>}
          </div>
        )}
        <div className={d.investMeta}>
          Preventivo {q.number}
          {q.valid_until && <> · valido fino al {new Date(q.valid_until).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</>}
        </div>
        {q.note && <div className={d.investMeta}>{q.note}</div>}
        {ctx.quoteHref && <a className={d.investLink} href={ctx.quoteHref} target="_blank" rel="noreferrer">Apri il preventivo e accetta →</a>}
      </div>
    </div>
  )
}

/**
 * Il contenuto deve stare nella slide, anche quando l'AI o l'utente scrivono tanto: se
 * sfora, il blocco si rimpicciolisce (fino al 60%) invece di uscire dal bordo. Lavora sul
 * DOM, quindi vale anche nella pagina che Chromium stampa in PDF.
 */
function useFit(ref: RefObject<HTMLDivElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let k = 1
      el.style.setProperty('--k', '1')
      for (let i = 0; i < 12 && el.scrollHeight > el.clientHeight + 2 && k > 0.6; i++) {
        k = Math.max(0.6, k - 0.05)
        el.style.setProperty('--k', String(k))
      }
      el.dataset.fit = String(k)
    }
    fit()
    let alive = true
    document.fonts?.ready.then(() => alive && fit())
    return () => {
      alive = false
    }
  }, [ref, key])
}

function Fit({ children, slideKey, className }: { children: ReactNode; slideKey: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useFit(ref, slideKey)
  return (
    <div className={cls(d.fitBox, className)}>
      <div ref={ref} className={d.fit}>{children}</div>
    </div>
  )
}

/** Voci in colonne, senza scatole: il numero (se c'è) è la cosa più grande della slide. */
function Columns({ slide, numbers }: { slide: AgencySlide; numbers: boolean }) {
  const n = slide.items.length
  const cols = n <= 4 ? Math.max(2, n) : 3
  const anyNumbered = slide.items.some((it) => numberedMark(it))
  const showNum = numbers || anyNumbered
  return (
    <div className={cls(d.cols, (n > 3 || cols > 3) && d.dense, !showNum && d.toned)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {slide.items.map((it, i) => (
        <div className={d.colItem} key={i}>
          {showNum && <div className={d.num}>{numberedMark(it) || two(i)}</div>}
          <h3><Txt value={it.title} /></h3>
          {it.text && <p><Txt value={it.text} /></p>}
          {it.value && !numberedMark(it) && <div className={d.colValue}><Txt value={it.value} /></div>}
        </div>
      ))}
    </div>
  )
}

function Rows({ slide, numbers }: { slide: AgencySlide; numbers: boolean }) {
  return (
    <div className={cls(d.rows, !numbers && d.rowsPlain)}>
      {slide.items.map((it, i) => (
        <div className={d.row} key={i}>
          {numbers && <span className={d.rowNum}>{i + 1}</span>}
          <h3><Txt value={it.title} /></h3>
          {it.value && <span className={d.rowValue}><Txt value={it.value} /></span>}
          {it.text && <p><Txt value={it.text} /></p>}
        </div>
      ))}
    </div>
  )
}

export function SlideView({ slide, ctx, n, total, active, field }: { slide: AgencySlide; ctx: DeckContext; n: number; total: number; active: boolean; field?: SlideField }) {
  const image = slide.image_asset_id ? ctx.images[slide.image_asset_id] : null
  const f: SlideField = field || deckFields([slide.kind], ctx.theme.style)[0]
  const dark = fieldIsDark(f, ctx.theme.accent)
  // Un layout a voci senza voci resta una slide vuota a metà: si mostra come messaggio.
  const ITEM_KINDS = ['agenda', 'problems', 'opportunities', 'benefits', 'services', 'process', 'roadmap', 'deliverables', 'metrics', 'chart', 'comparison', 'next_steps']
  const kind = ITEM_KINDS.includes(slide.kind) && !slide.items.length ? 'statement' : slide.kind
  const base = cls(d.slide, d[`f_${f}`], active && d.active, d[`k_${kind}`], image && d.hasImage, slide.layout === 'image_left' && d.reverse)
  // Sulle slide di contenuto la nota è la fonte del dato: va in piccolo in fondo.
  const SOURCE_KINDS = ['context', 'solution', 'agenda', 'problems', 'opportunities', 'benefits', 'services', 'deliverables', 'metrics', 'chart']
  const run = <Run ctx={ctx} slide={slide} n={n} total={total} />
  const foot = SOURCE_KINDS.includes(kind) && slide.note ? <footer className={d.foot}><Txt value={slide.note} /></footer> : null
  const fitKey = JSON.stringify(slide) + (ctx.quote?.updated_at || '') + ctx.theme.style + f
  let content: ReactNode
  let box: string | undefined

  switch (kind) {
    case 'cover':
      return (
        <section className={cls(base, slide.title.length > 40 && d.coverLong)} aria-hidden={!active}>
          {image && <div className={d.coverPhoto} style={bg(image)} />}
          <div className={d.coverField}>
            <div className={d.coverTop}>
              <Brand ctx={ctx} dark={dark} />
              {ctx.clientLogo && ctx.theme.client_logo && (
                <span className={d.coverClient}>
                  <span>per</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ctx.clientLogo} alt={ctx.clientName} />
                </span>
              )}
            </div>
            <div>
              <h1><Txt value={slide.title} /></h1>
              {slide.body && <p className={d.coverSub}><Txt value={slide.body} /></p>}
              {slide.kicker && <p className={d.coverRun}><Txt value={slide.kicker} /></p>}
              {ctx.agencySignature && <p className={d.coverBy}>{ctx.agencyName} · {ctx.agencySignature}</p>}
            </div>
          </div>
        </section>
      )

    case 'section':
    case 'closing':
      box = d.endBox
      content = (
        <div className={d.poster}>
          <h2 className={cls(image ? d.title : d.display, slide.title.length > 56 && d.long)}><Txt value={slide.title} /></h2>
          {slide.body && <p className={d.lead}><Txt value={slide.body} /></p>}
          {slide.note && <p className={d.note}><Txt value={slide.note} /></p>}
        </div>
      )
      break

    case 'quote':
      box = d.endBox
      content = (
        <div className={d.poster}>
          <blockquote className={d.quoteText}><Txt value={slide.title} /></blockquote>
          {slide.body && <p className={d.lead}><Txt value={slide.body} /></p>}
          {slide.note && <div className={d.quoteAuthor}>— <Txt value={slide.note} /></div>}
        </div>
      )
      break

    case 'statement':
      box = d.endBox
      content = (
        <div className={d.poster}>
          <h2 className={cls(image ? d.title : d.display, slide.title.length > 56 && d.long)}><Txt value={slide.title} /></h2>
          {slide.body && <p className={d.lead}><Txt value={slide.body} /></p>}
          {slide.note && <p className={d.note}><Txt value={slide.note} /></p>}
        </div>
      )
      break

    case 'agenda':
      box = d.endBox
      content = (
        <div className={d.agenda}>
          <Head slide={slide} big />
          <Rows slide={slide} numbers />
        </div>
      )
      break

    case 'context':
    case 'solution':
    case 'next_steps':
      box = d.endBox
      content = slide.items.length && !image ? (
        <div className={d.twoCol}>
          <div>
            <Head slide={slide} />
            {kind === 'next_steps' && slide.note && <p className={d.note}><Txt value={slide.note} /></p>}
          </div>
          <Rows slide={slide} numbers={kind === 'next_steps'} />
        </div>
      ) : (
        <div className={d.poster}>
          <Head slide={slide} />
          {slide.items.length > 0 && <div className={d.photoRows}><Rows slide={slide} numbers={kind === 'next_steps'} /></div>}
        </div>
      )
      break

    case 'problems':
    case 'opportunities':
    case 'benefits':
    case 'services':
      content = (
        <>
          <Head slide={slide} />
          <Columns slide={slide} numbers={kind === 'problems'} />
        </>
      )
      break

    case 'deliverables':
      box = d.endBox
      content = image ? (
        <div className={d.poster}>
          <Head slide={slide} />
          <div className={d.photoRows}><Rows slide={slide} numbers={false} /></div>
        </div>
      ) : (
        <div className={d.twoCol}>
          <Head slide={slide} />
          <Rows slide={slide} numbers={false} />
        </div>
      )
      break

    case 'process':
      content = (
        <>
          <Head slide={slide} />
          <div className={cls(d.steps, slide.items.length > 4 && d.manySteps)} style={{ gridTemplateColumns: `repeat(${Math.max(slide.items.length, 1)}, minmax(0, 1fr))` }}>
            {slide.items.map((it, i) => (
              <div className={d.step} key={i}>
                <div className={d.stepNum}>{i + 1}</div>
                <h3><Txt value={it.title} /></h3>
                {it.value && !/^\d{1,2}$/.test(it.value.trim()) && <div className={d.stepWhen}><Txt value={it.value} /></div>}
                {it.text && <p><Txt value={it.text} /></p>}
              </div>
            ))}
          </div>
          {slide.note && <div className={d.band}><Txt value={slide.note} /></div>}
        </>
      )
      break

    case 'roadmap': {
      const count = Math.max(slide.items.length, 1)
      content = (
        <>
          <Head slide={slide} />
          <div className={d.roadmap}>
            {slide.items.map((it, i) => {
              const left = (i / count) * 34
              return (
                <div className={d.roadRow} key={i}>
                  <div className={d.roadWhen}>{it.value ? <Txt value={it.value} /> : `Fase ${i + 1}`}</div>
                  <div className={d.roadTrack}>
                    <div className={d.roadBar} style={{ left: `${left}%`, right: 0 }}>
                      <strong><Txt value={it.title} /></strong>
                      {it.text && <span><Txt value={it.text} /></span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {slide.note && <div className={d.band}><Txt value={slide.note} /></div>}
        </>
      )
      break
    }

    case 'metrics':
      content = (
        <>
          <Head slide={slide} />
          <div className={cls(d.metrics, slide.items.length > 3 && d.many)} style={{ gridTemplateColumns: `repeat(${Math.max(slide.items.length, 1)}, minmax(0, 1fr))` }}>
            {slide.items.map((it, i) => (
              <div className={d.metric} key={i}>
                <div className={d.metricValue}><Txt value={it.value || AGENCY_TODO} /></div>
                <h3><Txt value={it.title} /></h3>
                {it.text && <p><Txt value={it.text} /></p>}
              </div>
            ))}
          </div>
        </>
      )
      break

    case 'chart': {
      const values = slide.items.map((it) => numeric(it.value))
      const max = Math.max(...values.map((v) => (v === null ? 0 : Math.abs(v))), 1)
      content = (
        <>
          <Head slide={slide} />
          <div className={d.chart} role="img" aria-label={slide.title}>
            {slide.items.map((it, i) => {
              const v = values[i]
              return (
                <div className={d.chartRow} key={i}>
                  <div className={d.chartLabel}><Txt value={it.title} />{it.text && <span><Txt value={it.text} /></span>}</div>
                  <div className={d.chartTrack}>
                    <div className={d.chartBar} style={{ width: `${v === null ? 0 : Math.max(2, (Math.abs(v) / max) * 100)}%` }} />
                  </div>
                  <div className={d.chartValue}><Txt value={it.value || AGENCY_TODO} /></div>
                </div>
              )
            })}
          </div>
        </>
      )
      break
    }

    case 'comparison': {
      const [a, b] = [slide.items[0], slide.items[1]]
      content = (
        <>
          <div className={d.compareHead}><Head slide={slide} /></div>
          <div className={d.compareCols}>
            {[a, b].map((it, i) =>
              it ? (
                <div className={d.compareCol} key={i}>
                  <h3><Txt value={it.title} /></h3>
                  <ul>{lines(it.text).map((l, k) => <li key={k}><Txt value={l} /></li>)}</ul>
                </div>
              ) : null
            )}
          </div>
          {slide.note && <p className={d.foot}><Txt value={slide.note} /></p>}
        </>
      )
      break
    }

    case 'investment':
      content = (
        <>
          <Head slide={slide} />
          <Investment ctx={ctx} />
        </>
      )
      break

    default:
      content = <Head slide={slide} />
  }

  const withHalfPhoto = Boolean(image) && ['statement', 'context', 'solution', 'next_steps', 'closing', 'section', 'deliverables'].includes(kind)
  return (
    <section className={cls(base, withHalfPhoto && d.withPhoto)} aria-hidden={!active}>
      {withHalfPhoto && <div className={d.halfPhoto} style={bg(image)} />}
      {run}
      <Fit slideKey={fitKey} className={box}>{content}</Fit>
      {foot}
    </section>
  )
}

/** Variabili CSS del tema: stile, accento (Speaqi o del cliente) e il testo che ci sta sopra. */
export function themeStyle(theme: AgencyTheme): CSSProperties {
  return { ['--accent' as string]: theme.accent, ['--accent-ink' as string]: inkOn(theme.accent) }
}

/**
 * Le slide su un palco fisso 1920x1080, scalato nel contenitore.
 * `full`: pagina pubblica (tastiera, tocco, stampa). `embedded`: anteprima dell'editor.
 * In stampa le slide vanno una per pagina 16:9.
 */
export default function AgencyDeck({
  slides,
  ctx,
  mode = 'embedded',
  index,
  onIndexChange,
  pdfHref,
  autoPrint = false,
  draft = false
}: {
  slides: AgencySlide[]
  ctx: DeckContext
  mode?: 'full' | 'embedded'
  index?: number
  onIndexChange?: (i: number) => void
  pdfHref?: string
  autoPrint?: boolean
  draft?: boolean
}) {
  const [inner, setInner] = useState(0)
  const current = Math.max(0, Math.min(slides.length - 1, index ?? inner))
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 0.3, x: 0, y: 0 })
  const go = (i: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, i))
    setInner(next)
    onIndexChange?.(next)
  }

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const scale = Math.min(w / 1920, h / 1080)
      setFit({ scale, x: (w - 1920 * scale) / 2, y: (h - 1080 * scale) / 2 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (mode !== 'full') return
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(current + 1) }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(current - 1) }
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(slides.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, current, slides.length])

  useEffect(() => {
    if (autoPrint) setTimeout(() => window.print(), 700)
  }, [autoPrint])

  const fields = deckFields(slides.map((s) => s.kind), ctx.theme.style)
  const touchX = useRef<number | null>(null)
  return (
    <div
      ref={box}
      className={cls(d.player, mode === 'full' ? d.full : d.embedded)}
      data-style={ctx.theme.style}
      style={themeStyle(ctx.theme)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1))
        touchX.current = null
      }}
    >
      <div className={d.bar}><span style={{ width: `${((current + 1) / Math.max(slides.length, 1)) * 100}%` }} /></div>
      <div className={d.stage} style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
        {slides.map((s, i) => (
          <SlideView key={s.id} slide={s} ctx={ctx} n={i + 1} total={slides.length} active={i === current} field={fields[i]} />
        ))}
        {draft && <div className={d.draftMark}>Bozza</div>}
      </div>
      <div className={d.controls}>
        <button type="button" onClick={() => go(current - 1)} aria-label="Slide precedente">←</button>
        <span>{current + 1} / {slides.length}</span>
        <button type="button" onClick={() => go(current + 1)} aria-label="Slide successiva">→</button>
        {mode === 'full' && (pdfHref
          ? <a href={pdfHref} aria-label="Scarica il PDF">PDF</a>
          : <button type="button" onClick={() => window.print()} aria-label="Salva come PDF">PDF</button>)}
      </div>
    </div>
  )
}
