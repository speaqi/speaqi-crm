import { DECK_TODO, countTodo, fillPlaceholders, mergeGenerated, normalizeSlide, type DeckSlide } from './tourism-deck'

export type AgencyBrief = { client: string; text: string; commercial: string; contact: string }
export type AgencyDocument = { format: 'speaqi-agency-v1'; brief: AgencyBrief; slides: DeckSlide[]; warnings: string[] }
const slide = (id: string, kind: DeckSlide['kind'], title: string, body = '', items: DeckSlide['items'] = []): DeckSlide =>
  ({ id, kind, title, body, items, note: '', hint: '', image_asset_id: null })

// Source: speaqi/speaqiagency content/agency.json and content/brand.md.
// Only the two confirmed services are named; no SaaS offer, references or price list.
export const AGENCY_TEMPLATE: DeckSlide[] = [
  slide('cover', 'cover', 'Speaqi Agency', 'Una proposta per {{cliente}}'),
  slide('brief', 'statement', 'Partiamo dal tuo obiettivo', DECK_TODO),
  slide('agency', 'cards', 'Il tuo progetto web, con Speaqi Agency', '', [
    { title: 'Siti internet', text: 'Progetti web per clienti esterni.' },
    { title: 'E-commerce', text: 'Progetti di vendita online da definire sulle tue esigenze.' },
  ]),
  slide('solution', 'cards', 'La proposta nasce dalle tue esigenze', '', [
    { title: 'Obiettivo', text: DECK_TODO },
    { title: 'Soluzione proposta', text: DECK_TODO },
    { title: 'Per chi', text: DECK_TODO },
  ]),
  slide('scope', 'cards', 'Definiamo cosa realizzare', '', [
    { title: 'Priorità', text: DECK_TODO },
    { title: 'Contenuti e funzioni', text: DECK_TODO },
    { title: 'Da chiarire insieme', text: DECK_TODO },
  ]),
  slide('method', 'steps', 'Un percorso da concordare insieme', 'Proposta di percorso, da confermare con te.', [
    { title: 'Brief', text: 'Concordare obiettivi e perimetro.' },
    { title: 'Proposta', text: 'Rivedere struttura e direzione grafica.' },
    { title: 'Realizzazione', text: 'Definire attività, materiali e responsabilità.' },
    { title: 'Revisione', text: 'Concordare verifiche e pubblicazione.' },
  ]),
  slide('terms', 'statement', 'Investimento, tempi e condizioni', '{{condizioni}}'),
  slide('closing', 'closing', 'Concordiamo il prossimo passo', '{{contatto}}'),
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
  return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Speaqi Agency · ${esc(client)}</title><style>
@page{size:1920px 1080px;margin:0}*{box-sizing:border-box}body{margin:0;background:#1d2d44;color:#faf7ed;font-family:Inter,Arial,sans-serif}section{width:1920px;height:1080px;padding:100px 130px;display:flex;flex-direction:column;overflow:hidden;break-after:page;position:relative}section:nth-child(even){background:#faf7ed;color:#1d2d44}h1,h2,h3{font-family:'Bricolage Grotesque',Arial,sans-serif;line-height:1.1;margin:0;overflow-wrap:anywhere}h1{font-size:112px;margin-top:auto}h2{font-size:78px}p{font-size:36px;line-height:1.4;white-space:pre-line;overflow-wrap:anywhere;max-width:1500px}header{color:#fc511f;font-size:30px;font-weight:700;margin-bottom:50px}.cards{display:grid;gap:28px;margin-top:45px}.card{border:1px solid #fc511f55;border-radius:24px;padding:32px}h3{font-size:38px}.card p{font-size:28px}.num{font-size:48px;color:#fc511f;margin-bottom:24px}footer{margin-top:auto;padding-top:28px;font-size:22px;display:flex;justify-content:space-between}.note{color:#fc511f;font-size:32px}@media screen{body{overflow-x:auto}section{zoom:.5;margin:24px auto;border:1px solid #ffffff22}}@media print{section{zoom:1;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}section:last-child{break-after:auto}}
</style>${slides.map((s, i) => `<section><header>speaqi <span>Agency</span></header><${s.kind === 'cover' ? 'h1' : 'h2'}>${esc(s.title)}</${s.kind === 'cover' ? 'h1' : 'h2'}>${s.body ? `<p>${esc(s.body)}</p>` : ''}${s.items.length ? `<div class="cards" style="grid-template-columns:repeat(${s.items.length},1fr)">${s.items.map((it, j) => `<div class="card"><div class="num">${j + 1}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>`).join('')}</div>` : ''}${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}<footer><span>Speaqi Agency · ${esc(client)}</span><span>${i + 1} / ${slides.length}</span></footer></section>`).join('')}</html>`
}
