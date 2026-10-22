'use client'

import { useState } from 'react'
import {
  DEFAULT_ACCENT,
  SLIDE_KINDS,
  SLIDE_KIND_INFO,
  THEME_STYLES,
  THEME_STYLE_INFO,
  normalizeHex,
  type AgencySettings,
  type ServiceCategory,
  type ThemeStyle
} from '@/lib/agency'
import AgencyDeck, { type DeckContext } from './AgencySlides'
import { SAMPLE_QUOTE, SAMPLE_SLIDES } from './samples'
import { errorText, post } from './client'
import s from './agency.module.css'

type Category = ServiceCategory & { id: string }

/** Template: stili grafici, galleria dei layout, identità dell'agenzia e categorie di servizio. */
export default function TemplateTab({ settings, categories, onChanged }: { settings: AgencySettings; categories: Category[]; onChanged: () => void }) {
  const [form, setForm] = useState(settings)
  const [style, setStyle] = useState<ThemeStyle>(settings.default_style)
  const [cats, setCats] = useState(categories)
  const [fresh, setFresh] = useState({ name: '', description: '' })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const ctx: DeckContext = {
    theme: { style, accent: normalizeHex(form.default_accent) || DEFAULT_ACCENT, client_logo: false, language: 'it' },
    images: {},
    clientName: 'Cliente di esempio',
    clientLogo: null,
    agencyName: form.name || 'Speaqi Agency',
    agencySignature: form.signature,
    quote: SAMPLE_QUOTE
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy('')
    }
  }

  const saveSettings = () =>
    run('settings', async () => {
      const r = await post<{ settings: AgencySettings }>('/api/agency/settings', { ...form, default_style: style }, 'PUT')
      setForm(r.settings)
      setNotice('Identità salvata: vale per le presentazioni nuove e per i prossimi PDF.')
      onChanged()
    })

  const saveCategory = (c: Partial<Category>) =>
    run(`cat-${c.id || 'new'}`, async () => {
      const r = await post<{ categories: Category[] }>('/api/agency/categories', c)
      setCats(r.categories)
      if (!c.id) setFresh({ name: '', description: '' })
      onChanged()
    })

  return (
    <div className={s.stack}>
      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}

      <div className={s.panel}>
        <header><h2>Sistemi grafici</h2></header>
        <p className={s.help}>Tre stili sullo stesso sistema Speaqi Design (Heuvel Grotesk e Inter, navy, crema e arancio). L’accento si sostituisce con il colore del cliente; il suo logo va in copertina e nel piede.</p>
        <div className={s.styles}>
          {THEME_STYLES.map((st) => (
            <button key={st} type="button" className={`${s.styleCard} ${style === st ? s.styleOn : ''}`} onClick={() => setStyle(st)}>
              <strong>{THEME_STYLE_INFO[st].label}</strong>
              <span>{THEME_STYLE_INFO[st].description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={s.panel}>
        <header><h2>Layout disponibili ({SLIDE_KINDS.length})</h2><span className={s.help}>Anteprima nello stile “{THEME_STYLE_INFO[style].label}”</span></header>
        <p className={s.help}>L’agente sceglie i layout adatti al progetto: nessuna struttura fissa. Puoi aggiungerli e cambiarli a mano nello Studio.</p>
        <div className={s.layoutGrid}>
          {SLIDE_KINDS.map((k) => (
            <div key={k} className={s.layoutCard}>
              <AgencyDeck slides={[SAMPLE_SLIDES[k]]} ctx={ctx} />
              <div>
                <strong>{SLIDE_KIND_INFO[k].label}</strong>
                <p className={s.help}>{SLIDE_KIND_INFO[k].use}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={s.cols2}>
        <div className={s.panel}>
          <header><h2>Identità dell’agenzia</h2></header>
          <div className={s.formGrid}>
            <label className={s.field}>Nome<input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className={s.field}>Colore d’accento
              <span className={s.row}>
                <input type="color" value={normalizeHex(form.default_accent) || DEFAULT_ACCENT} onChange={(e) => setForm({ ...form, default_accent: e.target.value })} style={{ width: 52, padding: 2 }} />
                <input value={form.default_accent} maxLength={7} onChange={(e) => setForm({ ...form, default_accent: e.target.value })} style={{ flex: 1 }} />
              </span>
            </label>
          </div>
          <label className={s.field}>Firma (sotto il nome in copertina)<input value={form.signature} maxLength={160} onChange={(e) => setForm({ ...form, signature: e.target.value })} /></label>
          <label className={s.field}>Contatto in chiusura<input value={form.contact} maxLength={300} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Nome, email, telefono" /></label>
          <label className={s.field}>
            Chi siamo (l’agente lo usa, non lo inventa)
            <textarea rows={5} value={form.about} maxLength={2000} onChange={(e) => setForm({ ...form, about: e.target.value })} placeholder="Competenze, metodo, cosa vi distingue. Niente clienti o numeri che non volete vedere nelle slide." />
          </label>
          <p className={s.help}>Stile di partenza delle presentazioni nuove: {THEME_STYLE_INFO[style].label} (lo scegli sopra).</p>
          <div className={s.row}><button className={s.primary} onClick={saveSettings} disabled={!!busy}>{busy === 'settings' ? 'Salvo…' : 'Salva identità'}</button></div>
        </div>

        <div className={s.panel}>
          <header><h2>Categorie di servizio</h2></header>
          <p className={s.help}>Configurabili: rinominale, spegnile o aggiungine. Il codice di una categoria non cambia, così le opportunità già aperte restano coerenti.</p>
          <table className={s.table}>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: '40%' }}>
                    <input defaultValue={c.name} maxLength={80} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && saveCategory({ ...c, name: e.target.value })} aria-label={`Nome ${c.slug}`} />
                  </td>
                  <td>
                    <input defaultValue={c.description} maxLength={400} onBlur={(e) => e.target.value !== c.description && saveCategory({ ...c, description: e.target.value })} aria-label={`Descrizione ${c.slug}`} />
                  </td>
                  <td style={{ width: 90 }}>
                    <label className={s.row} style={{ gap: 4 }}>
                      <input type="checkbox" checked={c.is_active} onChange={(e) => saveCategory({ ...c, is_active: e.target.checked })} style={{ width: 'auto' }} disabled={!!busy} />
                      Attiva
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s.formGrid}>
            <input placeholder="Nuova categoria" value={fresh.name} maxLength={80} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
            <input placeholder="Descrizione" value={fresh.description} maxLength={400} onChange={(e) => setFresh({ ...fresh, description: e.target.value })} />
          </div>
          <div className={s.row}><button className={s.ghost} onClick={() => saveCategory({ ...fresh, sort_order: (cats.at(-1)?.sort_order || 100) + 10 })} disabled={!fresh.name.trim() || !!busy}>＋ Aggiungi categoria</button></div>
        </div>
      </div>
    </div>
  )
}
