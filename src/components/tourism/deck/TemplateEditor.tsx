'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { DECK_VAR_NAMES, DEFAULT_DECK_TEMPLATE, type DeckSlide, type DeckTemplate } from '@/lib/tourism-deck'
import SlideFields from './SlideFields'
import s from '../tourism.module.css'
import e from './editor.module.css'

const VAR_LABELS: Record<string, string> = {
  destinazione: 'Destinazione',
  ente: 'Ente destinatario',
  paese: 'Paese',
  prezzo: 'Prezzo (valore di partenza)',
  contatto: 'Contatto Speaqi (valore di partenza)'
}

const newSlide = (n: number): DeckSlide => ({ id: `slide-${n}`, kind: 'statement', title: '', body: '', items: [], note: '', image_asset_id: null, hint: '' })

/** Il modello di partenza di tutte le presentazioni, modificabile in modo generico. */
export default function TemplateEditor({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [template, setTemplate] = useState<DeckTemplate | null>(null)
  const [version, setVersion] = useState(1)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  useEffect(() => {
    apiFetch<{ template: DeckTemplate; version: number }>('/api/tourism/deck-template')
      .then((r) => { setTemplate(r.template); setVersion(r.version) })
      .catch((err) => setError(err instanceof Error ? err.message : 'Modello non caricato'))
  }, [])

  const edit = (next: DeckTemplate) => { setTemplate(next); setDirty(true); setNotice('') }
  const move = (i: number, d: number) => {
    if (!template) return
    const slides = [...template.slides]
    const j = i + d
    if (j < 0 || j >= slides.length) return
    ;[slides[i], slides[j]] = [slides[j], slides[i]]
    edit({ ...template, slides })
  }
  const close = () => {
    if (dirty && !confirm('Ci sono modifiche non salvate al modello. Chiudere comunque?')) return
    onClose()
  }
  async function save() {
    if (!template) return
    setBusy(true)
    setError('')
    try {
      const r = await apiFetch<{ template: DeckTemplate; version: number }>('/api/tourism/deck-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, version })
      })
      setTemplate(r.template)
      setVersion(r.version)
      setDirty(false)
      setNotice('Modello salvato. Vale per le nuove presentazioni e per le rigenerazioni.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog className={`${s.dialog} ${e.wide}`} ref={ref} onCancel={(ev) => { ev.preventDefault(); close() }} aria-label="Modello della presentazione">
      <header>
        <h2>Modello della presentazione</h2>
        <button className={s.iconButton} onClick={close} aria-label="Chiudi finestra" type="button">×</button>
      </header>
      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {!template ? (
        <p className={s.muted}>Caricamento…</p>
      ) : (
        <>
          <p className={e.help}>
            Questo è il punto di partenza di ogni presentazione. Nei testi puoi usare i segnaposto{' '}
            {DECK_VAR_NAMES.map((n) => <code key={n}>{`{{${n}}}`} </code>)}: si riempiono con i dati inseriti per ogni destinazione. Le presentazioni già create non cambiano.
          </p>
          <div className={e.scroll}>
            <div className={e.fieldset}>
              <header><strong>Valori di partenza</strong></header>
              <div className={e.row2}>
                {(['prezzo', 'contatto'] as const).map((name) => (
                  <label className={e.field} key={name}>
                    {VAR_LABELS[name]}
                    <input value={template.vars[name] || ''} maxLength={300} onChange={(ev) => edit({ ...template, vars: { ...template.vars, [name]: ev.target.value } })} />
                  </label>
                ))}
              </div>
            </div>
            {template.slides.map((slide, i) => (
              <SlideFields
                key={`${slide.id}-${i}`}
                template
                slide={slide}
                onChange={(next) => edit({ ...template, slides: template.slides.map((x, k) => (k === i ? next : x)) })}
                actions={
                  <span className={e.tools}>
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Sposta su">↑</button>
                    <button type="button" disabled={i === template.slides.length - 1} onClick={() => move(i, 1)} aria-label="Sposta giù">↓</button>
                    <button type="button" disabled={template.slides.length <= 1} onClick={() => confirm('Eliminare questa slide dal modello?') && edit({ ...template, slides: template.slides.filter((_, k) => k !== i) })}>Elimina</button>
                  </span>
                }
              />
            ))}
          </div>
          <div className={s.actions}>
            <button type="button" className={s.secondary} disabled={template.slides.length >= 12} onClick={() => edit({ ...template, slides: [...template.slides, newSlide(template.slides.length + 1)] })}>+ Aggiungi slide</button>
            <button type="button" className={s.secondary} onClick={() => confirm('Ripristinare la proposta destinazioni di base? Non si salva finché non premi Salva.') && edit(structuredClone(DEFAULT_DECK_TEMPLATE))}>Ripristina la proposta di base</button>
            <button type="button" className={s.primary} disabled={busy || !dirty} onClick={save}>{busy ? 'Salvo…' : 'Salva il modello'}</button>
          </div>
        </>
      )}
    </dialog>
  )
}
