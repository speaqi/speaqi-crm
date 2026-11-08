'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '@/components/layout/CRMContext'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { apiFetch } from '@/lib/api'
import {
  IDEA_BUDGETS,
  IDEA_STATUSES,
  mergeIdeas,
  type Idea,
  type IdeaBudget,
  type IdeaRow,
  type IdeaStatus,
} from '@/lib/marketing-ideas'

const STATUS_ORDER = new Map<IdeaStatus, number>([
  ['In corso', 0], ['Bloccata', 1], ['Pianificata', 2], ['Da validare', 3], ['Backlog', 4], ['Completata', 5],
])

const STATUS_CLASS: Record<IdeaStatus, string> = {
  Backlog: 'idea-st-backlog',
  'Da validare': 'idea-st-validate',
  Pianificata: 'idea-st-planned',
  'In corso': 'idea-st-running',
  Bloccata: 'idea-st-blocked',
  Completata: 'idea-st-done',
}

type FormState = { title: string; category: string; budget: IdeaBudget; description: string; nextAction: string }
const EMPTY_FORM: FormState = { title: '', category: '', budget: '< €500', description: '', nextAction: '' }

export default function MarketingIdeasPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [rows, setRows] = useState<IdeaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'Tutti' | IdeaStatus>('Tutti')
  const [budgetFilter, setBudgetFilter] = useState<'Tutti' | IdeaBudget>('Tutti')
  const [categoryFilter, setCategoryFilter] = useState('Tutte')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ rows?: IdeaRow[]; unavailable?: boolean }>('/api/marketing/ideas')
      setRows(data.rows || [])
      setUnavailable(Boolean(data.unavailable))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare le idee')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  const ideas = useMemo(() => mergeIdeas(rows), [rows])
  const categories = useMemo(() => Array.from(new Set(ideas.map((idea) => idea.category))).sort((a, b) => a.localeCompare(b, 'it')), [ideas])

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it')
    return ideas
      .filter((idea) => statusFilter === 'Tutti' || idea.status === statusFilter)
      .filter((idea) => budgetFilter === 'Tutti' || idea.budget === budgetFilter)
      .filter((idea) => categoryFilter === 'Tutte' || idea.category === categoryFilter)
      .filter((idea) => !query || `${idea.title} ${idea.description} ${idea.category} ${idea.nextAction} ${idea.notes}`.toLocaleLowerCase('it').includes(query))
      .sort((a, b) => (STATUS_ORDER.get(a.status)! - STATUS_ORDER.get(b.status)!) || b.score - a.score || a.title.localeCompare(b.title, 'it'))
  }, [ideas, search, statusFilter, budgetFilter, categoryFilter])

  const counts = useMemo(() => {
    const by = (status: IdeaStatus) => ideas.filter((idea) => idea.status === status).length
    return { running: by('In corso'), validate: by('Da validare'), planned: by('Pianificata'), done: by('Completata') }
  }, [ideas])

  async function save(idea: Idea, patch: Record<string, unknown>) {
    // Solo la riga di questa idea: se il salvataggio fallisce si torna indietro per lei,
    // senza cancellare le modifiche riuscite sulle altre né le idee appena scritte.
    const previousRow = rows.find((row) => row.idea_key === idea.key)
    // Subito a schermo, poi si conferma. Lo schermo resta quello dell'ultima azione:
    // la risposta del server non lo riscrive, così una risposta vecchia non copre una nuova.
    setRows((current) => {
      const draft = {
        status: idea.status, owner: idea.owner, deadline: idea.deadline || null, progress: idea.progress, notes: idea.notes,
      } as Partial<IdeaRow>
      const next = { ...draft, ...patch } as Partial<IdeaRow>
      if (next.status === 'Completata' && patch.progress === undefined) next.progress = 100
      const exists = current.some((row) => row.idea_key === idea.key)
      return exists
        ? current.map((row) => (row.idea_key === idea.key ? { ...row, ...next } : row))
        : [...current, { idea_key: idea.key, ...next } as IdeaRow]
    })
    try {
      await apiFetch('/api/marketing/ideas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: idea.key, ...patch }),
      })
    } catch (saveError) {
      setRows((current) =>
        previousRow
          ? current.map((row) => (row.idea_key === idea.key ? previousRow : row))
          : current.filter((row) => row.idea_key !== idea.key)
      )
      showToast(saveError instanceof Error ? saveError.message : 'Non salvato')
    }
  }

  async function addIdea(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const data = await apiFetch<{ row: IdeaRow }>('/api/marketing/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setRows((current) => [...current, data.row])
      setOpenKey(data.row.idea_key)
      setForm(EMPTY_FORM)
      setShowForm(false)
      showToast('Idea aggiunta')
    } catch (addError) {
      showToast(addError instanceof Error ? addError.message : 'Idea non salvata')
    } finally {
      setSaving(false)
    }
  }

  async function removeIdea(idea: Idea) {
    if (!window.confirm(`Togliere «${idea.title}»?`)) return
    try {
      await apiFetch(`/api/marketing/ideas?key=${encodeURIComponent(idea.key)}`, { method: 'DELETE' })
      setRows((current) => current.filter((row) => row.idea_key !== idea.key))
      setOpenKey(null)
    } catch (removeError) {
      showToast(removeError instanceof Error ? removeError.message : 'Idea non tolta')
    }
  }

  if (!isAdmin) {
    return (
      <div className="dash-content marketing-page">
        <MarketingNav />
        <div className="dash-card">Le idee per vendere le guide sono un piano interno, solo del titolare.</div>
      </div>
    )
  }

  return (
    <div className="dash-content marketing-page">
      <MarketingNav />

      <div className="marketing-header">
        <div>
          <div className="marketing-kicker">Marketing · Guide B2B</div>
          <h1>Come portiamo le guide ai partner</h1>
          <p>
            Idee per far vendere le guide a hotel, B&amp;B, tour operator, trasporti, agenzie ed eventi. Ogni idea ha la prossima
            azione e usa strumenti che il CRM e Speaqi hanno già: vetrina e QR del partner, codici prepagati, pass territorio,
            classifica di Tourism Intelligence.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? 'Chiudi' : '+ Nuova idea'}
        </button>
      </div>

      {unavailable && (
        <div className="inline-error">
          La tabella delle idee non c’è ancora (migration <code>marketing_ideas</code> da applicare): le idee si vedono, ma stato e note non si salvano.
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}

      {showForm && (
        <form className="dash-card ideas-form" onSubmit={addIdea}>
          <input className="ideas-input" placeholder="Titolo dell’idea" value={form.title} maxLength={120} required
            onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <div className="ideas-form-row">
            <input className="ideas-input" placeholder="Categoria (es. Ospitalità)" value={form.category} maxLength={40}
              onChange={(event) => setForm({ ...form, category: event.target.value })} />
            <select className="ideas-input" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value as IdeaBudget })}>
              {IDEA_BUDGETS.map((budget) => <option key={budget}>{budget}</option>)}
            </select>
          </div>
          <textarea className="ideas-input" rows={3} maxLength={1500} placeholder="Cosa succede, concretamente, e perché dovrebbe funzionare" value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <input className="ideas-input" placeholder="Prossima azione" value={form.nextAction} maxLength={500}
            onChange={(event) => setForm({ ...form, nextAction: event.target.value })} />
          <div><button className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Salvo…' : 'Aggiungi'}</button></div>
        </form>
      )}

      <div className="ideas-stats">
        <div><strong>{counts.running}</strong><span>In corso</span></div>
        <div><strong>{counts.planned}</strong><span>Pianificate</span></div>
        <div><strong>{counts.validate}</strong><span>Da validare</span></div>
        <div><strong>{counts.done}</strong><span>Completate</span></div>
        <div><strong>{ideas.length}</strong><span>Idee in tutto</span></div>
      </div>

      <div className="dash-card ideas-filters">
        <input className="ideas-input" placeholder="Cerca idea, canale o prossima azione…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="ideas-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option>Tutti</option>
          {IDEA_STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
        <select className="ideas-input" value={budgetFilter} onChange={(event) => setBudgetFilter(event.target.value as typeof budgetFilter)}>
          <option>Tutti</option>
          {IDEA_BUDGETS.map((budget) => <option key={budget}>{budget}</option>)}
        </select>
        <select className="ideas-input" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option>Tutte</option>
          {categories.map((category) => <option key={category}>{category}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="dash-card">Caricamento idee…</div>
      ) : visible.length === 0 ? (
        <div className="marketing-empty"><strong>Nessuna idea con questi filtri.</strong></div>
      ) : (
        <section className="ideas-list">
          {visible.map((idea) => {
            const open = openKey === idea.key
            return (
              <article key={idea.key} className={`idea-card ${open ? 'open' : ''}`}>
                <div className="idea-head">
                  <button type="button" className="idea-title" onClick={() => setOpenKey(open ? null : idea.key)} aria-expanded={open}>
                    <span className="idea-score" title="Punteggio ICE: impatto × confidenza × facilità">{idea.score}</span>
                    <span>
                      <strong>{idea.title}</strong>
                      <small>{idea.category} · {idea.budget}{idea.custom ? ' · scritta a mano' : ''}</small>
                    </span>
                  </button>
                  <select className={`idea-status ${STATUS_CLASS[idea.status]}`} value={idea.status} aria-label={`Stato di ${idea.title}`}
                    onChange={(event) => void save(idea, { status: event.target.value })}>
                    {IDEA_STATUSES.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </div>
                <p className="idea-desc">{idea.description}</p>
                <p className="idea-next"><b>Prossima azione:</b> {idea.nextAction}</p>
                {open && (
                  <div className="idea-edit">
                    <label>Responsabile
                      <input className="ideas-input" defaultValue={idea.owner} maxLength={80} placeholder="Chi se ne occupa"
                        onBlur={(event) => { if (event.target.value.trim() !== idea.owner) void save(idea, { owner: event.target.value }) }} />
                    </label>
                    <label>Scadenza
                      <input className="ideas-input" type="date" defaultValue={idea.deadline}
                        onBlur={(event) => { if (event.target.value !== idea.deadline) void save(idea, { deadline: event.target.value }) }} />
                    </label>
                    <ProgressSlider value={idea.progress} onCommit={(progress) => void save(idea, { progress })} />
                    <label className="idea-notes">Note
                      <textarea className="ideas-input" rows={3} defaultValue={idea.notes} maxLength={4000} placeholder="Cosa è successo, cosa manca…"
                        onBlur={(event) => { if (event.target.value !== idea.notes) void save(idea, { notes: event.target.value }) }} />
                    </label>
                    {idea.custom && (
                      <div><button className="btn btn-ghost btn-sm" onClick={() => void removeIdea(idea)}>Togli l’idea</button></div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

/** Cursore dell'avanzamento: segue il valore salvato (anche quando «Completata» lo porta a 100) e salva al rilascio. */
function ProgressSlider({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <label>Avanzamento: {draft}%
      <input
        type="range" min={0} max={100} step={5} value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={(event) => {
          // Solo i tasti che muovono il cursore: Tab o un altro tasto non devono salvare niente.
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit()
        }}
        onBlur={commit}
      />
    </label>
  )
}
