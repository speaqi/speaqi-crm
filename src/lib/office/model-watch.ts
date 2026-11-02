/** Dati del catalogo OpenRouter: prezzi in USD per milione di token. */
export type CatalogModel = { id: string; name: string; created: number; context: number | null; input: number | null; output: number | null; modalities: string[] }

export function catalogModels(payload: unknown): CatalogModel[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) throw new Error('Catalogo OpenRouter non valido')
  return (payload as { data: any[] }).data.flatMap((row): CatalogModel[] => {
    if (typeof row?.id !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(row.id) || !Number.isFinite(row.created)) return []
    const price = (value: unknown) => { const n = typeof value === 'string' && value.trim() ? Number(value) * 1_000_000 : NaN; return Number.isFinite(n) && n >= 0 ? n : null }
    return [{ id: row.id, name: String(row.name || row.id).slice(0, 160), created: row.created,
      context: Number.isFinite(row.context_length) && row.context_length > 0 ? row.context_length : null,
      input: price(row.pricing?.prompt), output: price(row.pricing?.completion),
      modalities: Array.isArray(row.architecture?.input_modalities) ? row.architecture.input_modalities.filter((v: unknown): v is string => typeof v === 'string').slice(0, 8) : [] }]
  })
}

export function newCatalogModels(models: CatalogModel[], seen: Set<string>, now: Date, days = 7) {
  const max = Math.floor(now.getTime() / 1000)
  return models.filter(m => m.created <= max && m.created >= max - days * 86400 && !seen.has(m.id))
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
}

export function catalogChanges(models: CatalogModel[], previousIds: string[] | null, now: Date) {
  if (!previousIds) return newCatalogModels(models, new Set(), now)
  if (models.length < previousIds.length / 2) throw new Error('Catalogo OpenRouter incompleto: confronto sospeso')
  const previous = new Set(previousIds)
  return models.filter(m => !previous.has(m.id) && m.created <= now.getTime() / 1000)
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
}

export function modelReportText(day: string, models: CatalogModel[], recommendations: Array<{id:string;reason:string}>, baseline: string[]) {
  const entries = recommendations.flatMap(r => {
    const m = models.find(item => item.id === r.id)
    if (!m) return []
    const price = m.input === null || m.output === null ? 'prezzi da verificare' : `$${m.input.toFixed(2)} input / $${m.output.toFixed(2)} output per 1M token`
    return [`• ${m.name} (${m.id})\n${price}; contesto ${m.context ?? 'non indicato'}\n${r.reason.slice(0, 450)}\nhttps://openrouter.ai/${m.id}`]
  })
  return [`🔎 OpenRouter — ${day}`, `Modelli nuovi nel catalogo: ${models.length}.`,
    entries.length ? entries.join('\n\n') : 'Nessuna proposta selezionata oggi.',
    `Confronto: modelli configurati nell’ufficio CRM (${baseline.join(', ') || 'non rilevati'}).`,
    'Le indicazioni sono ipotesi da verificare con prove su qualità, strumenti, disponibilità e costo reale. Nessun modello viene sostituito automaticamente.'
  ].join('\n\n').slice(0, 3900)
}
