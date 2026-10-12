import type { TradeFairStatus } from '@/lib/trade-fair'

export const FAIR = 'ttg-2026'
export const FAIR_LABEL = 'TTG Travel Experience 2026'

export const STATUS_COLORS: Record<TradeFairStatus, string> = {
  new: '#64748b',
  contacted: '#4f6ef7',
  replied: '#0ea5e9',
  interested: '#16a34a',
  meeting: '#7c3aed',
  not_interested: '#b91c1c',
}

export function formatDay(value: string | null) {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

export function formatStamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, header: string[], lines: unknown[][]) {
  const body = [header.map(csvCell).join(';'), ...lines.map((line) => line.map(csvCell).join(';'))].join('\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export const TYPE_SHORT: Record<string, string> = {
  dmo: 'Ente del turismo', consorzio: 'Consorzio', assoc_territoriale: 'Associazione territoriale', navigazione: 'Navigazione',
  dmc: 'DMC / incoming', tour_operator: 'Tour operator', catena: 'Catena / resort', trasporto: 'Trasporti', attrazione: 'Museo / attrazione',
  assoc_categoria: 'Associazione', hotel: 'Hotel', agenzia_viaggi: 'Agenzia viaggi', tecnologico: 'Tecnologia / servizi', non_turistica: 'Non turistica',
}
