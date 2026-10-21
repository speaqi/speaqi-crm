import PptxGenJS from 'pptxgenjs'
import { AGENCY_TODO, formatMoney, inkOn, isDarkSlide, numberedMark, type AgencySlide, type AgencyTheme, type QuoteSummary } from '../agency'

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

type Palette = { bg: string; ink: string; muted: string; card: string; line: string; darkBg: string; darkInk: string; darkMuted: string; accent: string; accentInk: string }

export function palette(theme: AgencyTheme): Palette {
  const accent = hex(theme.accent)
  const accentInk = hex(inkOn(theme.accent))
  // Stessi colori in tutti i modelli: cambia solo quali slide sono navy (isDarkSlide).
  return { bg: 'FAF7ED', ink: '1D2D44', muted: '5A6478', card: 'FFFFFF', line: 'E3E0D6', darkBg: '1D2D44', darkInk: 'FFFFFF', darkMuted: 'C9CCD3', accent, accentInk }
}

const SOURCE_KINDS = new Set(['context', 'solution', 'statement', 'agenda', 'problems', 'opportunities', 'benefits', 'services', 'deliverables', 'metrics', 'chart', 'comparison'])
const strip = (s: string) => s.trim()
const two = (i: number) => String(i + 1).padStart(2, '0')

