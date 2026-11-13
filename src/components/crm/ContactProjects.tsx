'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type Project = { id: string; name: string; status: string; price: number | null; billing_interval: string; terms: string }
const statuses: Record<string,string> = { demo: 'Demo', trial: 'Trial', active: 'Attivo', suspended: 'Sospeso', archived: 'Archiviato' }
const intervals: Record<string,string> = { monthly: 'al mese', yearly: 'all’anno', custom: 'condizioni personalizzate' }
const blank = { name: '', status: 'demo', price: '', billing_interval: 'yearly', terms: '' }
export function ContactProjects({ contactId, tasks, documents, onChanged }: { contactId: string; tasks: Array<{ id: string; type: string; note: string | null; project_id: string | null }>; documents: Array<{ id: string; kind: 'quote' | 'invoice'; name: string; project_id: string | null }>; onChanged: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { const r = await apiFetch<{projects: Project[]}>(`/api/contacts/${contactId}/projects`); setProjects(r.projects); setError('') } catch(e) { setError(e instanceof Error ? e.message : 'Impossibile caricare i progetti') } }, [contactId])
  useEffect(() => { void load() }, [load])
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try { await apiFetch(`/api/contacts/${contactId}/projects`, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, id: editing, price: form.price === '' ? null : Number(form.price) }) }); setOpen(false); setEditing(null); setForm(blank); await load() }
    catch(e) { setError(e instanceof Error ? e.message : 'Impossibile salvare') } finally { setBusy(false) }
  }
  async function linkTask(taskId: string, projectId: string) {
    setBusy(true)
    try { await apiFetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId || null }) }); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossibile collegare l’attività') } finally { setBusy(false) }
  }
  async function linkDocument(document: typeof documents[number], projectId: string) {
    setBusy(true)
    try { await apiFetch(`/api/contacts/${contactId}/project-documents`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: document.id, kind: document.kind, project_id: projectId || null }) }); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossibile collegare il documento') } finally { setBusy(false) }
  }
  return <section className="sc-section"><h2>Progetti <span className="sc-count">{projects.length}</span></h2><p className="cc-muted">Lo stato e le condizioni sono registrati nel CRM; non modificano automaticamente il progetto sulla piattaforma Speaqi.</p>
    {error && <p className="cc-error">{error}</p>}
    {!projects.length && !error && <p className="cc-muted">Nessun progetto collegato. Puoi seguire il contatto anche senza progetto.</p>}
    <ul className="sc-list">{projects.map((p) => <li key={p.id}><strong>{p.name}</strong><div className="cc-muted">{statuses[p.status]} · {p.price == null ? 'Costo da definire' : `${Number(p.price).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} ${intervals[p.billing_interval]}`}{p.terms ? ` · ${p.terms}` : ''}</div><button type="button" className="sc-link" onClick={() => { setEditing(p.id); setForm({ name: p.name, status: p.status, price: p.price == null ? '' : String(p.price), billing_interval: p.billing_interval, terms: p.terms }); setOpen(true) }}>Modifica</button></li>)}</ul>
    {projects.length > 0 && tasks.length > 0 && <><h3>Collega le attività</h3>{tasks.map(t => <label key={t.id} style={{ display: 'block', marginBottom: 8 }}>{t.note || t.type} <select className="fi" disabled={busy} value={t.project_id || ''} onChange={e => void linkTask(t.id, e.target.value)}><option value="">Nessun progetto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</>}
    {projects.length > 0 && documents.length > 0 && <><h3>Collega contratti e fatture</h3>{documents.map(d => <label key={`${d.kind}:${d.id}`} style={{ display: 'block', marginBottom: 8 }}>{d.kind === 'quote' ? 'Preventivo' : 'Fattura'} {d.name} <select className="fi" disabled={busy} value={d.project_id || ''} onChange={e => void linkDocument(d, e.target.value)}><option value="">Nessun progetto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</>}
    {!open ? <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setForm(blank); setOpen(true) }}>+ Aggiungi progetto</button> : <form onSubmit={save} style={{ display: 'grid', gap: 8 }}>
      <label>Nome progetto<input className="fi" required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>Stato progetto<select className="fi" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{Object.entries(statuses).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Costo (€)<input className="fi" type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></label>
      <label>Frequenza<select className="fi" value={form.billing_interval} onChange={e => setForm({ ...form, billing_interval: e.target.value })}>{Object.entries(intervals).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Condizioni<textarea className="fi" maxLength={4000} value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} /></label>
      <div><button className="btn btn-primary btn-sm" disabled={busy}>Salva</button> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annulla</button></div>
    </form>}
  </section>
}
