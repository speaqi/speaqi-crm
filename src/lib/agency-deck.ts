import { DECK_TODO, countTodo, fillPlaceholders, mergeGenerated, normalizeSlide, type DeckSlide } from './tourism-deck'

export type AgencyBrief = { client: string; text: string; commercial: string; contact: string }
export type AgencyDocument = { format: 'speaqi-agency-v1'; brief: AgencyBrief; slides: DeckSlide[]; warnings: string[] }
const slide = (id: string, kind: DeckSlide['kind'], title: string, body = '', items: DeckSlide['items'] = []): DeckSlide =>
  ({ id, kind, title, body, items, note: '', hint: '', image_asset_id: null })

// Source: speaqi/speaqiagency content/agency.json and content/brand.md.
// Only the two confirmed services are named; no SaaS offer, references or price list.
export const AGENCY_TEMPLATE: DeckSlide[] = [
  slide('cover', 'cover', 'Speaqi Agency', 'Una proposta per {{cliente}}'),
  slide('brief', 'statement', 'Il progetto di {{cliente}}', DECK_TODO),
  slide('agency', 'cards', 'Speaqi Agency', '', [
    { title: 'Siti internet', text: 'Progettazione di siti per clienti esterni.' },
    { title: 'E-commerce', text: 'Progetti per la vendita online.' },
  ]),
  slide('solution', 'cards', 'Proposta di lavoro', '', [
    { title: 'Obiettivo', text: DECK_TODO },
    { title: 'Soluzione proposta', text: DECK_TODO },
    { title: 'Per chi', text: DECK_TODO },
  ]),
  slide('scope', 'cards', 'Attività comprese', '', [
    { title: 'Priorità', text: DECK_TODO },
    { title: 'Contenuti e funzioni', text: DECK_TODO },
    { title: 'Da chiarire insieme', text: DECK_TODO },
  ]),
  slide('method', 'steps', 'Sviluppo e pubblicazione', 'Sequenza proposta; attività e responsabilità saranno definite nel preventivo.', [
    { title: 'Analisi', text: 'Raccolta dei materiali e definizione delle pagine.' },
    { title: 'Progetto', text: 'Struttura del sito e direzione grafica.' },
    { title: 'Realizzazione', text: 'Sviluppo e inserimento dei contenuti.' },
    { title: 'Verifica', text: 'Controlli e pubblicazione.' },
  ]),
  slide('terms', 'statement', 'Investimento, tempi e condizioni', '{{condizioni}}'),
  slide('closing', 'closing', 'Informazioni per il preventivo', '{{contatto}}'),
]

export const AGENCY_EDITABLE_IDS = ['cover', 'brief', 'solution', 'scope']
export function validateAgencyBrief(raw: unknown): AgencyBrief {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const read = (key: string, max: number) => {
    if (typeof r[key] !== 'string' || (r[key] as string).length > max) throw new Error(`Campo ${key} non valido (massimo ${max} caratteri)`)
    return (r[key] as string).trim()
  }
  const brief = { client: read('client', 160), text: read('text', 18000), commercial: read('commercial', 2400), contact: read('contact', 500) }
  if (!brief.client || brief.text.length < 20) throw new Error('Inserisci il cliente e almeno 20 caratteri di informazioni')
  return brief
}

export function normalizeAgencyTemplate(raw: unknown): DeckSlide[] {
  if (!Array.isArray(raw) || raw.length !== AGENCY_TEMPLATE.length) throw new Error('Il modello Agency deve contenere otto slide')
  return AGENCY_TEMPLATE.map((base, i) => {
    const s = normalizeSlide(raw[i], i)
    if (s.id !== base.id || s.kind !== base.kind || s.items.length !== base.items.length) throw new Error('La struttura del modello Agency non è valida')
    return { ...s, image_asset_id: null, hint: '' }
  })
}

export function agencyBase(brief: AgencyBrief, template: DeckSlide[] = AGENCY_TEMPLATE) {
  const vars = { cliente: brief.client, condizioni: brief.commercial || DECK_TODO, contatto: brief.contact || DECK_TODO }
  const fill = (v: string) => fillPlaceholders(v, vars)
  return template.map(s => ({ ...s, title: fill(s.title), body: fill(s.body), note: fill(s.note), items: s.items.map(i => ({ title: fill(i.title), text: fill(i.text) })) }))
}

