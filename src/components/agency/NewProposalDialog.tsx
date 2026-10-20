'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import type { ServiceCategory } from '@/lib/agency'
import { errorText } from './client'
import s from './agency.module.css'

type ContactLite = { id: string; name: string; company?: string | null; email?: string | null; status?: string | null; contact_scope?: string | null }

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

/**
 * "Nuova proposta": cliente (dal CRM o nuovo), brief, servizi, sito, file. Un clic e
 * l'agente costruisce la prima presentazione. Nessun altro campo obbligatorio.
 */
export default function NewProposalDialog({
  categories,
  contact,
  onClose,
  onCreated
}: {
  categories: (ServiceCategory & { id: string })[]
  contact?: ContactLite | null
  onClose: () => void
  onCreated: (presentationId: string, projectId: string, warnings: string[]) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [picked, setPicked] = useState<ContactLite | null>(contact ?? null)
  const [mode, setMode] = useState<'search' | 'new'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContactLite[]>([])
  const [searching, setSearching] = useState(false)
  const [fresh, setFresh] = useState({ name: '', company: '', email: '', phone: '' })
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [website, setWebsite] = useState('')
  const [services, setServices] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [logo, setLogo] = useState<File | null>(null)
  const [language, setLanguage] = useState<'it' | 'en'>('it')
  const [generate, setGenerate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])

  useEffect(() => {
    if (picked || mode !== 'search' || query.trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      apiFetch<{ contacts: ContactLite[] }>(`/api/contacts?scope=all&limit=15&search=${encodeURIComponent(query.trim())}`)
        .then((r) => setResults(r.contacts || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query, picked, mode])

  const toggle = (slug: string) => setServices((cur) => (cur.includes(slug) ? cur.filter((x) => x !== slug) : [...cur, slug]))

  async function ensureContact(): Promise<ContactLite> {
    if (picked) return picked
    if (!fresh.name.trim() && !fresh.company.trim()) throw new Error('Scegli un cliente del CRM o inserisci almeno nome o azienda')
    // Il cliente nuovo entra nel CRM come ogni altro lead: pipeline, trattativa e follow-up.
    const res = await apiFetch<{ contact: ContactLite }>('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fresh.name.trim() || fresh.company.trim(),
        company: fresh.company.trim() || null,
        email: fresh.email.trim() || null,
        phone: fresh.phone.trim() || null,
        status: 'New',
        contact_scope: 'crm',
        source: 'agency',
        category: 'Speaqi Agency',
        next_followup_at: tomorrow(),
        initial_task_note: `Speaqi Agency: inviare la proposta${title ? ` "${title}"` : ''}`
      })
    })
    setPicked(res.contact)
    return res.contact
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError('')
    try {
      const c = await ensureContact()
      const fd = new FormData()
      fd.set('contact_id', c.id)
      fd.set('title', title)
      fd.set('brief', brief)
      fd.set('website_url', website)
      fd.set('language', language)
      fd.set('generate', generate ? '1' : '0')
      for (const sl of services) fd.append('services', sl)
      for (const f of files) fd.append('files', f)
      if (logo) fd.append('logo', logo)
      const res = await apiFetch<{ project_id: string; presentation_id: string; warnings: string[] }>('/api/agency/projects', { method: 'POST', body: fd })
      onCreated(res.presentation_id, res.project_id, res.warnings || [])
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const label = (c: ContactLite) => [c.company, c.name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')

  return (
    <dialog ref={ref} className={s.dialog} onCancel={(ev) => (busy ? ev.preventDefault() : onClose())} aria-label="Nuova proposta">
      <header>
        <h2>Nuova proposta Speaqi Agency</h2>
        <button type="button" className={s.mini} onClick={onClose} disabled={busy} aria-label="Chiudi">×</button>
      </header>
      <form onSubmit={submit}>
        <div className={s.dialogBody}>
          {error && <p className={s.error} role="alert">{error}</p>}

          <div className={s.step}><b>1</b><h3>Cliente</h3></div>
          {picked ? (
            <div className={s.picked}>
              <div><strong>{label(picked)}</strong>{picked.email && <div className={s.help}>{picked.email}</div>}</div>
              {!contact && <button type="button" className={s.linkBtn} onClick={() => setPicked(null)} disabled={busy}>Cambia</button>}
            </div>
          ) : (
            <>
              <div className={s.chips}>
                <button type="button" className={`${s.chip} ${mode === 'search' ? s.chipOn : ''}`} onClick={() => setMode('search')}>Dal CRM</button>
                <button type="button" className={`${s.chip} ${mode === 'new' ? s.chipOn : ''}`} onClick={() => setMode('new')}>Nuovo cliente</button>
              </div>
              {mode === 'search' ? (
                <>
                  <input autoFocus placeholder="Cerca per nome, azienda o email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Cerca cliente" />
                  {(results.length > 0 || searching) && (
                    <div className={s.results}>
                      {searching && !results.length && <div className={s.result}>Cerco…</div>}
                      {results.map((c) => (
                        <button type="button" key={c.id} className={s.result} onClick={() => setPicked(c)}>
                          <span><strong>{label(c)}</strong>{c.email && <span className={s.help}> · {c.email}</span>}</span>
                          <span className={s.tag}>{c.status || ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {query.trim().length >= 2 && !searching && !results.length && (
                    <p className={s.help}>Nessun contatto trovato. <button type="button" className={s.linkBtn} onClick={() => { setMode('new'); setFresh((f) => ({ ...f, company: query.trim() })) }}>Crealo come nuovo cliente</button></p>
                  )}
                </>
              ) : (
                <div className={s.formGrid}>
                  <label className={s.field}>Azienda o ente<input value={fresh.company} maxLength={200} onChange={(e) => setFresh({ ...fresh, company: e.target.value })} /></label>
                  <label className={s.field}>Referente<input value={fresh.name} maxLength={200} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></label>
                  <label className={s.field}>Email<input type="email" value={fresh.email} maxLength={200} onChange={(e) => setFresh({ ...fresh, email: e.target.value })} /></label>
                  <label className={s.field}>Telefono<input value={fresh.phone} maxLength={60} onChange={(e) => setFresh({ ...fresh, phone: e.target.value })} /></label>
                  <p className={s.help} style={{ gridColumn: '1 / -1' }}>Entra nel CRM come lead in pipeline, con un follow-up per domani.</p>
                </div>
              )}
            </>
          )}

          <div className={s.step}><b>2</b><h3>Cosa proponiamo</h3></div>
          <div className={s.chips} role="group" aria-label="Servizi">
            {categories.filter((c) => c.is_active).map((c) => (
              <button type="button" key={c.slug} className={`${s.chip} ${services.includes(c.slug) ? s.chipOn : ''}`} onClick={() => toggle(c.slug)} title={c.description}>
                {c.name}
              </button>
            ))}
          </div>
          <label className={s.field}>
            Brief
            <textarea rows={7} value={brief} maxLength={40000} onChange={(e) => setBrief(e.target.value)} placeholder="Incolla la mail del cliente, gli appunti della call, cosa vuole ottenere, vincoli, tempi e budget se li conosci. L’agente non inventa ciò che manca: lo segnala." />
          </label>
          <div className={s.formGrid}>
            <label className={s.field}>Titolo della proposta (facoltativo)<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Nuovo sito e posizionamento" /></label>
            <label className={s.field}>Sito del cliente<input value={website} maxLength={2000} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" inputMode="url" /></label>
          </div>

          <div className={s.step}><b>3</b><h3>Materiali (facoltativi)</h3></div>
          <div className={s.formGrid}>
            <label className={s.field}>
              Documenti, presentazioni e foto
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.docx,.pptx,.txt,.md,.csv" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              <span className={s.help}>PDF, Word, PowerPoint, testo (max 8, 20 MB l’uno); foto JPG, PNG, WebP (max 16, 8 MB).</span>
            </label>
            <label className={s.field}>
              Logo del cliente
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo(e.target.files?.[0] || null)} />
              <span className={s.help}>Compare in copertina e nel piede delle slide.</span>
            </label>
          </div>
          <div className={s.row}>
            <label className={s.row} style={{ gap: 6 }}>
              <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} style={{ width: 'auto' }} />
              Genera subito la presentazione con l’AI
            </label>
            <label className={s.row} style={{ gap: 6 }}>
              Lingua
              <select value={language} onChange={(e) => setLanguage(e.target.value as 'it' | 'en')} style={{ width: 'auto' }}>
                <option value="it">Italiano</option>
                <option value="en">Inglese</option>
              </select>
            </label>
          </div>
        </div>
        <footer>
          <button type="button" className={s.ghost} onClick={onClose} disabled={busy}>Annulla</button>
          <button type="submit" className={s.primary} disabled={busy}>
            {busy ? <><span className={s.spin} /> Carico i materiali…</> : generate ? 'Crea e genera la presentazione' : 'Crea l’opportunità'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
