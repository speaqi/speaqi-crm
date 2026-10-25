'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import { countTodo, type DeckSlide } from '@/lib/tourism-deck'
import { formatMoney } from '@/lib/agency'
import type { DeckView } from '@/lib/server/tourism-decks'
import DeckPlayer from './DeckPlayer'
import SlideFields from './SlideFields'
import { DECK_STATUS_LABELS } from './TourismDecks'
import s from '../tourism.module.css'
import e from './editor.module.css'

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Una presentazione: modifica, rigenera con l'agente, controlla i [DA VERIFICARE], approva e condividi. */
export default function DeckEditor({ id }: { id: string }) {
  const router = useRouter()
  const [deck, setDeck] = useState<DeckView | null>(null)
  const [slides, setSlides] = useState<DeckSlide[]>([])
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [instruction, setInstruction] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const adopt = useCallback((d: DeckView, keepEdits = false) => {
    setDeck(d)
    if (!keepEdits) {
      setSlides(d.slides)
      setNotes(d.notes)
      setDirty(false)
    }
  }, [])
  const load = useCallback(
    (keepEdits = false) =>
      apiFetch<DeckView>(`/api/tourism/decks/${id}`)
        .then((d) => adopt(d, keepEdits))
        .catch((err) => setError(err instanceof Error ? err.message : 'Presentazione non caricata')),
    [id, adopt]
  )
  useEffect(() => { load() }, [load])
  // Una generazione avviata altrove (o interrotta dalla pagina chiusa) si aspetta senza ricaricare a mano.
  useEffect(() => {
    if (deck?.status !== 'generating' || busy) return
    const t = setInterval(() => load(false), 4000)
    return () => clearInterval(t)
  }, [deck?.status, busy, load])

  const images = useMemo(() => Object.fromEntries((deck?.assets || []).filter((a) => a.url).map((a) => [a.id, a.url as string])), [deck])
  const credits = useMemo(() => Object.fromEntries((deck?.assets || []).filter((a) => a.credit).map((a) => [a.id, a.credit as string])), [deck])
  const photos = (deck?.assets || []).filter((a) => a.kind === 'photo')
  const todo = countTodo(slides)

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label)
    setError('')
    setNotice('')
    try {
      return await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operazione non riuscita')
      return undefined
    } finally {
      setBusy('')
    }
  }

  const save = () =>
    run('save', async () => {
      if (!deck) return
      const d = await apiFetch<DeckView>(`/api/tourism/decks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: deck.version, slides, notes }) })
      adopt(d)
      setNotice('Salvato')
      return d
    })

  const regenerate = () => {
    if (dirty && !confirm('Le modifiche non salvate andranno perse. Rigenerare con l’agente?')) return
    return run('generate', async () => {
      const d = await apiFetch<DeckView>(`/api/tourism/decks/${id}/generate`, json({ instruction }))
      adopt(d)
      setNotice(d.status === 'failed' ? '' : 'Presentazione rigenerata')
      if (d.status === 'failed') setError(d.error || 'Generazione non riuscita')
    })
  }

  const approve = (value: boolean) =>
    run('approve', async () => {
      let current = deck
      if (dirty) current = (await save()) || null
      if (!current) return
      const d = await apiFetch<DeckView>(`/api/tourism/decks/${id}/approve`, json({ approve: value }))
      adopt(d)
      setNotice(value ? 'Approvata: il link è pronto da condividere' : 'Riportata in revisione')
    })

  const upload = (files: FileList | null) => {
    if (!files?.length) return
    const fd = new FormData()
    for (const f of Array.from(files)) fd.append('files', f)
    return run('upload', async () => {
      adopt(await apiFetch<DeckView>(`/api/tourism/decks/${id}/assets`, { method: 'POST', body: fd }), true)
      setNotice('File aggiunti. Premi “Rigenera con l’agente” per fargli leggere anche questi.')
      if (fileInput.current) fileInput.current.value = ''
    })
  }

  const removeAsset = (assetId: string) =>
    run('asset', async () => {
      const d = await apiFetch<DeckView>(`/api/tourism/decks/${id}/assets/${assetId}`, { method: 'DELETE' })
      adopt(d, true)
      setSlides((cur) => cur.map((sl) => (sl.image_asset_id === assetId ? { ...sl, image_asset_id: null } : sl)))
    })

  // Il PDF è dietro il login: si scarica con il token e si salva come file.
  const downloadPdf = () =>
    run('pdf', async () => {
      const { data } = await createClient().auth.getSession()
      const res = await fetch(`/api/tourism/decks/${id}/pdf`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` }, cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'PDF non generato')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'presentazione.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    })

  const remove = () => {
    if (!confirm('Eliminare questa presentazione e i suoi file?')) return
    return run('delete', async () => {
      await apiFetch(`/api/tourism/decks/${id}`, { method: 'DELETE' })
      router.push('/tourism')
    })
  }

  const link = deck ? `${typeof window === 'undefined' ? '' : window.location.origin}/presentazione/${deck.public_token}` : ''
  const copy = () => navigator.clipboard.writeText(link).then(() => setNotice('Link copiato'), () => setError('Copia non riuscita: seleziona il link a mano'))

  if (!deck) {
    return (
      <div className={s.workspace} style={{ padding: 24 }}>
        {error ? <p className={s.error} role="alert">{error}</p> : <p className={s.muted}>Caricamento…</p>}
        <Link href="/tourism">← Tourism Intelligence</Link>
      </div>
    )
  }
  const approved = deck.status === 'approved'
  const generating = deck.status === 'generating'

  return (
    <div className={s.workspace} style={{ padding: 24 }}>
      <div className={e.head}>
        <div>
          <Link href="/tourism" className={e.help}>← Tourism Intelligence · Presentazioni</Link>
          <h1>{deck.title}</h1>
          <span className={e.status} data-s={deck.status}>{DECK_STATUS_LABELS[deck.status]}</span>{' '}
          {deck.entity_name && <span className={e.help}>Ente: {deck.entity_name}</span>}
        </div>
        <div className={e.bar}>
          <button className={s.secondary} onClick={save} disabled={!dirty || !!busy || generating}>{busy === 'save' ? 'Salvo…' : 'Salva modifiche'}</button>
          {approved ? (
            <>
              <button className={s.secondary} onClick={() => approve(false)} disabled={!!busy}>Riporta in revisione</button>
              <a className={s.primary} href={`/presentazione/${deck.public_token}`} target="_blank" rel="noreferrer">Apri la presentazione ↗</a>
              <button className={s.secondary} onClick={downloadPdf} disabled={!!busy}>{busy === 'pdf' ? <><span className={e.spin} /> Preparo il PDF…</> : 'Scarica il PDF'}</button>
            </>
          ) : (
            <button className={s.primary} onClick={() => approve(true)} disabled={!!busy || generating || todo > 0} title={todo ? `Restano ${todo} [DA VERIFICARE]` : undefined}>
              {busy === 'approve' ? 'Approvo…' : 'Approva'}
            </button>
          )}
        </div>
      </div>

      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {generating && <p className={s.notice} role="status"><span className={e.spin} /> L’agente sta lavorando alla presentazione…</p>}
      {approved && (
        <div className={e.fieldset} style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 12 }}>Link da condividere</strong>
          <div className={e.bar}>
            <input readOnly value={link} style={{ flex: 1, minWidth: 260 }} onFocus={(ev) => ev.currentTarget.select()} />
            <button className={s.secondary} onClick={copy}>Copia</button>
          </div>
          <span className={e.help}>Chi ha il link vede la presentazione senza accedere. Se la modifichi, torna in revisione e il link smette di funzionare finché non la approvi di nuovo.</span>
        </div>
      )}

      <div className={e.layout}>
        <div className={e.col}>
          <div className={e.fieldset}>
            <header><strong>Preventivo e contratto Tourism</strong></header>
            <p className={e.help}>Riprendi destinatario, voci e contratto dalla base Tourism. Conferma il modello economico prima di inviare.</p>
            <Link className={s.primary} href={`/preventivi?tourism_deck=${id}`}>＋ Prepara preventivo e contratto</Link>
            {(deck.quotes || []).map(q => <p key={q.id}>
              <Link href={`/preventivi?edit=${q.id}`}>{q.number} · {q.title}</Link><br />
              <small>{q.status} · {formatMoney(q.total, q.currency)}</small>
            </p>)}
            <small>Il link pubblico della presentazione include il preventivo inviato più recente e il relativo contratto. Le bozze restano interne.</small>
          </div>
          {todo > 0 && <div className={e.warn}><strong>{todo} [DA VERIFICARE] da completare</strong> prima di poter approvare. Sono evidenziati nell’anteprima.</div>}
          {deck.warnings.length > 0 && (
            <div className={e.warn}>
              <strong>Da controllare</strong>
              <ul>{deck.warnings.map((w, i) => <li key={i}>{w.slide !== '*' && <em>{w.slide}: </em>}{w.message}</li>)}</ul>
            </div>
          )}

          <div className={e.fieldset}>
            <header><strong>Agente</strong></header>
            <label className={e.field}>
              Informazioni sulla destinazione (l’agente le legge insieme ai file)
              <textarea rows={6} value={notes} maxLength={30000} onChange={(ev) => { setNotes(ev.target.value); setDirty(true) }} />
            </label>
            <label className={e.field}>
              Istruzione per questa rigenerazione (facoltativa)
              <input value={instruction} maxLength={1000} onChange={(ev) => setInstruction(ev.target.value)} placeholder="Es. più breve, insisti sul mare, tono più formale" />
            </label>
            <div className={e.bar}>
              <button className={s.primary} onClick={regenerate} disabled={!!busy || generating}>{busy === 'generate' ? <><span className={e.spin} /> Sto rigenerando… può richiedere un minuto</> : 'Rigenera con l’agente'}</button>
              <span className={e.help}>Riscrive le slide dal modello: le modifiche manuali non salvate si perdono.</span>
            </div>
          </div>

          <div className={e.fieldset}>
            <header>
              <strong>Documenti e foto ({deck.assets.length})</strong>
              <button className={s.secondary} onClick={() => fileInput.current?.click()} disabled={!!busy}>＋ Aggiungi</button>
            </header>
            <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,.pdf,.docx,.txt,.md,.csv" onChange={(ev) => upload(ev.target.files)} />
            {deck.assets.length === 0 ? (
              <span className={e.help}>Nessun file. Foto e documenti arricchiscono la presentazione.</span>
            ) : (
              <div className={e.assets}>
                {deck.assets.map((a) => (
                  <div className={e.asset} key={a.id}>
                    <div className={e.thumb} style={a.url ? { backgroundImage: `url("${a.url}")` } : undefined}>{a.url ? '' : a.name.split('.').pop()?.toUpperCase()}</div>
                    <div className={e.meta}>
                      <span title={a.name}>{a.name}</span>
                      <button type="button" className={s.textButton} onClick={() => removeAsset(a.id)} disabled={!!busy}>Rimuovi</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {slides.map((slide, i) => (
            <div key={slide.id} onFocusCapture={() => setIndex(i)}>
              <SlideFields
                slide={slide}
                photos={photos}
                onChange={(next) => { setSlides((cur) => cur.map((x, k) => (k === i ? next : x))); setDirty(true); setIndex(i) }}
                actions={<button type="button" className={s.textButton} onClick={() => setIndex(i)}>Mostra</button>}
              />
            </div>
          ))}
          <div className={e.bar}>
            <button className={s.secondary} onClick={remove} disabled={!!busy}>Elimina la presentazione</button>
          </div>
        </div>

        <div className={`${e.col} ${e.sticky}`}>
          <DeckPlayer slides={slides} images={images} credits={credits} destination={deck.destination} index={index} onIndexChange={setIndex} />
          <span className={e.help}>Anteprima in tempo reale: è quello che vede chi riceve il link. In PDF ogni slide è una pagina 16:9.</span>
        </div>
      </div>
    </div>
  )
}
