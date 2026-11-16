'use client'

import { FormEvent, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/components/layout/CRMContext'
import styles from './page.module.css'
import industries from '@/lib/leadocean-industries.json'
import { LEADOCEAN_CATEGORY_GROUPS } from '@/lib/leadocean-categories'

type Kind = 'companies' | 'people'
type Result = { name: string; domain?: string; description?: string; industry?: string; city?: string; country?: string; employees?: number | null; linkedin?: string; headline?: string; company?: string; title?: string; hasEmail?: boolean; emailStatus?: string }
type ResponseData = { items?: Result[]; total: number | null; nextCursor?: string | null; depthCapped?: boolean; unsupportedFilters?: string[]; notice?: string | null }
type Filters = { query: string; country: string; industry: string; title: string; domain: string; companyCountry: string; categories: string[] }
const empty: Filters = { query: '', country: '', industry: '', title: '', domain: '', companyCountry: '', categories: [] }
function safeUrl(value?: string, domain = false) {
  if (!value) return null
  try { const url = new URL(domain ? `https://${value}` : value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null }
}
function format(value: number) { return value.toLocaleString('it-IT') }

export default function LeadOceanPage() {
  const { isAdmin } = useCRMContext()
  const [kind, setKind] = useState<Kind>('companies')
  const [filters, setFilters] = useState<Filters>(empty)
  const [active, setActive] = useState<{ kind: Kind; filters: Filters } | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [items, setItems] = useState<Result[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [depthCapped, setDepthCapped] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (isAdmin) apiFetch<{ configured: boolean }>('/api/leadocean').then(x => setConfigured(x.configured)).catch(e => setError(e.message)) }, [isAdmin])
  function update(field: Exclude<keyof Filters, 'categories'>, value: string) { setFilters(f => ({ ...f, [field]: value })) }
  function toggleCategory(id: string) { setFilters(f => ({ ...f, categories: f.categories.includes(id) ? f.categories.filter(item => item !== id) : [...f.categories, id] })) }
  function resetResults() { setItems([]); setTotal(null); setCursor(null); setDepthCapped(false); setWarnings([]); setSearched(false); setActive(null); setError('') }
  async function run(action: 'count' | 'search', next = false) {
    const selected = next && active ? active : { kind, filters }
    setBusy(next ? 'next' : action); setError('')
    try {
      const data = await apiFetch<ResponseData>('/api/leadocean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...selected.filters, kind: selected.kind, action, cursor: next ? cursor : undefined }) })
      setWarnings([...(data.unsupportedFilters?.length ? [`Filtri non applicati da LeadOcean: ${data.unsupportedFilters.join(', ')}. I risultati potrebbero essere più ampi.`] : []), ...(data.notice ? [data.notice] : [])])
      setTotal(data.total)
      if (action === 'search') { setItems(data.items || []); setCursor(data.nextCursor || null); setDepthCapped(Boolean(data.depthCapped)); setSearched(true); setActive(selected) }
      else { setItems([]); setCursor(null); setSearched(false); setActive(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Ricerca non riuscita.') }
    finally { setBusy('') }
  }
  function submit(e: FormEvent) { e.preventDefault(); void run('search') }
  if (!isAdmin) return <div className={styles.blocked}>Questa sezione è riservata agli amministratori.</div>
  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><div className={styles.eyebrow}><span /> LEADOCEAN · EXPLORER</div><h1>Scopri chi c’è<br /><em>oltre l’orizzonte.</em></h1><p>Esplora aziende e professionisti in tutto il mondo. Trova i potenziali clienti e partner giusti per Speaqi.</p></div>
      <div className={styles.heroAside}><span>IL TUO PUNTO DI PARTENZA</span><strong>Un catalogo,<br />molte possibilità.</strong><small>Ricerca per settore, ruolo, azienda e paese.</small></div>
    </header>
    {configured === false && <div className={styles.setup} role="status"><strong>Collegamento da completare</strong><p>La connessione usata dall’assistente non è automaticamente disponibile nel CRM. Per attivare la ricerca live occorre configurare la chiave API LeadOcean sul server.</p></div>}
    <div className={styles.tabs} role="tablist" aria-label="Tipo di catalogo"><button role="tab" disabled={!!busy} aria-selected={kind === 'companies'} onClick={() => { setKind('companies'); resetResults() }}>Aziende <span>↗</span></button><button role="tab" disabled={!!busy} aria-selected={kind === 'people'} onClick={() => { setKind('people'); resetResults() }}>Persone <span>↗</span></button></div>
    <div className={styles.content}>
      <form className={styles.filters} onSubmit={submit}>
        <div className={styles.sectionTitle}><div><span>01 / RICERCA</span><h2>Definisci il tuo pubblico</h2></div><button type="button" className={styles.clear} onClick={() => { setFilters(empty); resetResults() }}>Azzera filtri</button></div>
        <div className={styles.grid}>
          <label className={styles.wide}>{kind === 'companies' ? 'Altra parola chiave aziendale' : 'Nome o parole nel profilo'}<input value={filters.query} onChange={e => update('query', e.target.value)} placeholder={kind === 'companies' ? 'Es. tour operator' : 'Es. tourism, partnership…'} /></label>
          <label>Paese <small>codice ISO</small><input value={filters.country} maxLength={2} onChange={e => update('country', e.target.value.toUpperCase())} placeholder="Es. IT, FR, US" /></label>
          <label>Settore <small>cerca tra 534 categorie</small><input list="leadocean-industries" value={filters.industry} onChange={e => update('industry', e.target.value)} placeholder="Es. Travel Arrangements" /><datalist id="leadocean-industries">{industries.map(x => <option key={x} value={x} />)}</datalist></label>
          {kind === 'people' && <><label>Ruolo<input value={filters.title} onChange={e => update('title', e.target.value)} placeholder="Es. Partnership Manager" /></label><label>Paese sede aziendale <small>codice ISO, consigliato per le categorie</small><input value={filters.companyCountry} maxLength={2} onChange={e => update('companyCountry', e.target.value.toUpperCase())} placeholder="Es. IT, FR, US" /></label><label>Dominio aziendale<input value={filters.domain} onChange={e => update('domain', e.target.value)} placeholder="Es. azienda.com" /></label></>}
        </div>
        <fieldset className={styles.categoryPicker}>
          <legend>CATEGORIE DI ATTIVITÀ {filters.categories.length > 0 && <span>· {filters.categories.length} selezionate</span>}</legend>
          <p>Seleziona una o più attività: trovi aziende che corrispondono ad almeno una categoria{kind === 'people' ? ' e persone che lavorano in queste aziende' : ''}.</p>
          {LEADOCEAN_CATEGORY_GROUPS.map(group => <div className={styles.categoryGroup} key={group.label}><h3>{group.label}</h3><div className={styles.suggestions}>{group.categories.map(category => {
            const selected = filters.categories.includes(category.id)
            return <button key={category.id} type="button" aria-pressed={selected} onClick={() => toggleCategory(category.id)}>{selected ? '✓ ' : '+ '}{category.label}</button>
          })}</div></div>)}
          <p className={styles.categoryHint}>Le categorie usano parole chiave: i risultati vanno verificati. {kind === 'companies' ? 'La parola chiave aziendale si aggiunge alle categorie come alternativa. ' : 'Le parole nel profilo restringono la ricerca. '}Paese e settore restringono ulteriormente i risultati.{kind === 'people' && ' Se le categorie non vengono applicate, specifica anche il paese della sede aziendale.'}</p>
        </fieldset>
        <div className={styles.actions}><button className={styles.primary} type="submit" disabled={!!busy || configured !== true}>{busy === 'search' ? 'Ricerca in corso…' : `Cerca ${kind === 'companies' ? 'aziende' : 'persone'} →`}</button><button className={styles.secondary} type="button" disabled={!!busy || configured !== true} onClick={() => void run('count')}>{busy === 'count' ? 'Conteggio…' : 'Conta i risultati'}</button><p>Il conteggio è gratuito. La ricerca utilizza fino a 25 unità per pagina.</p></div>
      </form>
      <section className={styles.results} aria-live="polite"><div className={styles.sectionTitle}><div><span>02 / RISULTATI</span><h2>{searched ? kind === 'companies' ? 'Aziende trovate' : 'Persone trovate' : 'Il tuo esploratore'}</h2></div>{total !== null && <div className={styles.total}><strong>{format(total)}</strong><small>risultati corrispondenti</small></div>}</div>
        {error && <p className={styles.alert} role="alert">{error}</p>}{warnings.map(w => <p className={styles.alert} key={w}>{w}</p>)}
        {!searched && <div className={styles.empty}><span>⌕</span><strong>Inizia a esplorare</strong><p>Scegli i filtri e conta i risultati, oppure avvia una ricerca per vedere le prime schede.</p><small>Le categorie sono indicative: controlla il profilo e l’azienda prima di usarli.</small></div>}
        {searched && items.length === 0 && <div className={styles.empty}><strong>Nessun risultato in questa pagina</strong><p>Prova a modificare o ampliare i filtri.</p></div>}
        {searched && items.map((item, index) => { const website = safeUrl(item.domain, true), profile = safeUrl(item.linkedin); return <article className={styles.row} key={`${item.name}-${index}`}><div className={styles.avatar}>{(item.name || '?').slice(0, 1).toUpperCase()}</div><div className={styles.rowBody}><div className={styles.rowTop}><h3>{item.name || 'Nome non disponibile'}</h3><span>{[item.city, item.country].filter(Boolean).join(', ') || 'Località non disponibile'}</span></div><p className={styles.subtitle}>{kind === 'companies' ? item.industry || 'Settore non disponibile' : [item.title, item.company].filter(Boolean).join(' · ') || item.headline || 'Ruolo non disponibile'}</p>{item.description && <p className={styles.desc}>{item.description}</p>}<div className={styles.meta}>{item.employees != null && <span>{format(item.employees)} dipendenti</span>}{kind === 'people' && <span>{item.hasEmail ? `Email presente${item.emailStatus ? ` · ${item.emailStatus}` : ''}` : 'Email non indicata'}</span>}{website && <a href={website} target="_blank" rel="noreferrer">{item.domain} ↗</a>}{profile && <a href={profile} target="_blank" rel="noreferrer">LinkedIn ↗</a>}</div></div></article> })}
        {depthCapped && <p className={styles.alert}>Limite di profondità raggiunto: restringi la ricerca per vedere altre schede.</p>}
        {searched && cursor && <button className={styles.more} type="button" onClick={() => void run('search', true)} disabled={!!busy}>{busy === 'next' ? 'Caricamento…' : 'Pagina successiva →'}</button>}
      </section>
    </div>
  </main>
}