export async function buildPptx(input: PptxInput): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = input.title
  pptx.company = input.agencyName
  pptx.author = input.agencyName
  const p = palette(input.theme)
  const total = input.slides.length

  input.slides.forEach((s, index) => {
    const dark = isDarkSlide(s.kind, input.theme.style)
    const slide = pptx.addSlide()
    slide.background = { color: dark ? p.darkBg : p.bg }
    const ink = dark ? p.darkInk : p.ink
    const muted = dark ? p.darkMuted : p.muted
    const image = s.image_asset_id ? input.images[s.image_asset_id] : null
    const text = (value: string, opts: PptxGenJS.TextPropsOptions) => slide.addText(strip(value), { fontFace: FONT, color: ink, valign: 'top', margin: 0, fit: 'shrink', ...opts })
    // Titoli e cifre grandi: Heuvel Grotesk, peso normale (il carattere ha un peso solo).
    const display = (value: string, opts: PptxGenJS.TextPropsOptions) => text(value, { ...opts, fontFace: TITLE_FONT, bold: false })
    const kickerColor = dark ? p.accent : 'C2461A'

    const head = (x = 132, w = 1500, y = 104) => {
      let top = y
      if (s.kicker) {
        text(s.kicker.toUpperCase(), { x: X(x), y: X(top), w: X(w), h: X(40), fontSize: PT(25), bold: true, color: kickerColor, charSpacing: 3 })
        top += 56
      }
      display(s.title, { x: X(x), y: X(top), w: X(w), h: X(200), fontSize: PT(100) })
      top += 210
      if (s.body) {
        text(s.body, { x: X(x), y: X(top), w: X(Math.min(w, 1240)), h: X(150), fontSize: PT(34), color: muted })
        top += 170
      }
      return top
    }
    // Piede del pitch: a sinistra chi parla a chi, a destra il numero della slide.
    const foot = () => {
      // Sulle slide di contenuto la nota è la fonte del dato: sta qui, in piccolo, come nel pitch.
      const source = SOURCE_KINDS.has(s.kind) && s.note ? s.note : ''
      text(source || `${input.agencyName} / ${input.clientName}`, { x: X(128), y: X(1004), w: X(1300), h: X(34), fontSize: PT(21), color: muted })
      text(`${index + 1} / ${total}`, { x: X(1500), y: X(1004), w: X(292), h: X(34), fontSize: PT(21), bold: true, color: ink, align: 'right' })
    }
    const cardRow = (top: number, items: AgencySlide['items'], cols: number, mark: (i: number) => string) => {
      const gap = 30
      const width = (1656 - gap * (cols - 1)) / cols
      const rows = Math.ceil(items.length / cols)
      const height = Math.min(380, (930 - top - gap * (rows - 1)) / rows)
      items.forEach((it, i) => {
        const cx = 132 + (i % cols) * (width + gap)
        const cy = top + Math.floor(i / cols) * (height + gap)
        slide.addShape(pptx.ShapeType.roundRect, { x: X(cx), y: X(cy), w: X(width), h: X(height), fill: { color: p.card }, line: { color: p.line, width: 1 }, rectRadius: 0.12 })
        text(mark(i), { x: X(cx + 36), y: X(cy + 30), w: X(width - 72), h: X(60), fontSize: PT(30), bold: true, color: p.accent })
        text(it.title, { x: X(cx + 36), y: X(cy + 100), w: X(width - 72), h: X(90), fontSize: PT(36), bold: true })
        if (it.text) text(it.text, { x: X(cx + 36), y: X(cy + 190), w: X(width - 72), h: X(Math.max(60, height - 220)), fontSize: PT(25), color: muted })
      })
    }

    switch (s.kind) {
      case 'cover': {
        if (image) {
          // Foto a destra, come la copertina del pitch; il velo a sinistra tiene leggibile il titolo.
          slide.addImage({ data: image, x: X(690), y: 0, w: X(1230), h: H, sizing: { type: 'cover', w: X(1230), h: H } })
          slide.addShape(pptx.ShapeType.rect, { x: X(690), y: 0, w: X(500), h: H, fill: { color: dark ? p.darkBg : p.bg, transparency: 30 }, line: { color: p.bg, transparency: 100 } })
        } else {
          slide.addShape(pptx.ShapeType.ellipse, { x: X(1180), y: X(-260), w: X(1000), h: X(1000), fill: { color: p.accent, transparency: 55 }, line: { color: p.accent, transparency: 100 } })
        }
        if (input.clientLogo && input.theme.client_logo) slide.addImage({ data: input.clientLogo, x: X(1500), y: X(90), w: X(300), h: X(90), sizing: { type: 'contain', w: X(300), h: X(90) } })
        const logo = input.speaqiLogo ? (dark ? input.speaqiLogo.dark : input.speaqiLogo.light) : null
        if (logo) slide.addImage({ data: logo, x: X(128), y: X(96), h: X(46), w: X(46 * 3.4) })
        text(input.agencyName.replace(/^speaqi\s*/i, '') || 'Agency', { x: X(logo ? 300 : 128), y: X(104), w: X(600), h: X(40), fontSize: PT(22), bold: true, color: p.accent })
        if (s.kicker) text(s.kicker.toUpperCase(), { x: X(128), y: X(300), w: X(1150), h: X(40), fontSize: PT(25), bold: true, color: kickerColor, charSpacing: 3 })
        display(s.title, { x: X(128), y: X(350), w: X(1150), h: X(420), fontSize: PT(150), valign: 'bottom' })
        if (s.body) display(s.body, { x: X(128), y: X(790), w: X(1150), h: X(140), fontSize: PT(58) })
        if (input.agencySignature) text(`${input.agencyName} · ${input.agencySignature}`, { x: X(128), y: X(980), w: X(1300), h: X(40), fontSize: PT(22), color: muted })
        return
      }
      case 'section':
      case 'closing': {
        if (s.kind === 'section') display(String(index + 1).padStart(2, '0'), { x: X(1100), y: X(40), w: X(700), h: X(520), fontSize: PT(420), color: p.accent, align: 'right', transparency: 60 })
        if (s.kicker) text(s.kicker.toUpperCase(), { x: X(128), y: X(430), w: X(1500), h: X(40), fontSize: PT(25), bold: true, color: kickerColor, charSpacing: 3 })
        display(s.title, { x: X(128), y: X(480), w: X(1640), h: X(300), fontSize: PT(140), valign: 'bottom' })
        if (s.body) text(s.body, { x: X(132), y: X(800), w: X(1300), h: X(110), fontSize: PT(34), color: muted })
        if (s.note) text(s.note, { x: X(132), y: X(910), w: X(1300), h: X(50), fontSize: PT(28), color: p.accent, bold: true })
        foot()
        return
      }
      case 'quote': {
        display('“', { x: X(132), y: X(120), w: X(300), h: X(240), fontSize: PT(300), color: p.accent })
        display(s.title, { x: X(132), y: X(340), w: X(1560), h: X(420), fontSize: PT(76) })
        if (s.note) text(`— ${s.note}`, { x: X(132), y: X(790), w: X(1560), h: X(60), fontSize: PT(30), color: p.accent, bold: true })
        foot()
        return
      }
      case 'statement': {
        const w = image ? 900 : 1500
        const x = image && s.layout === 'image_left' ? 1000 : 132
        if (s.kicker) text(s.kicker.toUpperCase(), { x: X(x), y: X(300), w: X(w), h: X(40), fontSize: PT(25), bold: true, color: kickerColor, charSpacing: 3 })
        display(s.title, { x: X(x), y: X(350), w: X(w), h: X(330), fontSize: PT(120), valign: 'bottom' })
        if (s.body) text(s.body, { x: X(x), y: X(700), w: X(w), h: X(200), fontSize: PT(34), color: muted })
        if (image) {
          const ix = s.layout === 'image_left' ? 132 : 1100
          slide.addImage({ data: image, x: X(ix), y: X(104), w: X(688), h: X(850), sizing: { type: 'cover', w: X(688), h: X(850) }, rounding: false })
        }
        foot()
        return
      }
      case 'investment': {
        const top = head()
        const q = input.quote
        if (!q) {
          text(`${AGENCY_TODO} Collega un preventivo: le cifre arrivano da lì.`, { x: X(132), y: X(top), w: X(1500), h: X(60), fontSize: PT(30), color: muted })
          foot()
          return
        }
        // Le righe a 0 € sono "incluse": una riga sola, l'elenco intero sta nel preventivo.
        const priced = q.lines.filter((l) => l.total > 0)
        const included = q.lines.length - priced.length
        const rows: PptxGenJS.TableRow[] = priced.slice(0, 10).map((l) => [
          { text: [{ text: l.description, options: { bold: true, breakLine: Boolean(l.details) } }, ...(l.details ? [{ text: l.details, options: { fontSize: PT(20), color: muted } }] : [])], options: { fontSize: PT(26) } },
          { text: formatMoney(l.total, q.currency), options: { align: 'right', fontSize: PT(26), bold: true } }
        ])
        if (priced.length > 10) rows.push([{ text: `+ altre ${priced.length - 10} voci nel preventivo`, options: { colspan: 2, fontSize: PT(20), color: muted } }])
        if (included > 0) rows.push([{ text: `Compresi nel prezzo: ${included} ${included === 1 ? 'voce' : 'voci'}, elencate nel preventivo`, options: { colspan: 2, fontSize: PT(20), color: muted } }])
        slide.addTable(rows, { x: X(132), y: X(top), w: X(1050), colW: [X(800), X(250)], fontFace: FONT, color: ink, border: { type: 'solid', color: p.line, pt: 1 }, margin: 0.08 })
        slide.addShape(pptx.ShapeType.roundRect, { x: X(1260), y: X(top), w: X(528), h: X(560), fill: { color: p.darkBg }, line: { color: p.darkBg }, rectRadius: 0.12 })
        const lines = [
          `Imponibile  ${formatMoney(Math.max(0, q.subtotal - q.discount), q.currency)}`,
          ...(q.discount > 0 ? [`Sconto incluso  − ${formatMoney(q.discount, q.currency)}`] : []),
          `IVA ${q.tax_rate}%  ${formatMoney(q.tax, q.currency)}`
        ]
        text(lines.join('\n'), { x: X(1300), y: X(top + 40), w: X(448), h: X(130), fontSize: PT(24), color: p.darkMuted })
        text('TOTALE', { x: X(1300), y: X(top + 200), w: X(448), h: X(36), fontSize: PT(22), color: p.darkMuted, bold: true })
        text(`${formatMoney(q.total, q.currency)}${q.billing_interval === 'year' ? ' / anno' : ''}`, { x: X(1300), y: X(top + 240), w: X(448), h: X(100), fontSize: PT(62), bold: true, color: p.accent })
        let metaY = top + 350
        if (q.deposit_net !== null && q.balance_net !== null) {
          text(`Alla firma  ${formatMoney(q.deposit_net, q.currency)} + IVA\nSaldo  ${formatMoney(q.balance_net, q.currency)} + IVA`, { x: X(1300), y: X(top + 330), w: X(448), h: X(80), fontSize: PT(22), color: p.darkMuted })
          metaY = top + 420
        }
        text(`Preventivo ${q.number}${q.valid_until ? ` · valido fino al ${new Date(q.valid_until).toLocaleDateString('it-IT')}` : ''}${q.payment_note ? `\n${q.payment_note}` : ''}${q.note ? `\n${q.note}` : ''}`, { x: X(1300), y: X(metaY), w: X(448), h: X(Math.max(60, 480 - (metaY - top) - 10)), fontSize: PT(18), color: p.darkMuted })
        foot()
        return
      }
      case 'chart': {
        const top = head()
        const values = s.items.map((it) => Number(String(it.value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')))
        // Un valore vuoto non è uno zero: senza tutti i valori niente grafico, si mostra la lista.
        if (s.items.length && s.items.every((it) => String(it.value || '').trim()) && values.every((v) => Number.isFinite(v))) {
          slide.addChart(pptx.ChartType.bar, [{ name: s.title, labels: s.items.map((it) => it.title), values }], {
            x: X(132), y: X(top), w: X(1656), h: X(900 - top),
            barDir: 'bar', chartColors: [p.accent], catAxisLabelColor: ink, valAxisLabelColor: muted,
            catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: PT(26), valAxisLabelFontSize: PT(20),
            showValue: true, dataLabelColor: ink, dataLabelFontSize: PT(24), valGridLine: { color: p.line, size: 1 }, catGridLine: { style: 'none' }
          })
        } else {
          text(s.items.map((it) => `${it.title}: ${it.value || AGENCY_TODO}`).join('\n'), { x: X(132), y: X(top), w: X(1500), h: X(500), fontSize: PT(32) })
        }
        foot()
        return
      }
      case 'metrics': {
        const top = head() + 30
        const cols = Math.max(1, s.items.length)
        const width = (1656 - 40 * (cols - 1)) / cols
        s.items.forEach((it, i) => {
          const cx = 132 + i * (width + 40)
          slide.addShape(pptx.ShapeType.line, { x: X(cx), y: X(top), w: X(width), h: 0, line: { color: i === 0 ? p.accent : dark ? '6B7890' : p.ink, width: 3 } })
          display(it.value || AGENCY_TODO, { x: X(cx), y: X(top + 30), w: X(width), h: X(170), fontSize: PT(170), color: i === 0 ? p.accent : ink })
          text(it.title, { x: X(cx), y: X(top + 200), w: X(width), h: X(60), fontSize: PT(34), bold: true })
          if (it.text) text(it.text, { x: X(cx), y: X(top + 270), w: X(width), h: X(120), fontSize: PT(24), color: muted })
        })
        foot()
        return
      }
      case 'comparison': {
        const top = head()
        s.items.slice(0, 2).forEach((it, i) => {
          const cx = 132 + i * 873
          const after = i === 1
          slide.addShape(pptx.ShapeType.roundRect, { x: X(cx), y: X(top), w: X(783), h: X(920 - top), fill: { color: after ? p.accent : p.card }, line: { color: after ? p.accent : p.line }, rectRadius: 0.12 })
          text(it.title.toUpperCase(), { x: X(cx + 48), y: X(top + 40), w: X(687), h: X(40), fontSize: PT(24), bold: true, color: after ? p.accentInk : muted })
          const bullets = it.text.split(/\n+/).map((l) => l.replace(/^[-•·*]\s*/, '').trim()).filter(Boolean)
          slide.addText(
            bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
            { x: X(cx + 48), y: X(top + 100), w: X(687), h: X(820 - top - 140), fontFace: FONT, fontSize: PT(28), color: after ? p.accentInk : ink, valign: 'top', fit: 'shrink', paraSpaceAfter: 6 }
          )
        })
        foot()
        return
      }
      case 'roadmap': {
        const top = head()
        const n = Math.max(1, s.items.length)
        const rowH = Math.min(120, (920 - top) / n - 16)
        s.items.forEach((it, i) => {
          const cy = top + i * (rowH + 16)
          text(it.value || `Fase ${i + 1}`, { x: X(132), y: X(cy + rowH / 2 - 20), w: X(230), h: X(44), fontSize: PT(26), bold: true, color: p.accent, align: 'right' })
          const left = 400 + (i / n) * 0.7 * 1388
          const width = Math.min(1788 - left, (0.3 + 0.7 / n) * 1388)
          slide.addShape(pptx.ShapeType.roundRect, { x: X(left), y: X(cy), w: X(width), h: X(rowH), fill: { color: i % 2 ? p.ink : p.accent }, line: { color: i % 2 ? p.ink : p.accent }, rectRadius: 0.1 })
          slide.addText(
            [{ text: it.title, options: { bold: true, fontSize: PT(28), breakLine: Boolean(it.text) } }, ...(it.text ? [{ text: it.text, options: { fontSize: PT(20) } }] : [])],
            { x: X(left + 24), y: X(cy + 8), w: X(width - 48), h: X(rowH - 16), fontFace: FONT, color: i % 2 ? p.bg : p.accentInk, valign: 'middle', fit: 'shrink' }
          )
        })
        foot()
        return
      }
      case 'process':
      case 'next_steps': {
        const top = head() + 20
        const n = Math.max(1, s.items.length)
        const width = (1656 - 30 * (n - 1)) / n
        slide.addShape(pptx.ShapeType.line, { x: X(172), y: X(top + 40), w: X(1576), h: 0, line: { color: p.accent, width: 2 } })
        s.items.forEach((it, i) => {
          const cx = 132 + i * (width + 30)
          slide.addShape(pptx.ShapeType.ellipse, { x: X(cx), y: X(top), w: X(80), h: X(80), fill: { color: p.accent }, line: { color: p.accent } })
          text(String(i + 1), { x: X(cx), y: X(top), w: X(80), h: X(80), fontSize: PT(36), bold: true, color: p.accentInk, align: 'center', valign: 'middle' })
          text(it.title, { x: X(cx), y: X(top + 110), w: X(width), h: X(100), fontSize: PT(34), bold: true })
          if (it.value) text(it.value.toUpperCase(), { x: X(cx), y: X(top + 210), w: X(width), h: X(34), fontSize: PT(20), bold: true, color: p.accent })
          if (it.text) text(it.text, { x: X(cx), y: X(top + 250), w: X(width), h: X(260), fontSize: PT(24), color: muted })
        })
        if (s.note) text(s.note, { x: X(132), y: X(900), w: X(1600), h: X(50), fontSize: PT(28), bold: true, color: p.accent })
        foot()
        return
      }
      case 'agenda':
      case 'deliverables': {
        const top = head(132, 640)
        void top
        s.items.forEach((it, i) => {
          const cy = 150 + i * (780 / Math.max(s.items.length, 1))
          slide.addShape(pptx.ShapeType.line, { x: X(880), y: X(cy), w: X(908), h: 0, line: { color: p.line, width: 1 } })
          text(s.kind === 'agenda' ? two(i) : '✓', { x: X(880), y: X(cy + 16), w: X(110), h: X(60), fontSize: PT(44), bold: true, color: p.accent })
          text(it.title, { x: X(1000), y: X(cy + 16), w: X(788), h: X(56), fontSize: PT(36), bold: true })
          if (it.text) text(it.text, { x: X(1000), y: X(cy + 74), w: X(788), h: X(Math.max(30, 780 / Math.max(s.items.length, 1) - 90)), fontSize: PT(22), color: muted })
        })
        foot()
        return
      }
      case 'context':
      case 'solution': {
        head(132, 820)
        if (s.items.length) {
          const h = Math.min(200, (860 - 104) / s.items.length - 18)
          s.items.forEach((it, i) => {
            const cy = 104 + i * (h + 18)
            slide.addShape(pptx.ShapeType.rect, { x: X(1030), y: X(cy), w: X(758), h: X(h), fill: { color: p.card }, line: { color: p.line } })
            slide.addShape(pptx.ShapeType.rect, { x: X(1030), y: X(cy), w: X(8), h: X(h), fill: { color: p.accent }, line: { color: p.accent } })
            slide.addText(
              [{ text: it.title, options: { bold: true, fontSize: PT(32), breakLine: Boolean(it.text) } }, ...(it.text ? [{ text: it.text, options: { fontSize: PT(22), color: muted } }] : [])],
              { x: X(1066), y: X(cy + 14), w: X(700), h: X(h - 28), fontFace: FONT, color: ink, valign: 'middle', fit: 'shrink' }
            )
          })
        } else if (image) {
          slide.addImage({ data: image, x: X(1030), y: X(104), w: X(758), h: X(850), sizing: { type: 'cover', w: X(758), h: X(850) } })
        }
        foot()
        return
      }
      default: {
        const top = head()
        const cols = s.kind === 'services' ? Math.min(3, Math.max(2, Math.ceil(s.items.length / 2))) : Math.min(4, Math.max(2, s.items.length))
        cardRow(top, s.items, cols, (i) => numberedMark(s.items[i]) || (s.kind === 'opportunities' ? '↗' : s.kind === 'benefits' ? '✦' : two(i)))
        foot()
      }
    }
  })

  const out = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(out as Uint8Array)
}
