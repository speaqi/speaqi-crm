'use client'

import { DECK_SLIDE_KINDS, type DeckSlide, type DeckSlideKind } from '@/lib/tourism-deck'
import e from './editor.module.css'

export const KIND_LABELS: Record<DeckSlideKind, string> = {
  cover: 'Copertina',
  statement: 'Messaggio',
  list: 'Elenco con foto',
  cards: 'Schede',
  steps: 'Passi',
  languages: 'Lingue',
  showcase: 'Catalogo (numeri per guida)',
  figures: 'Numeri grandi',
  compare: 'Confronto a due colonne',
  demo: 'Prova (QR)',
  media: 'Immagine grande',
  closing: 'Chiusura'
}

const WITH_ITEMS: DeckSlideKind[] = ['list', 'cards', 'steps', 'showcase', 'figures', 'compare', 'closing']
const WITH_VALUE: DeckSlideKind[] = ['cards', 'showcase', 'figures']
const WITH_PHOTO: DeckSlideKind[] = ['cover', 'statement', 'list']

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
  const hasItems = WITH_ITEMS.includes(slide.kind)
  const hasValue = WITH_VALUE.includes(slide.kind)
  const canHavePhoto = WITH_PHOTO.includes(slide.kind)
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
      {slide.fixed && !template && <p className={e.help}>Testo della presentazione base: l’agente non lo cambia. Puoi correggerlo a mano.</p>}
      <label className={e.field}>
        Etichetta sopra il titolo
        <input value={slide.kicker || ''} maxLength={80} onChange={(ev) => set({ kicker: ev.target.value || undefined })} />
      </label>
      <label className={e.field}>
        Titolo (il messaggio della slide; a capo dove vuoi)
        <textarea rows={2} value={slide.title} maxLength={160} onChange={(ev) => set({ title: ev.target.value })} />
      </label>
      <label className={e.field}>
        Testo
        <textarea value={slide.body} maxLength={700} onChange={(ev) => set({ body: ev.target.value })} />
      </label>
      {hasItems && (
        <div className={e.items}>
          {slide.items.map((it, i) => (
            <div className={`${e.item} ${hasValue ? e.item3 : ''}`} key={i}>
              {hasValue && <input aria-label={`Voce ${i + 1}: numero o etichetta`} value={it.value || ''} maxLength={40} onChange={(ev) => setItem(i, { value: ev.target.value || undefined })} />}
              <input aria-label={`Voce ${i + 1}: titolo`} value={it.title} maxLength={80} onChange={(ev) => setItem(i, { title: ev.target.value })} />
              {slide.kind === 'compare'
                ? <textarea aria-label={`Colonna ${i + 1}: righe, una per riga`} value={it.text} maxLength={260} onChange={(ev) => setItem(i, { text: ev.target.value })} />
                : <input aria-label={`Voce ${i + 1}: testo`} value={it.text} maxLength={260} onChange={(ev) => setItem(i, { text: ev.target.value })} />}
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
          Riga in evidenza
          <input value={slide.note} maxLength={300} onChange={(ev) => set({ note: ev.target.value })} />
        </label>
      )}
      {(template || slide.footnote) && (
        <label className={e.field}>
          Nota piccola in basso (fonte, condizioni)
          <input value={slide.footnote || ''} maxLength={200} onChange={(ev) => set({ footnote: ev.target.value || undefined })} />
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
        <label className={e.check}>
          <input type="checkbox" checked={!!slide.fixed} onChange={(ev) => set({ fixed: ev.target.checked || undefined })} />
          Testo fisso: l’agente sceglie al più la foto
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
