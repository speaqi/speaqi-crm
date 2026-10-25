'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { DECK_AI_ART, DECK_ART, DECK_TODO_PATTERN, type DeckIcon, type DeckSlide, type DeckTone } from '@/lib/tourism-deck'
import d from './deck.module.css'

/** Testo con i segnaposto da completare ben visibili. */
function Text({ value }: { value: string }) {
  const parts: (string | { todo: string })[] = []
  let last = 0
  for (const m of value.matchAll(DECK_TODO_PATTERN)) {
    if (m.index > last) parts.push(value.slice(last, m.index))
    parts.push({ todo: m[0] })
    last = m.index + m[0].length
  }
  if (last < value.length) parts.push(value.slice(last))
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <mark key={i} className={d.todo}>{p.todo}</mark>
      )}
    </>
  )
}

const photo = (url?: string | null): CSSProperties | undefined => (url ? { backgroundImage: `url("${url}")` } : undefined)
const cls = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/** Icone a tratto (stile lucide), disegnate qui: nessun file esterno. */
const ICON_PATHS: Record<DeckIcon, string[]> = {
  star: ['M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z'],
  zap: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20c.4-3.4 3-5.5 6.5-5.5s6.1 2.1 6.5 5.5', 'M16 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.8c2 .7 3.3 2.5 3.5 5.2'],
  shield: ['M12 3l8 3v6c0 4.6-3.3 8-8 9-4.7-1-8-4.4-8-9V6z', 'M8.5 12l2.5 2.5 4.5-4.5'],
  chat: ['M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5A8.5 8.5 0 1 1 21 11.5z', 'M8.5 12.5c1.2-2 2.3-2 3.5 0s2.3 2 3.5 0'],
  send: ['M5 4l15 8-15 8 3-8z', 'M8 12h12']
}
function Icon({ name }: { name: DeckIcon }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON_PATHS[name].map((path) => <path key={path} d={path} />)}
    </svg>
  )
}

/** Il titolo va a capo dove il modello va a capo (\n). */
function Lines({ value }: { value: string }) {
  const lines = value.split('\n')
  return <>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}<Text value={line} /></Fragment>)}</>
}

const DEFAULT_TONE: Record<DeckSlide['kind'], DeckTone> = {
  cover: 'dark',
  statement: 'dark',
  list: 'light',
  cards: 'light',
  steps: 'light',
  languages: 'dark',
  showcase: 'dark',
  figures: 'deep',
  compare: 'light',
  demo: 'accent',
  media: 'dark',
  closing: 'dark'
}

function Foot({ footnote, n, total }: { footnote?: string; n: number; total: number }) {
  return (
    <div className={d.foot}>
      <span>{footnote ? <Text value={footnote} /> : null}</span>
      <span>{n} / {total}</span>
    </div>
  )
}

function Kicker({ value }: { value?: string }) {
  return value ? <div className={d.kicker}><Text value={value} /></div> : null
}

