'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import type { ReportConfig } from '@/lib/office-recurring'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

const romeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function OfficeReportConfig() {
  const [config, setConfig] = useState<ReportConfig | null>(null)
  const [every, setEvery] = useState<1 | 2 | 7>(7)
  const [day, setDay] = useState(romeToday)
  const [time, setTime] = useState('18:00')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    void apiFetch<{ config: ReportConfig | null }>('/api/office/report-config').then(({ config: saved }) => {
      if (!active || !saved) return
      setConfig(saved); setEvery(saved.every_days); setDay(saved.next_local_date); setTime(saved.local_time.slice(0, 5)); setEnabled(saved.enabled)
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Report non disponibile') })
    return () => { active = false }
  }, [])
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const result = await apiFetch<{ config: ReportConfig }>('/api/office/report-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ every_days: every, local_time: time, next_local_date: day, enabled, revision: config?.revision ?? null }) })
      setConfig(result.config); setNotice('Frequenza del riepilogo salvata.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossibile salvare') }
    finally { setBusy(false) }
  }
  return <form onSubmit={save} className={`${styles.card} ${styles.agendaForm}`}>
    <h3>Riepilogo periodico</h3>
    <p className={styles.muted}>Un riepilogo dei lavori e dei costi viene salvato negli avvisi del CRM. Per ora non viene inviato su Telegram o email.</p>
    <label><span><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Riepilogo attivo</span></label>
    <div className={styles.actions}>
      <label>Frequenza <select value={every} onChange={(e) => setEvery(Number(e.target.value) as 1 | 2 | 7)}>
        <option value={1}>Ogni giorno</option><option value={2}>Ogni due giorni</option><option value={7}>Ogni settimana</option>
      </select></label>
      <label>Primo o prossimo giorno <input type="date" value={day} required onChange={(e) => setDay(e.target.value)} /></label>
      <label>Ora di Roma <input type="time" value={time} required onChange={(e) => setTime(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    <button className="btn btn-ghost btn-sm" disabled={busy}>Salva riepilogo</button>
  </form>
}
