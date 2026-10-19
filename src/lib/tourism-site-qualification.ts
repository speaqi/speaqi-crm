export type TargetCheck = {
  classification:
    | 'destination_likely'
    | 'incoming_likely'
    | 'mixed'
    | 'inconclusive'
  evidence: { url: string; signal: string; kind: string }[]
  checked_pages: number
  venue_pages: number
  note: string
}
export const TARGET_LABELS: Record<TargetCheck['classification'], string> = {
  destination_likely: 'Destinazione probabile',
  incoming_likely: 'Incoming · fuori target',
  mixed: 'Attività mista · da verificare',
  inconclusive: 'Da verificare'
}
/** Self-description is stronger than finding the word DMC in a partners directory. */
export function siteRoleSignals(text: string) {
  return {
    incoming:
      /\bincoming\s+(?:tour\s+)?(?:operator|agency|travel|specialist)|\b(?:agenzia|operatore|specialista)\s+(?:di\s+)?incoming\b|\bdestination\s+management\s+company\b|\b(?:we are|we're|siamo|about us|welcome to)\b.{0,100}\bDMC\b|\bDMC\s*[-|·:]/i.test(
        text
      ),
    territorial:
      /\bofficial\b.{0,60}\b(?:tourism|tourist|destination|travel guide|visitor)|\b(?:tourism|tourist)\s+(?:board|office|authority)|\b(?:portale|sito)\b.{0,40}\b(?:turistico|turismo|ufficiale)|\b(?:ufficio|ente|agenzia regionale)\b.{0,30}\b(?:turismo|turistico)|\bofficial\s+destination|\boffiziell.{0,40}touris|\bsite.{0,30}officiel/i.test(
        text
      )
  }
}
export function qualifyTourismSite(input: {
  incoming: { url: string; signal: string }[]
  territorial: { url: string; signal: string }[]
  venues: { url: string; signal: string }[]
  catalogueUrls: number
  distinctVenues: number
  checkedPages: number
}): TargetCheck {
  const catalogued = input.catalogueUrls > 0 && input.venues.length > 0
  const destination =
    catalogued && (input.territorial.length > 0 || input.distinctVenues >= 2)
  const classification = input.incoming.length
    ? destination
      ? 'mixed'
      : 'incoming_likely'
    : destination
      ? 'destination_likely'
      : 'inconclusive'
  return {
    classification,
    evidence: [
      ...input.incoming.map((e) => ({
        ...e,
        kind: 'incoming_self_description'
      })),
      ...input.territorial.map((e) => ({
        ...e,
        kind: 'territorial_self_description'
      })),
      ...input.venues.map((e) => ({ ...e, kind: 'observed_venue' }))
    ].slice(0, 30),
    checked_pages: input.checkedPages,
    venue_pages: new Set(input.venues.map((e) => e.url)).size,
    note: 'Indicazione automatica basata su sitemap e pagine osservate. Non attesta identità ufficiale e non disabilita automaticamente i record. Una sitemap può omettere pagine del sito.'
  }
}
