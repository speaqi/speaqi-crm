// Nomi e ruoli come li mostra l'ufficio 3D. Solo presentazione: gli identificativi restano quelli del CRM.

/** Le zone dell'open space, con i nomi del disegno del titolare. Il sottotitolo è il nome del reparto nel CRM. */
export const ZONES = {
  direzione: { title: 'THE DECK', icon: 'crown' },
  mappe: { title: 'MAP LAB', icon: 'map' },
  ricerca: { title: 'INSIGHT HUB', icon: 'search' },
  commerciale: { title: 'DEAL ROOM', icon: 'briefcase' },
  finanza: { title: 'FINANCE DESK', icon: 'euro' },
  marketing: { title: 'GROWTH STUDIO', icon: 'trend' },
  operazioni: { title: 'MISSION CONTROL', icon: 'server' },
  sviluppo: { title: 'CODE LAB', icon: 'code' },
}
export const zoneOf = (sector) => ZONES[sector.id] || { title: String(sector.name || sector.id).toUpperCase(), icon: 'users' }

/** Cosa fa ogni agente, in una riga: è la risposta a «che cosa fa questo personaggio?». */
export const ROLES = {
  director: { icon: 'crown', does: 'Riceve i tuoi ordini e li passa alla squadra', screen: 'lines' },
  mymaps_builder: { icon: 'pin', does: 'Importa i luoghi dalle My Maps', screen: 'map' },
  languages_voice: { icon: 'headphones', does: 'Traduce i testi e genera le voci', screen: 'wave', headphones: true },
  maps_quality: { icon: 'shield', does: 'Controlla la qualità delle mappe', screen: 'map', glasses: true },
  demo_builder: { icon: 'map', does: 'Prepara le demo e i temi delle città', screen: 'map' },
  office_researcher: { icon: 'search', does: 'Cerca i dati che mancano, con le fonti', screen: 'lines', glasses: true },
  events_scout: { icon: 'calendar', does: 'Scova fiere, eventi e bandi', screen: 'lines' },
  entity_enricher: { icon: 'building', does: 'Trova gli enti e i loro recapiti', screen: 'lines' },
  model_watch: { icon: 'cpu', does: 'Tiene d’occhio i nuovi modelli AI', screen: 'wave' },
  news_watch: { icon: 'news', does: 'Prepara la rassegna delle novità', screen: 'lines' },
  presentations: { icon: 'slides', does: 'Prepara le presentazioni per gli enti', screen: 'slides' },
  sales_followup: { icon: 'mail', does: 'Scrive le bozze di follow-up ai clienti', screen: 'lines' },
  finance: { icon: 'euro', does: 'Prepara fatture, solleciti e chiusura del mese', screen: 'bars', glasses: true },
  social: { icon: 'heart', does: 'Scrive le bozze dei post social', screen: 'slides' },
  db_cleaner: { icon: 'sparkles', does: 'Trova doppioni e dati sporchi nel CRM', screen: 'lines' },
}
const firstSentence = (text) => { const v = String(text || '').split(/(?<=[.;:])\s/)[0].replace(/[.;:]$/, ''); return v.length > 64 ? `${v.slice(0, 63)}…` : v }
export const roleOf = (agent, sector) => ROLES[agent.id] || { icon: ZONES[sector?.id]?.icon || 'users', does: firstSentence(agent.description), screen: 'lines' }

export const STATE_NAME = { running: 'Sta lavorando', ready: 'Disponibile', attention: 'Da verificare', off: 'Spento' }
export const STATE_ICON = { running: 'bolt', ready: 'coffee', attention: 'alert', off: 'moon' }

/** La riga che dice cosa sta facendo adesso un agente, con le parole del registro. */
export function activityLine(agent) {
  const work = agent.currentWork
  if (agent.blocked && work) return `${agent.activityLabel}: ${work.requiredAction || work.reason || work.label}`
  if (work) return `${agent.activityLabel} · ${work.label}${agent.workCount > 1 ? ` (+${agent.workCount - 1})` : ''}`
  if (agent.status === 'running') return agent.lastRun?.summary || 'Turno in corso'
  if (agent.status === 'attention') return agent.lastRun?.summary || agent.lastRun?.label || 'Da verificare'
  if (agent.status === 'off') return 'Spento: non parte finché non lo accendi'
  return agent.lastRun?.summary ? `Ultimo turno: ${agent.lastRun.summary}` : 'In attesa del prossimo turno'
}
