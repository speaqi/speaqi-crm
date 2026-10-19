'use client'

import { DECK_SLIDE_KINDS, type DeckSlide, type DeckSlideKind } from '@/lib/tourism-deck'
import e from './editor.module.css'

export const KIND_LABELS: Record<DeckSlideKind, string> = {
  cover: 'Copertina',
  statement: 'Messaggio',
  cards: 'Schede',
  steps: 'Passi',
  closing: 'Chiusura'
}

/** Campi di una slide: li usano sia l'editor di un deck sia l'editor del modello. */
export default function SlideFields({
  slide,
  onChange,
  photos = [],
  template = false,
  actions
}: {
  slide: DeckSlide
  onChange: (next: DeckSlide) => void
  /** Foto del deck fra cui scegliere; vuoto = nessuna scelta di foto. */
  photos?: { id: string; name: string }[]
  /** Nel modello si vedono anche tipo e istruzione per l'agente. */
  template?: boolean
  actions?: React.ReactNode
}) {
  const set = (patch: Partial<DeckSlide>) => onChange({ ...slide, ...patch })
  const setItem = (i: number, patch: Partial<DeckSlide['items'][number]>) =>
    set({ items: slide.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) })
  const hasItems = slide.kind === 'cards' || slide.kind === 'steps'
  const canHavePhoto = slide.kind === 'cover' || slide.kind === 'statement'
  return (
    <div className={e.fieldset}>
      <header>
        <strong>
          {KIND_LABELS[slide.kind]} <span className={e.tag}>{slide.id}</span>
        </strong>
        {actions}
      </header>
      {template && (
        <label className={e.field}>
          Tipo di slide
          <select value={slide.kind} onChange={(ev) => set({ kind: ev.target.value as DeckSlideKind })}>
            {DECK_SLIDE_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
      )}
      <label className={e.field}>
        Titolo (il messaggio della slide)
        <input value={slide.title} maxLength={160} onChange={(ev) => set({ title: ev.target.value })} />
      </label>
      <label className={e.field}>
        Testo
        <textarea value={slide.body} maxLength={700} onChange={(ev) => set({ body: ev.target.value })} />
      </label>
      {hasItems && (
        <div className={e.items}>
          {slide.items.map((it, i) => (
            <div className={e.item} key={i}>
              <input aria-label={`Voce ${i + 1}: titolo`} value={it.title} maxLength={80} onChange={(ev) => setItem(i, { title: ev.target.value })} />
              <input aria-label={`Voce ${i + 1}: testo`} value={it.text} maxLength={260} onChange={(ev) => setItem(i, { text: ev.target.value })} />
            </div>
          ))}
          {template && (
            <div className={e.tools}>
              <button type="button" disabled={slide.items.length >= 6} onClick={() => set({ items: [...slide.items, { title: '', text: '' }] })}>+ Voce</button>
              <button type="button" disabled={!slide.items.length} onClick={() => set({ items: slide.items.slice(0, -1) })}>− Voce</button>
            </div>
          )}
        </div>
      )}
      {(slide.kind === 'steps' || slide.note) && (
        <label className={e.field}>
          Riga in fondo (es. il prezzo)
          <input value={slide.note} maxLength={300} onChange={(ev) => set({ note: ev.target.value })} />
        </label>
      )}
      {canHavePhoto && photos.length > 0 && (
        <label className={e.field}>
          Foto
          <select value={slide.image_asset_id || ''} onChange={(ev) => set({ image_asset_id: ev.target.value || null })}>
            <option value="">Nessuna</option>
            {photos.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      {template && (
        <label className={e.field}>
          Cosa deve personalizzare l’agente (non si mostra al cliente)
          <textarea value={slide.hint} maxLength={500} onChange={(ev) => set({ hint: ev.target.value })} />
        </label>
      )}
    </div>
  )
}
