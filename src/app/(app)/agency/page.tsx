'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { apiFetch } from '@/lib/api'
import { AGENCY_TEMPLATE, agencyBase, agencyHtml, agencyIssues, normalizeAgencyTemplate, type AgencyBrief, type AgencyDocument } from '@/lib/agency-deck'
import type { DeckSlide } from '@/lib/tourism-deck'
import AgencyPlayer from '@/components/agency/AgencyPlayer'
import SlideFields from '@/components/tourism/deck/SlideFields'
import s from './page.module.css'

const empty: AgencyBrief = { client: '', text: '', commercial: '', contact: '' }
type Draft = AgencyDocument & { id: string; updated: string }
type Archive = { template: DeckSlide[]; drafts: Draft[] }
const newId = () => crypto.randomUUID()
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Operazione non completata'
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function AgencyPage() {
  const [archive, setArchive] = useState<Archive>({ template: structuredClone(AGENCY_TEMPLATE), drafts: [] })
  const [storageKey, setStorageKey] = useState('')
  const [brief, setBrief] = useState<AgencyBrief>(empty)
  const [slides, setSlides] = useState<DeckSlide[]>(agencyBase(empty))
  const [warnings, setWarnings] = useState<string[]>([])
  const [draftId, setDraftId] = useState('')
  const [index, setIndex] = useState(0)
  const [templateMode, setTemplateMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [ready, setReady] = useState(false)
  const importer = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    createClient().auth.getUser().then(({ data }) => {
      if (!active || !data.user) return
      const key = `speaqi-agency-v1:${data.user.id}`
      setStorageKey(key)
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const saved = JSON.parse(raw)
          const template = normalizeAgencyTemplate(saved.template)
          const drafts = (Array.isArray(saved.drafts) ? saved.drafts : []).slice(0, 100).map((d: Draft) => ({ ...d, slides: normalizeAgencyTemplate(d.slides) }))
          setArchive({ template, drafts }); setSlides(agencyBase(empty, template))
        }
      } catch { setMessage('Archivio del browser non leggibile. Esporta una copia prima di salvare altre modifiche.'); return }
      setReady(true)
    }).catch(e => { if (active) setMessage(errorText(e)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function persist(next: Archive) {
    if (!storageKey || !ready) throw new Error('Archivio del browser non disponibile')
    localStorage.setItem(storageKey, JSON.stringify(next)); setArchive(next)
  }
  function changed() { setDirty(true); setReviewed(false) }
  function save() {
    try {
      if (templateMode) {
        persist({ ...archive, template: normalizeAgencyTemplate(slides) }); setMessage('Modello Agency salvato in questo browser.')
      } else {
        if (!brief.client.trim()) throw new Error('Inserisci il nome del cliente')
        const id = draftId || newId()
        const draft: Draft = { format: 'speaqi-agency-v1', id, brief, slides, warnings, updated: new Date().toISOString() }
        persist({ ...archive, drafts: [draft, ...archive.drafts.filter(d => d.id !== id)].slice(0, 100) })
        setDraftId(id); setMessage('Bozza salvata in questo browser. Puoi anche esportare una copia JSON.')
      }
      setDirty(false)
    } catch (e) { setMessage(errorText(e)) }
  }
  function maySwitch() { return !dirty || window.confirm('Ci sono modifiche non salvate. Vuoi lasciarle e continuare?') }
  function open(draft?: Draft, model = false) {
    if (!maySwitch()) return
    setTemplateMode(model); setIndex(0); setReviewed(false); setDirty(false); setMessage('')
    setDraftId(draft?.id || ''); setBrief(draft?.brief || empty); setWarnings(draft?.warnings || [])
    setSlides(structuredClone(draft?.slides || (model ? archive.template : agencyBase(empty, archive.template))))
  }
  async function generate() {
    setBusy(true); setMessage('L’agente sta preparando le slide…')
    try {
      const result = await apiFetch<{ slides: DeckSlide[]; warnings: string[] }>('/api/agency/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief, template: archive.template }),
      })
      const generated = normalizeAgencyTemplate(result.slides)
      setSlides(generated); setWarnings(result.warnings); setIndex(0); setReviewed(false); setDirty(true)
      const id = draftId || newId()
      const draft: Draft = { format: 'speaqi-agency-v1', id, brief, slides: generated, warnings: result.warnings, updated: new Date().toISOString() }
      try { persist({ ...archive, drafts: [draft, ...archive.drafts.filter(d => d.id !== id)].slice(0, 100) }); setDraftId(id); setDirty(false); setMessage('Slide generate e bozza salvata. Rivedi i testi e i dati da completare.') }
      catch { setMessage('Slide generate. Salvataggio nel browser non riuscito: scarica subito la copia JSON.'); }
    } catch (e) { setMessage(errorText(e)) }
    finally { setBusy(false) }
  }
  async function importDocument(file?: File) {
    if (!file || !maySwitch()) return
    try {
      if (file.size > 100000) throw new Error('File troppo grande')
      const data = JSON.parse(await file.text())
      if (data.format !== 'speaqi-agency-v1' || !data.brief || typeof data.brief.client !== 'string' || typeof data.brief.text !== 'string' || typeof data.brief.commercial !== 'string' || typeof data.brief.contact !== 'string') throw new Error('Scegli un file JSON esportato da Speaqi Agency')
      setSlides(normalizeAgencyTemplate(data.slides)); setBrief(data.brief); setDraftId(''); setWarnings(Array.isArray(data.warnings) ? data.warnings.filter((w: unknown) => typeof w === 'string') : [])
      setIndex(0); setTemplateMode(false); setReviewed(false); setDirty(true); setMessage('Bozza importata. Salvala per conservarla in questo browser.')
    } catch(e) { setMessage(errorText(e)) }
  }
  async function exportHtml(final: boolean) {
    try {
      let html = agencyHtml(brief.client || 'Bozza', slides)
      // Embed existing brand assets so an exported deck retains its fonts offline.
      // Assets are fetched as blobs below; no client information is sent externally.
      const asset = async (path: string) => {
        const response = await fetch(path); if (!response.ok) throw new Error('Asset del brand non disponibile')
        const blob = await response.blob()
        return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
      }
      const [title, body, light, dark] = await Promise.all([
        asset('/deck/bricolage-grotesque-latin-800-normal.woff2'), asset('/deck/inter-latin-400-normal.woff2'), asset('/deck/logo.png'), asset('/deck/logo-on-color.png'),
      ])
      html = html.replace('</style>', `@font-face{font-family:'Bricolage Grotesque';font-weight:800;src:url('${title}')}@font-face{font-family:Inter;src:url('${body}')}h1,h2,h3{font-weight:800}header img{height:58px;vertical-align:middle}header .on-dark{display:none}.dark header .on-dark{display:inline}.dark header .on-light{display:none}</style>`)
      html = html.replaceAll('<header>speaqi <span>Agency</span></header>', `<header><img class="on-dark" src="${dark}" alt="Speaqi"><img class="on-light" src="${light}" alt="Speaqi"> Agency</header>`)
      download(`speaqi-agency-${final ? 'presentazione' : 'bozza'}.html`, html, 'text/html;charset=utf-8')
      setMessage('Presentazione scaricata. Apri il file HTML e usa Stampa → Salva come PDF (orizzontale, senza intestazioni).')
    } catch (e) { setMessage(errorText(e)) }
  }
  const issues = agencyIssues(slides)
  const setField = (key: keyof AgencyBrief, value: string) => {
    const next = { ...brief, [key]: value }
    setBrief(next)
    const base = agencyBase(next, archive.template)
    if (key === 'commercial' || key === 'contact' || key === 'client') {
      const id = key === 'commercial' ? 'terms' : key === 'contact' ? 'closing' : 'cover'
      setSlides(slides.map(slide => slide.id === id ? base.find(s => s.id === id)! : slide))
    }
    changed()
  }

  return <div className={s.workspace}>
    <header className={s.hero}><div><span className={s.eyebrow}>Progetti per clienti esterni</span><h1>Speaqi <em>Agency</em></h1><p>Dal brief del cliente a una presentazione con una linea grafica comune.</p></div><div className={s.actions}>
      <button disabled={busy || !ready} onClick={() => open()}>Nuova presentazione</button>
      <button disabled={busy || !ready} onClick={() => open(undefined, true)}>Modello Agency</button>
      <button disabled={busy} onClick={() => importer.current?.click()}>Importa JSON</button>
      <input ref={importer} type="file" accept="application/json,.json" hidden onChange={e => { void importDocument(e.target.files?.[0]); e.target.value = '' }} />
    </div></header>
    <div className={s.notice}>Siti internet ed e-commerce per clienti esterni. Archivio di questo browser: usa la copia JSON per trasferire le bozze o conservarne un backup.</div>
    {message && <p className={s.message} role="status">{message}</p>}
    <div className={s.layout}>
      <aside className={s.panel}><h2>{templateMode ? 'La base comune' : 'Informazioni sul cliente'}</h2>
        {templateMode ? <p>I testi dell’agenzia, il percorso, le condizioni e la chiusura restano quelli del modello. L’agente personalizza copertina, obiettivo, proposta e perimetro. Usa {'{{cliente}}'}, {'{{condizioni}}'} e {'{{contatto}}'} come segnaposto. Il modello salvato vale per le prossime presentazioni.</p> : <>
          <label>Cliente<input maxLength={160} value={brief.client} disabled={busy} onChange={e => setField('client', e.target.value)} placeholder="Nome dell’azienda o del potenziale cliente" /></label>
          <label>Testo sul potenziale cliente<textarea rows={10} maxLength={18000} value={brief.text} disabled={busy} onChange={e => setField('text', e.target.value)} placeholder="Attività, pubblico, situazione attuale, obiettivo, esigenze, materiali e funzioni richieste…" /></label>
          <label>Investimento, tempi e condizioni confermati<textarea rows={4} maxLength={320} value={brief.commercial} disabled={busy} onChange={e => setField('commercial', e.target.value)} placeholder="Solo condizioni già definite. Se mancano, resteranno da verificare." /></label>
          <label>Contatto e prossimo passo<textarea rows={2} maxLength={280} value={brief.contact} disabled={busy} onChange={e => setField('contact', e.target.value)} placeholder="Referente, recapito e azione da concordare" /></label>
          <button className={s.primary} disabled={busy || !ready || !brief.client.trim() || brief.text.trim().length < 20} onClick={() => void generate()}>{busy ? 'Creazione delle slide…' : 'Crea presentazione con AI'}</button>
          <p className={s.small}>I dati del brief vengono elaborati dal servizio AI configurato nel CRM. Rivedi sempre la bozza prima di usarla.</p>
        </>}
        <h2 className={s.archiveTitle}>Bozze in questo browser</h2>
        {!archive.drafts.length && <p>Nessuna bozza salvata.</p>}
        {archive.drafts.map(d => <button className={s.draft} key={d.id} disabled={busy} onClick={() => open(d)}><strong>{d.brief.client}</strong><span>{new Date(d.updated).toLocaleDateString('it-IT')}</span></button>)}
      </aside>
      <main className={s.main}>
        <div className={s.toolbar}><strong>{templateMode ? 'Modello grafico Agency' : brief.client || 'Anteprima della base'}</strong><span>{slides.length} slide{dirty ? ' · Modifiche da salvare' : ''}</span></div>
        <AgencyPlayer slides={slides} client={brief.client || 'Modello'} index={index} />
        <div className={s.slideTabs} aria-label="Seleziona slide">{slides.map((slide, i) => <button key={slide.id} aria-pressed={index === i} onClick={() => setIndex(i)}>{i + 1}. {slide.id}</button>)}</div>
        <div className={s.panel}><fieldset disabled={busy} className={s.fieldset}><SlideFields slide={slides[index]} onChange={next => { setSlides(slides.map((slide, i) => i === index ? next : slide)); changed() }} /></fieldset></div>
        {!templateMode && <div className={s.panel}><h2>Revisione prima della consegna</h2>
          {issues.length > 0 ? <ul>{issues.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p>I campi richiesti sono compilati e i testi rispettano i limiti di lunghezza.</p>}
          {warnings.length > 0 && <details open><summary>Segnalazioni dell’agente ({warnings.length})</summary><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          <label className={s.check}><input type="checkbox" checked={reviewed} disabled={busy || issues.length > 0} onChange={e => setReviewed(e.target.checked)} />Ho rivisto tutte le slide e verificato fatti, importi, condizioni e segnalazioni.</label>
        </div>}
        <div className={s.actions}>
          <button className={s.primary} disabled={busy || !ready} onClick={save}>{templateMode ? 'Salva modello' : 'Salva bozza'}</button>
          {!templateMode && <><button disabled={busy} onClick={() => download('speaqi-agency-bozza.json', JSON.stringify({ format: 'speaqi-agency-v1', brief, slides, warnings }, null, 2), 'application/json')}>Copia JSON</button>
            <button disabled={busy} onClick={() => void exportHtml(false)}>Scarica bozza HTML</button>
            <button disabled={busy || !reviewed || issues.length > 0} onClick={() => void exportHtml(true)}>Scarica presentazione per PDF</button></>}
        </div>
      </main>
    </div>
  </div>
}
