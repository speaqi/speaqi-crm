import PptxGenJS from 'pptxgenjs'
import { AGENCY_TODO, FIELD_HEX, deckFields, fieldIsDark, formatMoney, inkOn, numberedMark, type AgencySlide, type AgencyTheme, type QuoteSummary, type SlideField } from '../agency'

// Export PowerPoint: ogni testo è una casella di testo vera, il grafico è un grafico
// nativo con i dati modificabili, le foto sono immagini sostituibili. Il disegno segue
// le slide web (stessa griglia 1920x1080 → 13,33 x 7,5 pollici) senza pretendere di
// riprodurre ogni effetto: sfumature e contorni restano al PDF.
// Caratteri del pitch Speaqi: Heuvel Grotesk per i titoli, Inter per il testo. PowerPoint non li
// incorpora: vanno installati sul computer che apre il file, altrimenti li sostituisce.

export type PptxInput = {
  title: string
  slides: AgencySlide[]
  theme: AgencyTheme
  clientName: string
  agencyName: string
  agencySignature: string
  quote: QuoteSummary | null
  /** id asset → data URI (image/jpeg;base64,...) */
  images: Record<string, string>
  clientLogo: string | null
  speaqiLogo?: { light: string; dark: string } | null
}

const W = 13.333
const H = 7.5
const X = (px: number) => px / 144
const PT = (px: number) => Math.round(px * 0.5 * 10) / 10
const FONT = 'Inter'
const TITLE_FONT = 'Heuvel Grotesk'
const hex = (c: string) => c.replace('#', '').toUpperCase()

type Palette = { accent: string; accentInk: string }

export function palette(theme: AgencyTheme): Palette {
  return { accent: hex(theme.accent), accentInk: hex(inkOn(theme.accent)) }
}

/** I colori di un campo: lo stesso schema delle slide web (agency-deck.module.css). */
function fieldColors(f: SlideField, p: Palette) {
  const NAVY = '1D2D44', NAVY2 = '253A59', CREAM = 'FAF7ED', SAND = 'EFE7D6'
  switch (f) {
    case 'navy': return { bg: NAVY, ink: CREAM, mark: p.accent, panel: p.accent, panelInk: p.accentInk, tone: NAVY2 }
    case 'deep': return { bg: hex(FIELD_HEX.deep), ink: CREAM, mark: p.accent, panel: p.accent, panelInk: p.accentInk, tone: NAVY }
    case 'accent': return { bg: p.accent, ink: p.accentInk, mark: p.accentInk, panel: NAVY, panelInk: CREAM, tone: NAVY }
    case 'sand': return { bg: SAND, ink: NAVY, mark: p.accent, panel: NAVY, panelInk: CREAM, tone: CREAM }
    default: return { bg: CREAM, ink: NAVY, mark: p.accent, panel: NAVY, panelInk: CREAM, tone: SAND }
  }
}

const SOURCE_KINDS = new Set(['context', 'solution', 'agenda', 'problems', 'opportunities', 'benefits', 'services', 'deliverables', 'metrics', 'chart'])
const ITEM_KINDS = new Set(['agenda', 'problems', 'opportunities', 'benefits', 'services', 'process', 'roadmap', 'deliverables', 'metrics', 'chart', 'comparison', 'next_steps'])
const PHOTO_KINDS = new Set(['statement', 'context', 'solution', 'next_steps', 'closing', 'section', 'deliverables'])
const strip = (s: string) => s.trim()
const two = (i: number) => String(i + 1).padStart(2, '0')
const lines = (t: string) => t.split(/\n+/).map((l) => l.replace(/^[-•·*]\s*/, '').trim()).filter(Boolean)

