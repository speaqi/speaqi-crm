'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { EntityPicker } from '../TourismResearch'
import type { TourismEntity } from '@/lib/tourism'
import s from '../tourism.module.css'
import e from './editor.module.css'

type Prefill = { id: string; name: string; country_code?: string; website?: string | null }

const countryName = (code?: string) => {
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['it'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

/** "Crea la presentazione": destinazione, ente, note libere, documenti e foto. L'agente fa il resto. */
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
    setPicked({ id: t.id, name: t.name, country_code: t.country_code, website: t.website })
    setEnte(t.name)
    if (!destinazione) setDestinazione(t.name)
    if (!paese) setPaese(countryName(t.country_code))
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!destinazione.trim()) return setError('Indica la destinazione')
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
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

  return (
    <dialog className={s.dialog} ref={ref} onCancel={(ev) => (busy ? ev.preventDefault() : onClose())} aria-label="Crea la presentazione">
      <header>
        <h2>Crea la presentazione</h2>
        <button className={s.iconButton} onClick={onClose} disabled={busy} aria-label="Chiudi finestra" type="button">×</button>
      </header>
      {error && <p className={s.error} role="alert">{error}</p>}
      <form className={s.form} onSubmit={submit}>
        <p className={e.help}>
          Parti dal modello TTG. L’agente legge il testo, i documenti e le foto che aggiungi e riscrive le slide per questa destinazione. Quello che non trova resta <code>[DA VERIFICARE]</code>: lo completi tu prima di approvare.
        </p>
        {!entity && (
          <div>
            <EntityPicker label="Collega un ente di Tourism Intelligence (facoltativo)" onSelect={pick} />
            {picked && <small className={s.muted}>Collegato a {picked.name}</small>}
          </div>
        )}
        <div className={s.formGrid}>
          <label>Destinazione *<input required value={destinazione} maxLength={200} onChange={(ev) => setDestinazione(ev.target.value)} placeholder="Es. Costiera Amalfitana" /></label>
          <label>Ente destinatario<input value={ente} maxLength={200} onChange={(ev) => setEnte(ev.target.value)} placeholder="DMC o DMO a cui la mandi" /></label>
          <label>Paese<input value={paese} maxLength={100} onChange={(ev) => setPaese(ev.target.value)} /></label>
          <label>Contatto Speaqi in chiusura<input value={contatto} maxLength={300} onChange={(ev) => setContatto(ev.target.value)} placeholder="Nome, email, telefono" /></label>
        </div>
        <label>
          Prezzo proposto
          <input value={prezzo} maxLength={300} onChange={(ev) => setPrezzo(ev.target.value)} placeholder="Vuoto = offerta standard, da verificare per questo ente" />
        </label>
        <label>
          Informazioni sulla destinazione
          <textarea value={notes} maxLength={30000} onChange={(ev) => setNotes(ev.target.value)} rows={7} placeholder="Incolla appunti, una mail, il testo del sito: luoghi, lingue dei visitatori, cosa conta per loro…" />
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