export function SlideView({
  slide,
  image,
  n,
  total,
  active
}: {
  slide: DeckSlide
  /** Foto caricata per questo deck: vince sull'immagine fissa del modello. */
  image?: string | null
  n: number
  total: number
  /** Non più mostrata a piè di slide; resta per compatibilità con chi la passa. */
  destination?: string
  active: boolean
}) {
  const tone = slide.tone || DEFAULT_TONE[slide.kind]
  const art = slide.art ? DECK_ART[slide.art] : null
  const picture = image || art
  const aiArt = !image && !!slide.art && DECK_AI_ART.includes(slide.art)
  const qr = slide.qr ? DECK_ART[slide.qr] : null
  const base = cls(d.slide, d[tone], d[slide.kind], active && d.active)
  const foot = <Foot footnote={slide.footnote} n={n} total={total} />

  if (slide.kind === 'cover') {
    return (
      <section className={base} aria-hidden={!active}>
        {picture && <div className={d.coverPhoto} style={photo(picture)} />}
        {picture && <div className={d.coverShade} />}
        <div className={d.coverText}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={d.logo} src="/deck/logo-on-color.png" alt="Speaqi" />
          <Kicker value={slide.kicker} />
          <h1><Lines value={slide.title} /></h1>
          {slide.body && <p className={d.sub}><Text value={slide.body} /></p>}
        </div>
        {(aiArt || slide.footnote) && <div className={d.credit}>{slide.footnote ? <Text value={slide.footnote} /> : 'Speaqi Guides · Immagine generata con AI'}</div>}
      </section>
    )
  }

  if (slide.kind === 'list') {
    return (
      <section className={cls(base, !!picture && d.withSide)} aria-hidden={!active}>
        {picture && <div className={d.side} style={photo(picture)} />}
        <div className={d.listText}>
          <Kicker value={slide.kicker} />
          <h2><Lines value={slide.title} /></h2>
          {slide.body && <p className={d.lead}><Text value={slide.body} /></p>}
          <div className={d.rows}>
            {slide.items.map((item, i) => (
              <div className={d.listItem} key={i}>
                {item.icon && <span className={d.iconBox}><Icon name={item.icon} /></span>}
                <div>
                  <h3><Text value={item.title} /></h3>
                  {item.text && <p><Text value={item.text} /></p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        {!picture && foot}
      </section>
    )
  }

  if (slide.kind === 'languages') {
    return (
      <section className={base} aria-hidden={!active}>
        <div className={d.langText}>
          <Kicker value={slide.kicker} />
          <h2><Lines value={slide.title} /></h2>
          {(slide.note || slide.body) && (
            <div className={d.box}>
              <span className={d.iconBox}><Icon name="globe" /></span>
              <div>
                {slide.note && <h3><Text value={slide.note} /></h3>}
                {slide.body && <p><Text value={slide.body} /></p>}
              </div>
            </div>
          )}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {art && <img className={d.langArt} src={art} alt="Le lingue della mappa" />}
        {foot}
      </section>
    )
  }

  if (slide.kind === 'showcase') {
    return (
      <section className={base} aria-hidden={!active}>
        <Kicker value={slide.kicker} />
        <h2><Lines value={slide.title} /></h2>
        <div className={d.showcaseGrid} style={{ gridTemplateColumns: `repeat(${Math.max(slide.items.length, 1)}, minmax(0, 1fr))` }}>
          {slide.items.map((item, i) => (
            <div className={cls(d.showcaseCard, item.highlight && d.hl)} key={i}>
              <h3><Text value={item.title} /></h3>
              <div>
                {item.value && <div className={d.bigValue}>{item.value}</div>}
                {item.text && <p><Text value={item.text} /></p>}
              </div>
            </div>
          ))}
        </div>
        {foot}
      </section>
    )
  }

  if (slide.kind === 'figures') {
    return (
      <section className={base} aria-hidden={!active}>
        <Kicker value={slide.kicker} />
        <h2><Lines value={slide.title} /></h2>
        <div className={d.figureRow} style={{ gridTemplateColumns: `repeat(${Math.max(slide.items.length, 1)}, minmax(0, 1fr))` }}>
          {slide.items.map((item, i) => (
            <div className={d.figure} key={i}>
              {item.value && <div className={d.bigValue}>{item.value}</div>}
              <h3><Text value={item.title} /></h3>
              {item.text && <p><Text value={item.text} /></p>}
            </div>
          ))}
        </div>
        {slide.note && <div className={d.box}><p><Text value={slide.note} /></p></div>}
        {foot}
      </section>
    )
  }

  if (slide.kind === 'compare') {
    return (
      <section className={base} aria-hidden={!active}>
        <Kicker value={slide.kicker} />
        <h2><Lines value={slide.title} /></h2>
        <div className={d.compareRow}>
          {slide.items.map((item, i) => (
            <div className={cls(d.compareCard, item.highlight && d.hl)} key={i}>
              <div className={d.compareLabel}><Text value={item.title} /></div>
              {item.text.split('\n').filter(Boolean).map((line, k) => <p key={k}><Text value={line} /></p>)}
            </div>
          ))}
        </div>
        {slide.note && <div className={d.statementLine}><Text value={slide.note} /></div>}
        {foot}
      </section>
    )
  }

  if (slide.kind === 'demo') {
    return (
      <section className={base} aria-hidden={!active}>
        <div className={d.demoText}>
          <Kicker value={slide.kicker} />
          <h2><Lines value={slide.title} /></h2>
          <div className={d.demoQr}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <span className={d.qrCard}><img src={qr} alt="QR Code" /></span>}
            <div>
              {slide.body && <p className={d.demoHint}><Text value={slide.body} /></p>}
              {slide.note && <p className={d.demoUrl}><Text value={slide.note} /></p>}
            </div>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {picture && <img className={d.demoArt} src={picture} alt="" />}
        {foot}
      </section>
    )
  }

  if (slide.kind === 'media') {
    return (
      <section className={base} aria-hidden={!active}>
        <div className={cls(d.kicker, d.center)}><Text value={slide.kicker || slide.title} /></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {picture && <img className={d.mediaArt} src={picture} alt={slide.title} />}
        {foot}
      </section>
    )
  }

  if (slide.kind === 'closing') {
    const contacts = slide.items.length > 0
    return (
      <section className={base} aria-hidden={!active}>
        <div className={d.closingGrid}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={d.logoSmall} src="/deck/logo-on-color.png" alt="Speaqi" />
            <h2><Lines value={slide.title} /></h2>
            {contacts ? (
              <>
                {slide.body && <div className={d.person}><Text value={slide.body} /></div>}
                {slide.note && <div className={d.role}><Text value={slide.note} /></div>}
                <div className={d.contacts}>
                  {slide.items.map((item, i) => (
                    <div className={d.contact} key={i}>
                      <span className={d.iconBox}>{item.icon && <Icon name={item.icon} />}</span>
                      <span><Text value={item.title} /></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              slide.body && <p className={d.lead}><Text value={slide.body} /></p>
            )}
          </div>
          {qr && (
            <div className={d.qrPanel}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR Code" />
              {slide.footnote && <strong><Text value={slide.footnote} /></strong>}
            </div>
          )}
        </div>
      </section>
    )
  }

  if (slide.kind === 'statement') {
    return (
      <section className={base} aria-hidden={!active}>
        <div className={cls(d.split, !!picture && d.splitImage)}>
          <div className={d.statementText}>
            <Kicker value={slide.kicker} />
            <h2><Lines value={slide.title} /></h2>
            {slide.body && <p className={d.lead}><Text value={slide.body} /></p>}
          </div>
          {picture && <div className={d.photo} style={photo(picture)} />}
        </div>
        {slide.note && <div className={d.pill}><Text value={slide.note} /></div>}
        {foot}
      </section>
    )
  }

  // Schede e passi.
  const count = slide.items.length
  const columns = slide.kind === 'steps' ? Math.min(Math.max(count, 1), 6) : count === 4 ? 2 : count > 4 ? 3 : Math.max(count, 1)
  const labelled = slide.kind === 'cards' && slide.items.some((i) => i.value)
  return (
    <section className={base} aria-hidden={!active}>
      <Kicker value={slide.kicker} />
      <h2><Lines value={slide.title} /></h2>
      {slide.body && <p className={d.lead}><Text value={slide.body} /></p>}
      <div
        className={cls(d.grid, count > 3 && d.compact, labelled && d.labelled, slide.kind === 'steps' && count >= 5 && d.dense)}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {slide.items.map((item, i) => (
          <div className={cls(d.card, item.highlight && d.hl)} key={i}>
            {slide.kind === 'steps' && <div className={d.num}>{String(i + 1).padStart(2, '0')}</div>}
            {item.value && slide.kind === 'cards' && <div className={d.label}><Text value={item.value} /></div>}
            <div className={d.cardHead}>
              {item.icon && <span className={d.iconBox}><Icon name={item.icon} /></span>}
              <h3><Text value={item.title} /></h3>
            </div>
            {item.text && <p><Text value={item.text} /></p>}
          </div>
        ))}
      </div>
      {slide.note && (slide.kind === 'cards' && tone !== 'light' ? <div className={d.afterLine}><Text value={slide.note} /></div> : <div className={d.pill}><Text value={slide.note} /></div>)}
      {foot}
    </section>
  )
}

/**
 * Le slide su un palco fisso 1920x1080, scalato per stare nel contenitore.
 * `full`: a tutto schermo (pagina pubblica, tastiera e tocco). `embedded`: dentro l'editor.
 * In stampa le slide si dispongono una dopo l'altra: "Salva come PDF" dal browser.
 */
export default function DeckPlayer({
  slides,
  images,
  destination,
  mode = 'embedded',
  index,
  onIndexChange,
  printable = false,
  pdfHref,
  quoteHref,
  autoPrint = false
}: {
  slides: DeckSlide[]
  images: Record<string, string>
  destination: string
  mode?: 'full' | 'embedded'
  index?: number
  onIndexChange?: (i: number) => void
  printable?: boolean
  /** Se c'è, il pulsante PDF scarica questo file invece di aprire la stampa del browser. */
  pdfHref?: string
  quoteHref?: string
  autoPrint?: boolean
}) {
  const [inner, setInner] = useState(0)
  const current = Math.max(0, Math.min(slides.length - 1, index ?? inner))
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 })
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
    if (autoPrint) setTimeout(() => window.print(), 600)
  }, [autoPrint])

  const touchX = useRef<number | null>(null)
  return (
    <div
      ref={box}
      className={`${d.player} ${mode === 'full' ? d.full : d.embedded}`}
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
          <SlideView key={s.id} slide={s} image={s.image_asset_id ? images[s.image_asset_id] : null} n={i + 1} total={slides.length} active={i === current} />
        ))}
      </div>
      <div className={d.controls}>
        <button type="button" onClick={() => go(current - 1)} aria-label="Slide precedente">←</button>
        <span>{current + 1} / {slides.length}</span>
        <button type="button" onClick={() => go(current + 1)} aria-label="Slide successiva">→</button>
        {quoteHref && <a href={quoteHref} style={{ color: 'inherit', fontSize: 15, padding: '4px 10px' }}>Preventivo e contratto →</a>}
        {printable && (pdfHref
          ? <a href={pdfHref} aria-label="Scarica il PDF" style={{ color: 'inherit', font: 'inherit', fontSize: 15, padding: '4px 10px', textDecoration: 'none' }}>PDF</a>
          : <button type="button" onClick={() => window.print()} aria-label="Salva come PDF">PDF</button>)}
      </div>
    </div>
  )
}
