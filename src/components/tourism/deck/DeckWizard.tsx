'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { EntityPicker } from '../TourismResearch'
import { TOURISM_TYPES, type TourismEntity } from '@/lib/tourism'
import { DECK_KINDS, DECK_KIND_HINTS, DECK_KIND_LABELS, suggestDeckKind, type DeckKind } from '@/lib/tourism-deck'
import s from '../tourism.module.css'
import e from './editor.module.css'

type Prefill = { id: string; name: string; country_code?: string; website?: string | null; type_code?: string | null }

const countryName = (code?: string) => {
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['it'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

/** Cosa cambia nel form fra le due basi: le parole con cui si chiede lo stesso dato. */
const COPY: Record<DeckKind, { destination: string; destinationPlaceholder: string; entity: string; entityPlaceholder: string; terms: string; termsPlaceholder: string; notes: string; notesPlaceholder: string }> = {
  destination: {
    destination: 'Destinazione *',
    destinationPlaceholder: 'Es. Costiera Amalfitana',
    entity: 'Ente destinatario',
    entityPlaceholder: 'DMC o DMO a cui la mandi',
    terms: 'Condizioni (la mappa è gratuita)',
    termsPlaceholder: 'Vuoto = almeno 2 canali di distribuzione, un referente e un piano continuativo',
    notes: 'Informazioni sulla destinazione',
    notesPlaceholder: 'Incolla appunti, una mail, il testo del sito: luoghi, lingue dei visitatori, cosa conta per loro…'
  },
  distribution: {
    destination: 'Destinazione o mete dei clienti *',
    destinationPlaceholder: 'Es. Roma e Napoli, le mete dei vostri passeggeri',
    entity: 'Partner destinatario',
    entityPlaceholder: 'Compagnia, tour operator, aeroporto o rete di vendita',
    terms: 'Condizioni commerciali (revenue sharing)',
    termsPlaceholder: 'Vuoto = commissioni 20% / 35% / 50% a scaglioni, da concordare',
    notes: 'Informazioni sul partner',
    notesPlaceholder: 'Incolla appunti, una mail, il testo del sito: clienti e numeri con la fonte, canali che usa, mercati di provenienza…'
  }
}

/** "Crea la presentazione": tipo di base, destinazione, ente, note libere, documenti e foto. L'agente fa il resto. */
export default function DeckWizard({
  entity,
  onClose,
  onCreated
}: {
  entity?: Prefill | null
  onClose: () => void
  onCreated: (deckId: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [picked, setPicked] = useState<Prefill | null>(entity ?? null)
  // Il sistema propone la base dal tipo di ente; chi crea può sempre cambiarla. Senza indizi non si indovina: si sceglie.
  const suggestionFor = (p: Prefill | null) => (p ? suggestDeckKind({ type_code: p.type_code, name: p.name }, p.type_code ? (TOURISM_TYPES as Record<string, string>)[p.type_code] : undefined) : null)
  const [suggestion, setSuggestion] = useState(() => suggestionFor(entity ?? null))
  const [kind, setKind] = useState<DeckKind | null>(() => suggestionFor(entity ?? null)?.kind ?? null)
  const [kindChosen, setKindChosen] = useState(false)
  const [destinazione, setDestinazione] = useState(entity?.name ?? '')
  const [ente, setEnte] = useState(entity?.name ?? '')
  const [paese, setPaese] = useState(countryName(entity?.country_code))
  const [prezzo, setPrezzo] = useState('')
  const [contatto, setContatto] = useState('')
  const [notes, setNotes] = useState(entity?.website ? `Sito: ${entity.website}\n` : '')
  const [files, setFiles] = useState<File[]>([])
  const [generate, setGenerate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])

  const pick = (t: TourismEntity) => {
    const next = { id: t.id, name: t.name, country_code: t.country_code, website: t.website, type_code: t.type_code }
    const hint = suggestionFor(next)
    setSuggestion(hint)
    if (!kindChosen && hint) setKind(hint.kind)
    setPicked(next)
    setEnte(t.name)
    if (!destinazione) setDestinazione(t.name)
    if (!paese) setPaese(countryName(t.country_code))
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!kind) return setError('Scegli il tipo di presentazione')
    if (!destinazione.trim()) return setError('Indica la destinazione')
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.set('kind', kind)
      fd.set('destinazione', destinazione)
      fd.set('ente', ente)
      fd.set('paese', paese)
      fd.set('prezzo', prezzo)
      fd.set('contatto', contatto)
      fd.set('notes', notes)
      fd.set('generate', generate ? '1' : '0')
      if (picked) fd.set('entity_id', picked.id)
      for (const f of files) fd.append('files', f)
      const deck = await apiFetch<{ id: string }>('/api/tourism/decks', { method: 'POST', body: fd })
      onCreated(deck.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operazione non riuscita')
      setBusy(false)
    }
  }

  const copy = COPY[kind ?? 'destination']

  return (
    <dialog className={s.dialog} ref={ref} onCancel={(ev) => (busy ? ev.preventDefault() : onClose())} aria-label="Crea la presentazione">
      <header>
        <h2>Crea la presentazione</h2>
        <button className={s.iconButton} onClick={onClose} disabled={busy} aria-label="Chiudi finestra" type="button">×</button>
      </header>
      {error && <p className={s.error} role="alert">{error}</p>}
      <form className={s.form} onSubmit={submit}>
        <p className={e.help}>
          Parti dal modello Tourism del tipo scelto. L’agente legge testo, documenti e foto e adatta le slide al destinatario. Quello che manca resta <code>[DA VERIFICARE]</code>: lo completi prima di approvare.
        </p>
        {!entity && (
          <div>
            <EntityPicker label="Collega un ente di Tourism Intelligence (facoltativo)" onSelect={pick} />
            {picked && <small className={s.muted}>Collegato a {picked.name}</small>}
          </div>
        )}
        <fieldset className={e.kinds} aria-label="Tipo di presentazione">
          <legend>Che presentazione stai preparando?</legend>
          {DECK_KINDS.map((k) => (
            <label key={k} className={e.kind} data-on={kind === k} data-testid={`deck-kind-${k}`}>
              <input type="radio" name="deck-kind" checked={kind === k} onChange={() => { setKind(k); setKindChosen(true) }} />
              <strong>{DECK_KIND_LABELS[k]}{suggestion?.kind === k && <span className={e.suggested}>Consigliata</span>}</strong>
              <span>{DECK_KIND_HINTS[k]}</span>
            </label>
          ))}
          {suggestion && <small className={e.help}>{suggestion.reason} Puoi cambiarla.</small>}
          {!kind && !suggestion && <small className={e.help}>Scegli la base: cambiano slide, condizioni e tono. Collegando un ente di Tourism Intelligence la proponiamo noi.</small>}
        </fieldset>
        <div className={s.formGrid}>
          <label>{copy.destination}<input required value={destinazione} maxLength={200} onChange={(ev) => setDestinazione(ev.target.value)} placeholder={copy.destinationPlaceholder} /></label>
          <label>{copy.entity}<input value={ente} maxLength={200} onChange={(ev) => setEnte(ev.target.value)} placeholder={copy.entityPlaceholder} /></label>
          <label>Paese<input value={paese} maxLength={100} onChange={(ev) => setPaese(ev.target.value)} /></label>
          <label>Contatto Speaqi in chiusura<input value={contatto} maxLength={300} onChange={(ev) => setContatto(ev.target.value)} placeholder="Nome, email, telefono" /></label>
        </div>
        <label>
          {copy.terms}
          <input value={prezzo} maxLength={300} onChange={(ev) => setPrezzo(ev.target.value)} placeholder={copy.termsPlaceholder} />
        </label>
        <label>
          {copy.notes}
          <textarea value={notes} maxLength={30000} onChange={(ev) => setNotes(ev.target.value)} rows={7} placeholder={copy.notesPlaceholder} />
        </label>
        <label>
          Documenti e foto
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.docx,.txt,.md,.csv" onChange={(ev) => setFiles(Array.from(ev.target.files || []))} />
          <small className={s.muted}>Foto JPG, PNG, WebP (max 8, 8 MB l’una). Documenti PDF, Word, TXT, MD (max 4, 12 MB l’uno).</small>
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={generate} onChange={(ev) => setGenerate(ev.target.checked)} style={{ width: 'auto' }} />
          Fai leggere tutto all’agente e genera subito
        </label>
        <div className={s.actions}>
          <button className={s.secondary} type="button" onClick={onClose} disabled={busy}>Annulla</button>
          <button className={s.primary} type="submit" disabled={busy}>
            {busy ? <><span className={e.spin} /> {generate ? 'L’agente sta leggendo i materiali… può richiedere un minuto' : 'Salvo…'}</> : 'Crea la presentazione'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