export async function buildPptx(input: PptxInput): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = input.title
  pptx.company = input.agencyName
  pptx.author = input.agencyName
  const p = palette(input.theme)
  const total = input.slides.length
  const fields = deckFields(input.slides.map((s) => s.kind), input.theme.style)

  input.slides.forEach((s, index) => {
    const f = fields[index]
    const c = fieldColors(f, p)
    const dark = fieldIsDark(f, input.theme.accent)
    const slide = pptx.addSlide()
    slide.background = { color: c.bg }
    const ink = c.ink
    const image = s.image_asset_id ? input.images[s.image_asset_id] : null
    const kind = ITEM_KINDS.has(s.kind) && !s.items.length ? 'statement' : s.kind
    const half = Boolean(image) && PHOTO_KINDS.has(kind)
    const left = half && s.layout === 'image_left'
    // Area del testo: tutta la slide, o la metà libera dalla foto.
    const AX = half ? (left ? 1040 : 112) : 112
    const AW = half ? 768 : 1696
    const text = (value: string, opts: PptxGenJS.TextPropsOptions) => slide.addText(strip(value), { fontFace: FONT, color: ink, valign: 'top', margin: 0, fit: 'shrink', ...opts })
    // Titoli e cifre grandi: Heuvel Grotesk, peso normale (il carattere ha un peso solo).
    const display = (value: string, opts: PptxGenJS.TextPropsOptions) => text(value, { ...opts, fontFace: TITLE_FONT, bold: false })
    const rect = (x: number, y: number, w: number, h: number, color: string) => slide.addShape(pptx.ShapeType.rect, { x: X(x), y: X(y), w: X(w), h: X(h), fill: { color }, line: { color, width: 0 } })

    if (half && image) slide.addImage({ data: image, x: left ? 0 : W / 2, y: 0, w: W / 2, h: H, sizing: { type: 'cover', w: W / 2, h: H } })
    // Testata corrente: il capitolo a sinistra, a che punto si è a destra.
    const run = () => {
      text(s.kicker || input.clientName, { x: X(AX), y: X(46), w: X(AW - 220), h: X(36), fontSize: PT(24), bold: true })
      slide.addText([{ text: two(index), options: { color: c.mark } }, { text: ` / ${two(total - 1)}`, options: { color: ink } }], { x: X(AX + AW - 220), y: X(46), w: X(220), h: X(36), fontFace: FONT, fontSize: PT(24), bold: true, align: 'right', margin: 0 })
    }
    const head = (top = 150, w = AW, x = AX) => {
      display(s.title, { x: X(x), y: X(top), w: X(w), h: X(240), fontSize: PT(half ? 96 : 112) })
      let y = top + 250
      if (s.body) {
        text(s.body, { x: X(x), y: X(y), w: X(Math.min(w, 1180)), h: X(150), fontSize: PT(32) })
        y += 160
      }
      return y
    }
    const foot = () => {
      if (SOURCE_KINDS.has(kind) && s.note) text(s.note, { x: X(AX), y: X(1012), w: X(AW), h: X(34), fontSize: PT(21), color: ink, transparency: 25 })
    }
    const poster = (big: boolean) => {
      run()
      display(s.title, { x: X(AX), y: X(170), w: X(AW), h: X(560), fontSize: PT(half ? 104 : big && s.title.length <= 56 ? 168 : 118), valign: 'bottom' })
      if (s.body) text(s.body, { x: X(AX), y: X(760), w: X(Math.min(AW, 1240)), h: X(170), fontSize: PT(32) })
      if (s.note && kind !== 'statement') display(s.note, { x: X(AX), y: X(940), w: X(AW), h: X(90), fontSize: PT(40), color: c.mark })
    }
    // Voci in righe grandi: numero (se serve), titolo in Heuvel, testo sotto.
    const rows = (x: number, y: number, w: number, h: number, numbers: boolean) => {
      const n = Math.max(1, s.items.length)
      const rh = h / n
      s.items.forEach((it, i) => {
        const cy = y + i * rh
        const tx = numbers ? x + 90 : x
        if (numbers) display(String(i + 1), { x: X(x), y: X(cy), w: X(80), h: X(80), fontSize: PT(72), color: c.mark })
        display(it.title, { x: X(tx), y: X(cy), w: X(w - (tx - x)), h: X(Math.min(70, rh * 0.45)), fontSize: PT(48) })
        const extra = [it.value, it.text].filter(Boolean).join(' · ')
        if (extra) text(extra, { x: X(tx), y: X(cy + Math.min(72, rh * 0.46)), w: X(w - (tx - x)), h: X(Math.max(30, rh - 82)), fontSize: PT(25) })
      })
    }

    switch (kind) {
      case 'cover': {
        if (image) slide.addImage({ data: image, x: X(998), y: 0, w: X(922), h: H, sizing: { type: 'cover', w: X(922), h: H } })
        const tw = image ? 860 : 1696
        const logo = input.speaqiLogo ? (dark ? input.speaqiLogo.dark : input.speaqiLogo.light) : null
        if (logo) slide.addImage({ data: logo, x: X(112), y: X(80), h: X(50), w: X(50 * 3.4) })
        text(input.agencyName.replace(/^speaqi\s*/i, '') || 'Agency', { x: X(logo ? 300 : 112), y: X(88), w: X(500), h: X(40), fontSize: PT(24), bold: true })
        if (input.clientLogo && input.theme.client_logo) slide.addImage({ data: input.clientLogo, x: X(image ? 640 : 1500), y: X(70), w: X(300), h: X(80), sizing: { type: 'contain', w: X(300), h: X(80) } })
        display(s.title, { x: X(112), y: X(260), w: X(tw), h: X(440), fontSize: PT(s.title.length > 40 ? 128 : image ? 176 : 230), valign: 'bottom' })
        if (s.body) text(s.body, { x: X(112), y: X(730), w: X(tw), h: X(110), fontSize: PT(40) })
        if (s.kicker) text(s.kicker, { x: X(112), y: X(850), w: X(tw), h: X(40), fontSize: PT(26), bold: true, color: c.mark })
        if (input.agencySignature) text(`${input.agencyName} · ${input.agencySignature}`, { x: X(112), y: X(930), w: X(tw), h: X(40), fontSize: PT(24) })
        return
      }
      case 'section':
      case 'closing':
      case 'statement':
        poster(true)
        return
      case 'quote': {
        run()
        display(`“${s.title}`, { x: X(112), y: X(200), w: X(1660), h: X(560), fontSize: PT(92), valign: 'bottom' })
        if (s.note) text(`— ${s.note}`, { x: X(112), y: X(800), w: X(1560), h: X(60), fontSize: PT(32), color: c.mark, bold: true })
        return
      }
      case 'investment': {
        run()
        const top = head()
        const q = input.quote
        if (!q) {
          text(`${AGENCY_TODO} Collega un preventivo: le cifre arrivano da lì.`, { x: X(112), y: X(top), w: X(1500), h: X(60), fontSize: PT(30) })
          return
        }
        const priced = q.lines.filter((l) => l.total > 0)
        const included = q.lines.length - priced.length
        const rowsT: PptxGenJS.TableRow[] = priced.slice(0, 6).map((l) => [
          { text: [{ text: l.description, options: { bold: true, breakLine: Boolean(l.details) } }, ...(l.details ? [{ text: l.details, options: { fontSize: PT(22) } }] : [])], options: { fontSize: PT(32) } },
          { text: [...(l.list_total && l.list_total > l.total ? [{ text: formatMoney(l.list_total, q.currency), options: { strike: true, fontSize: PT(22), breakLine: true } }] : []), { text: formatMoney(l.total, q.currency), options: { fontFace: TITLE_FONT, fontSize: PT(46) } }], options: { align: 'right' } }
        ])
        if (included > 0) rowsT.push([{ text: `Compresi nel prezzo: ${included} ${included === 1 ? 'voce' : 'voci'}, elencate nel preventivo`, options: { colspan: 2, fontSize: PT(22), bold: true } }])
        slide.addTable(rowsT, { x: X(112), y: X(top), w: X(1020), colW: [X(760), X(260)], fontFace: FONT, color: ink, margin: [0, 0, 0.12, 0] })
        const px = 1200, pw = 608
        rect(px, top, pw, 1020 - top, c.panel)
        text(`Il prezzo, IVA ${q.tax_rate}% esclusa`, { x: X(px + 56), y: X(top + 48), w: X(pw - 112), h: X(40), fontSize: PT(26), bold: true, color: c.panelInk })
        display(`${formatMoney(Math.max(0, q.subtotal - q.discount), q.currency)}${q.billing_interval === 'year' ? ' / anno' : ''}`, { x: X(px + 56), y: X(top + 96), w: X(pw - 112), h: X(140), fontSize: PT(118), color: c.panelInk })
        const meta: string[] = []
        if (q.discount > 0) meta.push(`Sconto incluso  − ${formatMoney(q.discount, q.currency)}`)
        if (q.deposit_net !== null && q.balance_net !== null) meta.push(`Alla firma  ${formatMoney(q.deposit_net, q.currency)} + IVA`, `Saldo  ${formatMoney(q.balance_net, q.currency)} + IVA`)
        if (q.payment_note) meta.push(q.payment_note)
        meta.push(`Preventivo ${q.number}${q.valid_until ? ` · valido fino al ${new Date(q.valid_until).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}`)
        if (q.note) meta.push(q.note)
        text(meta.join('\n'), { x: X(px + 56), y: X(top + 260), w: X(pw - 112), h: X(1020 - top - 300), fontSize: PT(24), color: c.panelInk })
        return
      }
      case 'chart': {
        run()
        const top = head()
        const values = s.items.map((it) => Number(String(it.value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')))
        // Un valore vuoto non è uno zero: senza tutti i valori niente grafico, si mostra la lista.
        if (s.items.length && s.items.every((it) => String(it.value || '').trim()) && values.every((v) => Number.isFinite(v))) {
          slide.addChart(pptx.ChartType.bar, [{ name: s.title, labels: s.items.map((it) => it.title), values }], {
            x: X(112), y: X(top), w: X(1696), h: X(960 - top),
            barDir: 'bar', chartColors: [c.mark], catAxisLabelColor: ink, valAxisLabelColor: ink,
            catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: PT(28), valAxisLabelFontSize: PT(20),
            showValue: true, dataLabelColor: ink, dataLabelFontSize: PT(26), valGridLine: { style: 'none' }, catGridLine: { style: 'none' }
          })
        } else {
          text(s.items.map((it) => `${it.title}: ${it.value || AGENCY_TODO}`).join('\n'), { x: X(112), y: X(top), w: X(1500), h: X(500), fontSize: PT(32) })
        }
        foot()
        return
      }
      case 'metrics': {
        run()
        head()
        const n = Math.max(1, s.items.length)
        const width = (1696 - 72 * (n - 1)) / n
        s.items.forEach((it, i) => {
          const cx = 112 + i * (width + 72)
          display(it.value || AGENCY_TODO, { x: X(cx), y: X(560), w: X(width), h: X(200), fontSize: PT(n > 3 ? 190 : 240), color: c.mark })
          text(it.title, { x: X(cx), y: X(790), w: X(width), h: X(60), fontSize: PT(38), bold: true })
          if (it.text) text(it.text, { x: X(cx), y: X(860), w: X(width), h: X(130), fontSize: PT(26) })
        })
        foot()
        return
      }
      case 'comparison': {
        run()
        const top = Math.max(head(), 600)
        s.items.slice(0, 2).forEach((it, i) => {
          const cx = 112 + i * 848
          rect(cx, top, 848, 1010 - top, i ? c.panel : c.tone)
          const col = i ? c.panelInk : ink
          display(it.title, { x: X(cx + 56), y: X(top + 44), w: X(736), h: X(70), fontSize: PT(56), color: col })
          slide.addText(
            lines(it.text).map((b) => ({ text: b, options: { bullet: { code: '25A0' }, breakLine: true } })),
            { x: X(cx + 56), y: X(top + 130), w: X(736), h: X(1010 - top - 170), fontFace: FONT, fontSize: PT(28), color: col, valign: 'top', fit: 'shrink', paraSpaceAfter: 6, margin: 0 }
          )
        })
        return
      }
      case 'roadmap': {
        run()
        const top = head()
        const n = Math.max(1, s.items.length)
        const rowH = Math.min(130, (980 - top) / n - 14)
        s.items.forEach((it, i) => {
          const cy = top + i * (rowH + 14)
          display(it.value || `Fase ${i + 1}`, { x: X(112), y: X(cy + rowH / 2 - 28), w: X(220), h: X(56), fontSize: PT(46), color: c.mark })
          const lx = 360 + (i / n) * 0.34 * 1448
          const fill = i % 2 ? c.tone : c.panel
          rect(lx, cy, 1808 - lx, rowH, fill)
          slide.addText(
            [{ text: it.title, options: { bold: true, fontSize: PT(30), breakLine: Boolean(it.text) } }, ...(it.text ? [{ text: it.text, options: { fontSize: PT(21) } }] : [])],
            { x: X(lx + 28), y: X(cy + 8), w: X(1808 - lx - 56), h: X(rowH - 16), fontFace: FONT, color: i % 2 ? ink : c.panelInk, valign: 'middle', fit: 'shrink', margin: 0 }
          )
        })
        if (s.note) text(s.note, { x: X(112), y: X(1000), w: X(1696), h: X(40), fontSize: PT(24), bold: true, color: c.mark })
        return
      }
      case 'process': {
        run()
        const top = Math.max(head(), 560)
        const n = Math.max(1, s.items.length)
        const width = (1696 - 48 * (n - 1)) / n
        rect(112, top, 1696, 14, c.tone)
        s.items.forEach((it, i) => {
          const cx = 112 + i * (width + 48)
          display(String(i + 1), { x: X(cx), y: X(top + 40), w: X(width), h: X(130), fontSize: PT(n > 4 ? 110 : 140), color: c.mark })
          text(it.title, { x: X(cx), y: X(top + 180), w: X(width), h: X(50), fontSize: PT(n > 4 ? 32 : 38), bold: true })
          let y = top + 236
          if (it.value && !/^\d{1,2}$/.test(it.value.trim())) { text(it.value, { x: X(cx), y: X(y), w: X(width), h: X(32), fontSize: PT(24), bold: true, color: c.mark }); y += 40 }
          if (it.text) text(it.text, { x: X(cx), y: X(y), w: X(width), h: X(960 - y - (s.note ? 90 : 0)), fontSize: PT(n > 4 ? 23 : 26) })
        })
        if (s.note) {
          rect(112, 940, 1696, 90, c.panel)
          display(s.note, { x: X(150), y: X(958), w: X(1620), h: X(56), fontSize: PT(36), color: c.panelInk, valign: 'middle' })
        }
        return
      }
      case 'agenda':
      case 'deliverables':
      case 'context':
      case 'solution':
      case 'next_steps': {
        run()
        const numbers = kind === 'agenda' || kind === 'next_steps'
        if (half) {
          const y = head(150)
          rows(AX, y + 20, AW, 1000 - y - 20, numbers)
        } else {
          head(150, 760)
          rows(1000, 160, 808, 860, numbers)
        }
        foot()
        return
      }
      default: {
        // Problemi, opportunità, benefici, servizi: colonne senza scatole, numero enorme se c'è.
        run()
        const top = Math.max(head(), 520)
        const n = Math.max(1, s.items.length)
        const cols = n <= 4 ? Math.max(2, n) : 3
        const rowsN = Math.ceil(n / cols)
        const gap = 72
        const width = (1696 - gap * (cols - 1)) / cols
        const showNum = kind === 'problems' || s.items.some((it) => numberedMark(it))
        const rh = (990 - top - 48 * (rowsN - 1)) / rowsN
        s.items.forEach((it, i) => {
          const cx = 112 + (i % cols) * (width + gap)
          const cy = top + Math.floor(i / cols) * (rh + 48)
          let y = cy
          if (showNum) {
            display(numberedMark(it) || two(i), { x: X(cx), y: X(y), w: X(width), h: X(rowsN > 1 ? 110 : 150), fontSize: PT(rowsN > 1 ? 110 : 150), color: c.mark })
            y += rowsN > 1 ? 120 : 165
          } else {
            rect(cx, cy, width, rh, c.tone)
            y += 40
          }
          const ix = showNum ? cx : cx + 40
          const iw = showNum ? width : width - 80
          if (showNum) text(it.title, { x: X(ix), y: X(y), w: X(iw), h: X(56), fontSize: PT(n > 3 ? 36 : 42), bold: true })
          else display(it.title, { x: X(ix), y: X(y), w: X(iw), h: X(70), fontSize: PT(n > 3 ? 42 : 50) })
          if (it.text) text(it.text, { x: X(ix), y: X(y + 70), w: X(iw), h: X(Math.max(40, cy + rh - y - 80)), fontSize: PT(n > 3 ? 25 : 28) })
          if (it.value && !numberedMark(it)) display(it.value, { x: X(ix), y: X(cy + rh - 80), w: X(iw), h: X(64), fontSize: PT(56), color: c.mark })
        })
        foot()
      }
    }
  })

  const out = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(out as Uint8Array)
}
