import { DECK_TODO_PATTERN, type DeckSlide } from '../tourism-deck'
import { isUuid, safePublicUrl } from '../tourism'

export type PresentationQueueItem = { entity_id: string; destination_id?: string }
export function presentationQueue(raw: unknown): PresentationQueueItem[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Coda presentazioni: massimo 100 enti')
  const items = raw.map((item) => typeof item === 'string' ? { entity_id: item } : item)
  if (items.some((item) => !item || !isUuid(item.entity_id) || (item.destination_id !== undefined && !isUuid(item.destination_id)))) {
    throw new Error('Coda presentazioni: entity_id e destination_id devono essere UUID')
  }
  return [...new Map(items.map((item) => [`${item.entity_id}:${item.destination_id || ''}`, item as PresentationQueueItem])).values()]
}
export type DeckPlaceholder = { slide_id: string; field: string; marker: string; text: string; context: string }
export function deckPlaceholders(slides: DeckSlide[]): DeckPlaceholder[] {
  return slides.flatMap((slide) => {
    const fields = [['title', slide.title, slide.title], ['body', slide.body, slide.title], ['note', slide.note, slide.title],
      ...slide.items.flatMap((item, i) => [[`items.${i}.title`, item.title, item.title], [`items.${i}.text`, item.text, item.title]])]
    return fields.flatMap(([field, text, context]) => [...text.matchAll(new RegExp(DECK_TODO_PATTERN.source, 'g'))]
      .map(([marker]) => ({ slide_id: slide.id, field, marker, text, context })))
  })
}
export type PresentationEvidence = { id: string; entity_id: string; status: string; fields: string[]; source_url: string; excerpt: string }
/** Solo proposte da copiare nell'editor: nessuna slide è modificata o approvata. */
export function presentationFixes(slides: DeckSlide[], entities: Array<{ id: string; details: Record<string, unknown> }>, evidence: PresentationEvidence[]) {
  return deckPlaceholders(slides).flatMap((placeholder) => {
    const label = `${placeholder.context} ${placeholder.text}`.toLowerCase()
    const explicit = /^\[DA VERIFICARE:\s*([a-z_]+)\]$/.exec(placeholder.marker)?.[1]
    const key = explicit && explicit !== 'quanti' ? explicit : /luoghi da vedere/.test(label) ? 'place_count'
      : /itinerari/.test(label) ? 'route_count' : /strutture e servizi/.test(label) ? 'service_count' : null
    if (!key) return []
    // Più attestazioni discordanti non vengono risolte scegliendone una a caso.
    const candidates = entities.flatMap((entity) => {
      const raw = entity.details?.[key]
      if ((typeof raw !== 'string' && typeof raw !== 'number') || !String(raw).trim() || String(raw).length > 200) return []
      if (typeof raw === 'number' && (!Number.isSafeInteger(raw) || raw < 0)) return []
      const replacement = String(raw).trim()
      if (/\[DA VERIFICARE|[\r\n]|https?:\/\//.test(replacement)) return []
      return evidence.filter((e) => e.entity_id === entity.id && e.status === 'VERIFIED' && safePublicUrl(e.source_url)
        && e.fields.some((f) => f === key || f === `details.${key}`)
        && (typeof raw === 'number' || /^\d+$/.test(replacement)
          ? new RegExp(`(?<![\\d.,])${replacement}(?![\\d.,])`).test(e.excerpt) : e.excerpt.includes(replacement)))
        .map((source) => ({ ...placeholder, replacement, proposed_text: placeholder.text.replace(placeholder.marker, replacement),
          evidence_id: source.id, source_url: source.source_url, excerpt: source.excerpt, entity_id: entity.id }))
    })
    return new Set(candidates.map((c) => c.replacement)).size === 1 ? candidates.slice(0, 1) : []
  })
}
