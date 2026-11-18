'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { TOURISM_TYPES, KIND_LABELS, type TourismEntity } from '@/lib/tourism'
import s from './tourism.module.css'
import TourismDecks from './deck/TourismDecks'
import DeckWizard from './deck/DeckWizard'

type Row = TourismEntity & { crm?: { contact_id: string }[] }
type CountryOption = { country_code: string }

const PAGE_SIZE = 50
const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['it'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}
const inContacts = (r: Row) => Boolean(r.crm?.length)

/**
 * Tourism Intelligence ridotta a due gesti: portare un ente nei contatti quando è
 * definitivo e creare la sua presentazione. Un elenco, due pulsanti per riga.
 */
export default function TourismWorkspace() {
  const router = useRouter()
  const [tab, setTab] = useState<'enti' | 'presentazioni'>('enti')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [type, setType] = useState('')
  const [countries, setCountries] = useState<string[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [deckFor, setDeckFor] = useState<Row | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    apiFetch<{ by_country: CountryOption[] }>('/api/tourism?view=overview')
      .then((r) => setCountries(r.by_country.map((c) => c.country_code).filter(Boolean).sort((a, b) => countryName(a).localeCompare(countryName(b), 'it'))))
      .catch(() => {})
    // Il link «?entity=<id>» (Direttore, Telegram) porta direttamente all'ente.
    const entity = new URLSearchParams(window.location.search).get('entity')
    if (entity && /^[0-9a-f-]{36}$/i.test(entity)) {
      apiFetch<{ entity: { name: string } }>(`/api/tourism?id=${entity}`)
        .then((r) => setQuery(r.entity.name))
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (tab !== 'enti') return
    let live = true
    setLoading(true)
    const params = new URLSearchParams({
      kind: 'organization',
      availability: 'active',
      sort: 'name',
      size: String(PAGE_SIZE),
      page: String(page),
      q: search,
      country,
      type
    })
    apiFetch<{ entities: Row[]; total: number }>(`/api/tourism?${params}`)
      .then((r) => {
        if (!live) return
        setRows(r.entities)
        setTotal(r.total)
        setSelected([])
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [tab, search, country, type, page, reload])

  const activate = async (r: Row) => {
    const email = (emails[r.id] || '').trim()
    return apiFetch<{ contact_created: boolean; crm_error_text: string | null }>('/api/tourism', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate', id: r.id, version: r.version, email: r.email ? '' : email, website: '' })
    })
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operazione fallita')
    } finally {
      setBusy(false)
    }
  }
  const addOne = (r: Row) =>
    run(async () => {
      const res = await activate(r)
      setReload((n) => n + 1)
      if (res.crm_error_text) setError(`${r.name}: confermato, ma non è entrato nei contatti — ${res.crm_error_text}.`)
      else setNotice(`${r.name}: aggiunto ai contatti`)
    })
  const addSelected = () =>
    run(async () => {
      const chosen = rows.filter((r) => selected.includes(r.id) && !inContacts(r))
      let ok = 0
      let first = ''
      for (const r of chosen) {
        try {
          const res = await activate(r)
          if (res.crm_error_text) first ||= `${r.name}: ${res.crm_error_text}`
          else ok++
        } catch (e) {
          first ||= `${r.name}: ${e instanceof Error ? e.message : 'errore'}`
        }
      }
      setReload((n) => n + 1)
      setNotice(`${ok} aggiunti ai contatti${chosen.length - ok ? `, ${chosen.length - ok} no (${first})` : ''}`)
    })

  const pending = rows.filter((r) => selected.includes(r.id) && !inContacts(r)).length

  return (
    <div className={s.workspace} data-tourism-workspace>
      <header className={s.heading}>
        <div>
          <h1>
            Tourism Intelligence<span>.</span>
          </h1>
          <p>Porta l’ente nei contatti, poi crea la sua presentazione.</p>
        </div>
      </header>
      <nav className={s.tabs} aria-label="Tourism Intelligence">
        <button className={tab === 'enti' ? s.activeTab : ''} onClick={() => setTab('enti')}>
          Enti{tab === 'enti' && total ? <span>{new Intl.NumberFormat('it-IT').format(total)}</span> : null}
        </button>
        <button className={tab === 'presentazioni' ? s.activeTab : ''} onClick={() => setTab('presentazioni')}>
          Presentazioni
        </button>
      </nav>
      {error && (
        <div className={s.error} role="alert">
          {error}
          <button onClick={() => setError('')}>Chiudi</button>
        </div>
      )}
      {notice && (
        <div className={s.notice} role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Chiudi notifica">×</button>
        </div>
      )}

      {tab === 'presentazioni' && <TourismDecks />}

      {tab === 'enti' && (
        <section className={s.panel}>
          <div className={s.filters}>
            <label className={s.search}>
              <input aria-label="Cerca" placeholder="Cerca per nome o sito…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <select aria-label="Paese" value={country} onChange={(e) => { setCountry(e.target.value); setPage(0) }}>
              <option value="">Tutti i paesi</option>
              {countries.map((c) => (
                <option key={c} value={c}>{countryName(c)}</option>
              ))}
            </select>
            <select aria-label="Categoria" value={type} onChange={(e) => { setType(e.target.value); setPage(0) }}>
              <option value="">Tutte le categorie</option>
              {Object.entries(TOURISM_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button className={s.primary} disabled={!pending || busy} onClick={addSelected}>
              Aggiungi {pending || ''} ai contatti
            </button>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Seleziona tutta la pagina"
                      checked={rows.length > 0 && selected.length === rows.length}
                      onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                    />
                  </th>
                  <th>Organizzazione</th>
                  <th>Paese</th>
                  <th>Categoria</th>
                  <th>Sito</th>
                  <th>Email</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const linked = inContacts(r)
                  return (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Seleziona ${r.name}`}
                          checked={selected.includes(r.id)}
                          onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id)))}
                        />
                      </td>
                      <td><strong>{r.name}</strong></td>
                      <td>{r.country_code ? countryName(r.country_code) : '—'}</td>
                      <td>{r.type_code ? TOURISM_TYPES[r.type_code] : KIND_LABELS[r.kind]}</td>
                      <td>
                        {r.website ? (
                          <a href={r.website} target="_blank" rel="noopener noreferrer">Apri ↗</a>
                        ) : '—'}
                      </td>
                      <td>
                        {r.email ? r.email : linked ? '—' : (
                          <input
                            type="email"
                            aria-label={`Email di ${r.name}`}
                            placeholder="info@esempio.it"
                            value={emails[r.id] || ''}
                            onChange={(e) => setEmails((m) => ({ ...m, [r.id]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td>
                        <div className={s.actions}>
                          {linked ? (
                            <Link className={s.secondary} href={`/contacts/${r.crm![0].contact_id}`}>Nei contatti ↗</Link>
                          ) : (
                            <button className={s.primary} disabled={busy} onClick={() => addOne(r)}>Aggiungi ai contatti</button>
                          )}
                          <button className={s.secondary} onClick={() => setDeckFor(r)}>Presentazione</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {loading && <p className={s.muted} role="status">Caricamento…</p>}
          {!loading && !rows.length && <p className={s.muted}>Nessun ente trovato.</p>}
          <footer className={s.pagination}>
            <span>{total ? `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} di ${total}` : '0 risultati'}</span>
            <button className={s.secondary} disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>← Precedente</button>
            <button className={s.secondary} disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((p) => p + 1)}>Successiva →</button>
          </footer>
        </section>
      )}

      {deckFor && (
        <DeckWizard
          entity={deckFor}
          onClose={() => setDeckFor(null)}
          onCreated={(id) => router.push(`/tourism/presentazioni/${id}`)}
        />
      )}
    </div>
  )
}