export function finalizeAgencyGeneration(base: DeckSlide[], raw: unknown, brief: AgencyBrief) {
  const merged = mergeGenerated(base, raw)
  const warnings: string[] = []
  const known = new Set((brief.text.match(/\d[\d.,]*/g) || []).map(n => n.replace(/\D/g, '')))
  const guard = (text: string) => {
    // Commercial terms are copied verbatim to their locked slide, never generated.
    const safe = text.replace(/(?:€\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|euro\b))/gi, () => {
      warnings.push('Importo generato rimosso: inserisci gli importi nelle condizioni commerciali.'); return DECK_TODO
    })
    for (const n of safe.match(/\d[\d.,]*/g) || []) if (!known.has(n.replace(/\D/g, ''))) warnings.push(`Numero da verificare: ${n}`)
    return safe
  }
  const slides = merged.map((s, i) => AGENCY_EDITABLE_IDS.includes(s.id)
    ? { ...s, title: guard(s.title).slice(0, 90), body: guard(s.body).slice(0, 280), items: s.items.map(it => ({ title: guard(it.title).slice(0, 48), text: guard(it.text).slice(0, 150) })), note: base[i].note, image_asset_id: null }
    : base[i])
  return { slides, warnings: [...new Set(warnings)] }
}

export function agencyIssues(slides: DeckSlide[]) {
  const issues: string[] = []
  if (countTodo(slides)) issues.push(`${countTodo(slides)} dati da verificare nelle slide`)
  for (const s of slides) {
    if (!s.title.trim()) issues.push(`Titolo mancante: ${s.id}`)
    if (s.title.length > 90 || s.body.length > 320 || s.items.some(i => i.title.length > 48 || i.text.length > 160)) issues.push(`Testo da accorciare: ${s.id}`)
    if (/\{\{[^}]+\}\}/.test(JSON.stringify(s))) issues.push(`Segnaposto da compilare: ${s.id}`)
  }
  return issues
}

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Self-contained export: only client-facing slides, never brief, warnings or agent instructions. */
export function agencyHtml(client: string, slides: DeckSlide[]) {
  const total = slides.length
  return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Speaqi Agency · ${esc(client)}</title><style>
@page{size:1920px 1080px;margin:0}*{box-sizing:border-box}body{margin:0;background:#e0e3e8;color:#1d2d44;font-family:Inter,Arial,sans-serif}section{width:1920px;height:1080px;padding:80px 112px;display:flex;flex-direction:column;overflow:hidden;break-after:page;position:relative;background:#faf7ed}section[data-role="agency"],section[data-role="closing"]{background:#1d2d44;color:#faf7ed}h1,h2,h3{font-family:'Bricolage Grotesque',Arial,sans-serif;line-height:1.08;margin:0;overflow-wrap:anywhere}h1{font-size:150px;max-width:1320px}h2{font-size:90px;max-width:1500px}p{font-size:37px;line-height:1.45;white-space:pre-line;overflow-wrap:anywhere;margin:32px 0 0}header{color:#fc511f;font-size:26px;font-weight:700;margin-bottom:76px}.content{flex:1;min-height:0}.cover .content{display:flex;flex-direction:column;justify-content:center}.cover .client{font-size:29px;color:#fc511f;margin-bottom:38px}.cover p{font-size:44px;max-width:1450px}.split{display:grid;grid-template-columns:.95fr 1.05fr;gap:110px;align-items:start;margin-top:60px}.split h2{font-size:96px}.split p{margin:0;font-size:42px}.rows{margin-top:55px}.row{display:grid;grid-template-columns:70px 470px minmax(0,1fr);gap:26px;padding:28px 0;border-top:1px solid #1d2d4438;align-items:start}.row h3{font-size:39px}.row p{margin:0;font-size:31px}.num{font-size:22px;color:#fc511f;padding-top:7px}.dark .row{border-color:#faf7ed3b}.dark .row p{color:#dadbd6}.steps .row{grid-template-columns:70px 385px minmax(0,1fr);padding:25px 0}footer{margin-top:auto;padding-top:28px;border-top:1px solid #86909c50;font-size:20px;display:flex;justify-content:space-between;gap:24px}.note{color:#fc511f;font-size:29px}.closing .content{display:flex;flex-direction:column;justify-content:center}.closing h2{max-width:1450px}.closing p{max-width:1370px}@media screen{body{overflow-x:auto}section{zoom:.5;margin:24px auto}}@media print{section{zoom:1;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}section:last-child{break-after:auto}}
</style>${slides.map((s, i) => {
    const cover = s.kind === 'cover'
    const split = !cover && !s.items.length && s.kind !== 'closing'
    const dark = s.id === 'agency' || s.kind === 'closing'
    const content = `${cover ? `<div class="client">${esc(client)}</div>` : ''}<${cover ? 'h1' : 'h2'}>${esc(s.title)}</${cover ? 'h1' : 'h2'}>${s.body ? `<p>${esc(s.body)}</p>` : ''}${s.items.length ? `<div class="rows">${s.items.map((it, j) => `<div class="row"><span class="num">${String(j + 1).padStart(2, '0')}</span><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>`).join('')}</div>` : ''}${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}`
    return `<section data-role="${esc(s.id)}" class="${cover ? 'cover' : s.kind} ${dark ? 'dark' : ''}"><header>speaqi <span>Agency</span></header><div class="content ${split ? 'split' : ''}">${content}</div><footer><span>Speaqi Agency / ${esc(client)}</span><span>${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></footer></section>`
  }).join('')}</html>`
}
