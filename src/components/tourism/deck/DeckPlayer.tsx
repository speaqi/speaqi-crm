'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { DECK_TODO_PATTERN, type DeckSlide } from '@/lib/tourism-deck'
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

function Foot({ destination, n, total, dark }: { destination: string; n: number; total: number; dark: boolean }) {
  return (
    <div className={d.foot}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dark ? '/deck/logo-on-color.png' : '/deck/logo.png'} alt="Speaqi" />
      <span>
        <Text value={destination} /> · {n} / {total}
      </span>
    </div>
  )
}

export function SlideView({
  slide,
  image,
  n,
  total,
  destination,
  active
}: {
  slide: DeckSlide
  image?: string | null
  n: number
  total: number
  destination: string
  active: boolean
}) {
  const cls = (...c: (string | false)[]) => c.filter(Boolean).join(' ')
  // Le schede oltre quattro vanno su due righe da tre, compatte: in quattro colonne la seconda riga uscirebbe dal palco.
  const columns =
    slide.kind === 'cards' && slide.items.length > 4 ? 3 : Math.min(Math.max(slide.items.length, 1), slide.kind === 'steps' ? 6 : 4)
  const compact = slide.kind === 'cards' && slide.items.length > 4

  if (slide.kind === 'cover') {
    return (
      <section className={cls(d.slide, d.dark, d.cover, active && d.active)} style={photo(image)} aria-hidden={!active}>
        {image && <div className={d.shade} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={d.logo} src="/deck/logo-on-color.png" alt="Speaqi" />
        <h1><Text value={slide.title} /></h1>
        {slide.body && <div className={d.sub}><Text value={slide.body} /></div>}
      </section>
    )
  }

  if (slide.kind === 'statement') {
    return (
      <section className={cls(d.slide, d.dark, d.statement, active && d.active)} aria-hidden={!active}>
        <div className={cls(d.split, !!image && d.splitImage)}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2><Text value={slide.title} /></h2>
            {slide.body && <p className={cls(d.lead, d.muted)}><Text value={slide.body} /></p>}
          </div>
          {image && <div className={d.photo} style={photo(image)} />}
        </div>
        <Foot destination={destination} n={n} total={total} dark />
      </section>
    )
  }

  if (slide.kind === 'closing') {
    return (
      <section className={cls(d.slide, d.dark, d.closing, active && d.active)} aria-hidden={!active}>
        <h2><Text value={slide.title} /></h2>
        {slide.body && <p className={cls(d.lead, d.muted)}><Text value={slide.body} /></p>}
        <Foot destination={destination} n={n} total={total} dark />
      </section>
    )
  }

  const dark = slide.kind === 'steps'
  return (
    <section className={cls(d.slide, dark ? d.dark : d.light, active && d.active)} aria-hidden={!active}>
      <h2><Text value={slide.title} /></h2>
      {slide.body && <p className={cls(d.lead, dark && d.muted)}><Text value={slide.body} /></p>}
      <div className={cls(d.cards, columns >= 5 && d.dense, compact && d.compact)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {slide.items.map((item, i) => (
          <div className={d.card} key={i}>
            <div className={d.num}>{slide.kind === 'steps' ? i + 1 : String(i + 1).padStart(2, '0')}</div>
            <h3><Text value={item.title} /></h3>
            <p><Text value={item.text} /></p>
          </div>
        ))}
      </div>
      {slide.note && <div className={d.note}><Text value={slide.note} /></div>}
      <Foot destination={destination} n={n} total={total} dark={dark} />
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
          <SlideView key={s.id} slide={s} image={s.image_asset_id ? images[s.image_asset_id] : null} n={i + 1} total={slides.length} destination={destination} active={i === current} />
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
