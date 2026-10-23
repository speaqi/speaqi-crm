'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  DECK_KINDS,
  DECK_KIND_HINTS,
  DECK_KIND_LABELS,
  DECK_MAX_SLIDES,
  DECK_VAR_NAMES,
  DEFAULT_DECK_KIND,
  TOURISM_COMPANY_TEMPLATE,
  baseTemplateFor,
  type DeckKind,
  type DeckSlide,
  type DeckTemplate
} from '@/lib/tourism-deck'
import SlideFields from './SlideFields'
import QuoteTemplateFields from '@/components/agency/QuoteTemplateFields'
import { normalizeQuoteTemplate } from '@/lib/commercial-proposal'
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

/** I modelli di partenza delle presentazioni (uno per tipo), modificabili in modo generico. */
export default function TemplateEditor({ onClose, initialKind = DEFAULT_DECK_KIND }: { onClose: () => void; initialKind?: DeckKind }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState<DeckKind>(initialKind)
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
    let live = true
    setTemplate(null)
    setError('')
    apiFetch<{ template: DeckTemplate; version: number }>(`/api/tourism/deck-template?kind=${kind}`)
      .then((r) => { if (live) { setTemplate(r.template); setVersion(r.version); setDirty(false); setNotice('') } })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Modello non caricato'))
    return () => { live = false }
  }, [kind])
  const switchKind = (next: DeckKind) => {
    if (next === kind) return
    if (dirty && !confirm('Ci sono modifiche non salvate a questo modello. Passare all’altro le perde. Continuare?')) return
    setDirty(false)
    setKind(next)
  }

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
        body: JSON.stringify({ template, version, kind })
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
      <div className={e.tabs} role="group" aria-label="Tipo di modello">
        {DECK_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => switchKind(k)} data-testid={`template-kind-${k}`}>{DECK_KIND_LABELS[k]}</button>
        ))}
      </div>
      {!template ? (
        <p className={s.muted}>Caricamento…</p>
      ) : (
        <>
          <p className={e.help}>
            Questo è il punto di partenza delle presentazioni del tipo scelto. Nei testi puoi usare i segnaposto{' '}
            {DECK_VAR_NAMES.map((n) => <code key={n}>{`{{${n}}}`} </code>)}: si riempiono con i dati inseriti per ogni destinazione. Le presentazioni già create non cambiano.
          </p>
          <p className={e.help}>{DECK_KIND_HINTS[kind]} Puoi anche partire dalla base aziende, senza impegni di distribuzione impliciti. Caricare una base richiede poi “Salva il modello”.</p>
          <button type="button" className={s.secondary} onClick={() => confirm('Caricare la base Tourism per aziende? Slide, voci e contratto del modello saranno sostituiti. Le presentazioni già create restano invariate.') && edit(structuredClone(TOURISM_COMPANY_TEMPLATE))}>Carica la base Tourism per aziende</button>
          <div className={e.scroll}>
            <details className={e.fieldset}><summary>Preventivo e contratto Tourism di base</summary>
              <p className={e.help}>Segnaposto: {'{{cliente}}, {{progetto}}, {{destinazione}}, {{ente}}, {{paese}}, {{contatto}}, {{prezzo}}'}. Le condizioni della mappa gratuita valgono solo per accordi di distribuzione espliciti.</p>
              <QuoteTemplateFields value={normalizeQuoteTemplate(template.quote_template, 'tourism')} onChange={quote_template => edit({ ...template, quote_template })} />
            </details>
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
            <button type="button" className={s.secondary} disabled={template.slides.length >= DECK_MAX_SLIDES} onClick={() => edit({ ...template, slides: [...template.slides, newSlide(template.slides.length + 1)] })}>+ Aggiungi slide</button>
            <button type="button" className={s.secondary} onClick={() => confirm(`Ripristinare la base «${DECK_KIND_LABELS[kind]}»? Non si salva finché non premi Salva.`) && edit(baseTemplateFor(kind))}>Ripristina la proposta di base</button>
            <button type="button" className={s.primary} disabled={busy || !dirty} onClick={save}>{busy ? 'Salvo…' : 'Salva il modello'}</button>
          </div>
        </>
      )}
    </dialog>
  )
}
