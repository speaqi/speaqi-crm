import Link from 'next/link'
import { formatEuroPlain } from '@/lib/command-center'
import { OFFICE_ACTION_NAMES, officeResultLink } from '@/lib/office-activity'
import { OFFICE_WORK_LABELS, type OfficeWorkStatus } from '@/lib/office-work'
import type { OfficeOverview } from '@/lib/office'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const when = (value: unknown) => {
  const date = new Date(String(value || ''))
  return Number.isFinite(date.getTime()) ? date.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}

export function OfficeReportBody({ value, agents }: { value: Record<string, unknown>; agents: OfficeOverview['agents'] }) {
  const totals = object(value.aggiornati_nel_periodo), open = object(value.situazione_attuale), costs = object(value.costi)
  const works = Array.isArray(value.lavori) ? value.lavori : []
  const attention = Array.isArray(value.attenzione) ? value.attenzione : []
  return <div className={styles.list}>
    <p className={styles.muted}>Dal {when(value.dal)} al {when(value.al)} · ora di Roma</p>
    <p>Aggiornati: {number(totals.aggiornati)} · riusciti: {number(totals.riusciti)} · con problemi: {number(totals.bloccati)}</p>
    <p>Situazione attuale: {number(open.in_corso)} in corso o in attesa, {number(open.bloccati_o_falliti)} bloccati o falliti, {number(open.attesa_decisione)} lavori in attesa di decisione.</p>
    <p>Spesi {formatEuroPlain(number(costs.spesi_centesimi) / 100)} · prenotati {formatEuroPlain(number(costs.prenotati_centesimi) / 100)}.</p>
    {attention.length > 0 && <><strong>Da verificare</strong><ul>{attention.map((raw, index) => {
      const work = object(raw), agent = agents.find((item) => item.id === work.agent_id)?.name || 'Ufficio'
      return <li key={index}>{agent}: {String(work.summary || OFFICE_WORK_LABELS[work.status as OfficeWorkStatus] || 'Lavoro aperto')}</li>
    })}</ul></>}
    {works.length > 0 && <><strong>Lavori aggiornati</strong><ul>{works.map((raw, index) => {
      const work = object(raw), result = officeResultLink(object(work.result))
      const agent = agents.find((item) => item.id === work.agent_id)?.name || String(work.agent_id || 'Ufficio')
      const action = OFFICE_ACTION_NAMES[String(work.action)] || 'Incarico'
      const state = OFFICE_WORK_LABELS[work.status as OfficeWorkStatus] || String(work.status || '')
      return <li key={String(work.id || index)}><strong>{String(work.schedule_title || work.instruction || `${agent} · ${action}`)}</strong> — {state}
        {work.summary && <p>{String(work.summary)}</p>}{result && <Link href={result.href}>{result.label} →</Link>}</li>
    })}</ul></>}
    <p className={styles.muted}>Fino a 30 lavori aggiornati nel periodo; la situazione attuale comprende anche i blocchi precedenti.</p>
  </div>
}
