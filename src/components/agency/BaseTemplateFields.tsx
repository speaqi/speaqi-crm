'use client'

import { SLIDE_KINDS, SLIDE_KIND_INFO, blankSlide, type AgencySlide } from '@/lib/agency'
import s from './proposal-template.module.css'

export default function BaseTemplateFields({ slides, onChange }: { slides: AgencySlide[]; onChange: (s: AgencySlide[]) => void }) {
  const edit = (index: number, patch: Partial<AgencySlide>) => onChange(slides.map((s, i) => i === index ? { ...s, ...patch } : s))
  const move = (index: number, delta: number) => {
    const next = [...slides]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next)
  }
  return <div className={s.fields}>
    <p>Segnaposto: {'{{cliente}}, {{progetto}}, {{servizi}}, {{contatto}}'}. Questa base serve sia alla creazione senza AI sia alla generazione assistita. Ogni proposta si modifica poi separatamente.</p>
    {slides.map((s, index) => <details key={s.id}>
      <summary>{index + 1}. {s.kicker || SLIDE_KIND_INFO[s.kind].label} — {s.title}</summary>
      <div style={{ display: 'grid', gap: 8, padding: '12px 0' }}>
        <label>Layout<select value={s.kind} onChange={e => edit(index, { kind: e.target.value as AgencySlide['kind'] })}>{SLIDE_KINDS.map(k => <option key={k} value={k}>{SLIDE_KIND_INFO[k].label}</option>)}</select></label>
        <label>Occhiello<input value={s.kicker} maxLength={60} onChange={e => edit(index, { kicker: e.target.value })} /></label>
        <label>Titolo<input value={s.title} maxLength={180} onChange={e => edit(index, { title: e.target.value })} /></label>
        <label>Testo<textarea rows={3} value={s.body} maxLength={1000} onChange={e => edit(index, { body: e.target.value })} /></label>
        {s.items.map((item, j) => <div key={j} style={{ display: 'grid', gap: 4 }}>
          <input aria-label={`Titolo voce ${j + 1}`} value={item.title} maxLength={100} onChange={e => edit(index, { items: s.items.map((v, n) => n === j ? { ...v, title: e.target.value } : v) })} />
          <textarea aria-label={`Testo voce ${j + 1}`} rows={2} value={item.text} maxLength={400} onChange={e => edit(index, { items: s.items.map((v, n) => n === j ? { ...v, text: e.target.value } : v) })} />
          <button type="button" onClick={() => edit(index, { items: s.items.filter((_, n) => n !== j) })}>Rimuovi voce</button>
        </div>)}
        <button type="button" disabled={s.items.length >= 6} onClick={() => edit(index, { items: [...s.items, { title: '', text: '', value: '' }] })}>＋ Voce nella slide</button>
        <label>Nota<input value={s.note} maxLength={300} onChange={e => edit(index, { note: e.target.value })} /></label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" disabled={index === slides.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" disabled={slides.length <= 2} onClick={() => onChange(slides.filter((_, i) => i !== index))}>Rimuovi slide</button>
        </div>
      </div>
    </details>)}
    <button type="button" disabled={slides.length >= 24} onClick={() => onChange([...slides.slice(0, -1), blankSlide('statement', slides.map(s => s.id)), ...slides.slice(-1)])}>＋ Modulo nella presentazione</button>
  </div>
}
